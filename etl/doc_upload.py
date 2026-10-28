"""Document upload — manifest → Supabase Storage + graf (D-032 / D-036, E3).

Číta manifest `podklady/docs.csv` (legacy PDF → CDE názov + cieľ väzby), nahrá
súbory do public bucketu `documents/` a zapíše ich do grafu ako prvotriedne uzly:

    objects(object_type='document', object_ref=<CDE názov>)
      └─ documents (identification, description, revision, status, location,
                    storage_type='supabase')
    rel_associates_document(from=target_ref → to=dokument, role=<z TypSouboru>)

Identita dokumentu = **CDE názov kontajnera** (`object_ref`, D-010 vrstva 2),
metadáta sa parsujú cez `doc_scheme.py` (D-036). Väzba ide z manifestu (`target_ref`),
nie z názvu — CDE nemá pole pre podlažie (D-036).

Idempotentné: uzly cez `object_ref`, hrany cez deterministické UUID (`ids.py`),
upload `x-upsert`. `--dry-run` = iba parsovanie + validácia (žiadny upload/zápis).

Env (`.env.local`): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import psycopg
from psycopg.types.json import Json

from . import ids
from .config import database_url
from .doc_scheme import DocumentMeta, parse_container_name
from .ifc_upload import put_object

BUCKET = "documents"
# PDF sa pod rovnakým menom (CDE názov) prepíše novou verziou, preto hodina, nie rok (D-135 dodatok).
CACHE_SECONDS = 3600
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"


@dataclass(frozen=True)
class ManifestRow:
    source_path: str
    container_name: str
    target_ref: str
    status: Optional[str]
    revision: Optional[str]

    @property
    def meta(self) -> DocumentMeta:
        return parse_container_name(self.container_name)

    @property
    def object_key(self) -> str:
        """Kľúč v buckete = CDE názov + .pdf (bez diakritiky → bezpečné URL)."""
        return f"{self.container_name}.pdf"


# ── Manifest ──────────────────────────────────────────────────────────────────


def read_manifest() -> list[ManifestRow]:
    if not _MANIFEST.exists():
        raise SystemExit(f"Chýba manifest {_MANIFEST}")
    rows: list[ManifestRow] = []
    with _MANIFEST.open(encoding="utf-8-sig") as fh:
        # utf-8-sig: Excel pri uložení CSV pridá BOM — bez neho by prvý stĺpec
        # hlavičky bol '﻿source_path' a parser by padol na KeyError.
        reader = csv.DictReader(line for line in fh if not line.startswith("#"))
        for r in reader:
            rows.append(
                ManifestRow(
                    source_path=r["source_path"].strip(),
                    container_name=r["container_name"].strip(),
                    target_ref=r["target_ref"].strip(),
                    status=(r.get("status") or "").strip() or None,
                    revision=(r.get("revision") or "").strip() or None,
                )
            )
    return rows


def validate(rows: list[ManifestRow]) -> list[str]:
    """Predletová kontrola: existencia súborov, unikátnosť názvov, kódy v slovníku."""
    problems: list[str] = []
    seen: set[str] = set()
    for r in rows:
        if not (_SOURCE_ROOT / r.source_path).exists():
            problems.append(f"súbor chýba: {r.source_path}")
        if r.container_name in seen:
            problems.append(f"duplicitný container_name: {r.container_name}")
        seen.add(r.container_name)
        bad = r.meta.unknown_codes()
        if bad:
            problems.append(f"{r.container_name}: kódy mimo slovníka {bad}")
    return problems


# ── Supabase Storage (REST cez stdlib urllib) ─────────────────────────────────


def _storage_env() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise SystemExit(
            "Chýba SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY v .env.local "
            "(Supabase → Project Settings → API)."
        )
    return url, key


def _request(method: str, url: str, key: str, *, data: bytes | None = None,
             content_type: str | None = None, extra_headers: dict | None = None) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def ensure_bucket(base: str, key: str) -> None:
    """Vytvorí public bucket `documents` (idempotentne — existujúci ignoruje)."""
    status, body = _request(
        "POST", f"{base}/storage/v1/bucket", key,
        data=json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode(),
        content_type="application/json",
    )
    if status in (200, 201):
        print(f"  bucket '{BUCKET}' vytvorený (public)")
    elif status == 409 or b"already exists" in body or b"Duplicate" in body:
        print(f"  bucket '{BUCKET}' už existuje")
    else:
        raise SystemExit(f"Bucket zlyhal ({status}): {body.decode(errors='replace')}")


def upload_file(base: str, key: str, object_key: str, content: bytes) -> str:
    """Nahrá súbor (upsert) a vráti verejnú URL."""
    encoded = urllib.parse.quote(object_key)
    status, body = put_object(
        base, key, BUCKET, object_key, content,
        content_type="application/pdf", upsert=True, cache_seconds=CACHE_SECONDS,
    )
    if status not in (200, 201):
        raise SystemExit(f"Upload {object_key} zlyhal ({status}): {body.decode(errors='replace')}")
    return f"{base}/storage/v1/object/public/{BUCKET}/{encoded}"


# ── Zápis do grafu ────────────────────────────────────────────────────────────


def _document_properties(meta: DocumentMeta) -> dict:
    """Custom pset `CDE` s diagnostickými labelmi (nie `_`-kľúč — je to pset, D-022)."""
    fields = {
        "Stupeň PD": meta.stage_label,
        "Profese": meta.discipline_label,
        "Typ súboru": meta.type_label,
        "Číslo": meta.number,
    }
    cde = {k: v for k, v in fields.items() if v}
    return {"CDE": cde} if cde else {}


def _write_document(cur, row: ManifestRow, location: str, storage_type: str) -> None:
    meta = row.meta
    # 1) cieľový uzol musí existovať
    target = cur.execute(
        "select id from objects where object_ref = %s", (row.target_ref,)
    ).fetchone()
    if not target:
        raise SystemExit(f"target_ref '{row.target_ref}' neexistuje v objects "
                         f"(dokument {row.container_name})")
    target_id = target[0]

    # 2) objects(document) — upsert cez object_ref (= CDE názov)
    name = meta.human_description() or row.container_name
    doc_id = cur.execute(
        """
        insert into objects (object_type, object_ref, name, properties)
        values ('document', %s, %s, %s)
        on conflict (object_ref) do update set
          object_type = 'document', name = excluded.name,
          -- nahradí LEN pset CDE; ostatné kľúče (_drawing_links z pdf_link, E4)
          -- musia re-upload prežiť (D-031: opakovaný E3 nesmie degradovať E4)
          properties = (coalesce(objects.properties, '{}'::jsonb) - 'CDE')
                       || excluded.properties, updated_at = now()
        returning id
        """,
        (row.container_name, name, Json(_document_properties(meta))),
    ).fetchone()[0]

    # 3) documents prípona (D-014 + storage_type D-032)
    cur.execute(
        """
        insert into documents
          (id, identification, description, location, revision, status, storage_type)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (id) do update set
          identification = excluded.identification, description = excluded.description,
          location = excluded.location, revision = excluded.revision,
          status = excluded.status, storage_type = excluded.storage_type
        """,
        (doc_id, row.container_name, name, location, row.revision, row.status, storage_type),
    )

    # 4) rel_associates_document(target → dokument, role z TypSouboru)
    # D-051: generická `relationships` (rel_type), nie kanonické view.
    eid = ids.edge_id(row.target_ref, row.container_name, "has_document")
    cur.execute(
        """
        insert into relationships
          (id, rel_type, from_id, to_id, role, valid_from, valid_until, source)
        values (%s, 'rel_associates_document', %s, %s, %s, now(), null, %s)
        on conflict (id) do update set
          role = excluded.role, source = excluded.source
        """,
        (eid, target_id, doc_id, meta.role, "doc_upload (D-036)"),
    )


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: Optional[list[str]] = None) -> int:
    # Windows konzola býva cp1250 — diakritika/šípky by inak padli na UnicodeEncodeError.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="Upload dokumentov z manifestu (E3, D-036).")
    ap.add_argument("--dry-run", action="store_true",
                    help="iba parsovanie + validácia (žiadny upload ani zápis).")
    args = ap.parse_args(argv)

    rows = read_manifest()
    print(f"Manifest: {len(rows)} dokumentov ({_MANIFEST.name})")

    problems = validate(rows)
    if problems:
        print("\nVALIDÁCIA ZLYHALA:")
        for p in problems:
            print("  ✗", p)
        return 1
    print("Validácia OK (súbory existujú, názvy unikátne, kódy v slovníku).")

    if args.dry_run:
        print("\n--dry-run — náhľad väzieb:")
        for r in rows:
            m = r.meta
            print(f"  {r.container_name:46s} [{m.role:11s}] → {r.target_ref}")
        return 0

    base, key = _storage_env()
    print(f"\nStorage: {base}/storage/v1  bucket '{BUCKET}'")
    ensure_bucket(base, key)

    url = database_url()
    uploaded = 0
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            for r in rows:
                content = (_SOURCE_ROOT / r.source_path).read_bytes()
                location = upload_file(base, key, r.object_key, content)
                _write_document(cur, r, location, storage_type="supabase")
                uploaded += 1
                print(f"  ✓ {r.container_name} → {r.target_ref}  ({len(content)//1024} kB)")
        conn.commit()

    print(f"\nHotovo: {uploaded} dokumentov nahraných + zapísaných do grafu.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
