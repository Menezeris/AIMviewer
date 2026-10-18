"""Revízie IFC modelov federácie (D-086, F13): technická poistka, archív, zverejnenie.

IFC súbor je master. Každá zverejnená verzia sa uloží nemenne a skomprimovane do
`ifc/archive/<model>/vNNN.ifc.gz`, zapíše sa do `model_revisions` a nahrá sa aj na
doterajší kľúč `ifc/<model>.ifc`, z ktorého čítajú viewer, motor (D-084) aj ETL.
Zápis je compare-and-swap pod advisory lockom modelu: úloha pripravená nad revíziou
N sa zverejní len vtedy, ak je N stále aktuálna; inak skončí kódom 3 (konflikt) a
recept treba spustiť znova nad novou revíziou. Viewer sa o novej revízii dozvie až
krokom `announce` po re-ETL, aby nový model nečakal na GUID, ktoré DB ešte nepozná.

Použitie (z koreňa repa):
    python -m etl.model_publish publish --model ASR --file out/ASR_v73.ifc --base 72 \\
        --changes zmeny.json --summary "..." [--task UUID] [--recipe cesta@commit] [--dry-run]
    python -m etl.model_publish publish --model ASR --file ASR_v72.ifc --revision 72 \\
        --bootstrap --summary "prvá revízia"          # bez aktuálnej revízie / bez zoznamu zmien
    python -m etl.model_publish revert --model ASR --to 71
    python -m etl.model_publish announce --model ASR  # po re-ETL: "nová revízia" do viewera
    python -m etl.model_publish sync --model ASR      # aktuálny kľúč znova z archívu
    python -m etl.model_publish status [--model ASR]
    python -m etl.model_publish close-legacy          # raz po prvom loade s --model

Kódy ukončenia: 0 OK alebo bez zmeny, 2 poistka neprešla, 3 konflikt so základom.
Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, voliteľne `LIVE_CHANNEL`.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import tempfile
import urllib.parse
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import ifcopenshell
import psycopg

from . import config
from .db import close_legacy
from .ifc_upload import BUCKET, _request, _storage_env

EXPECTED_SCHEMA = "IFC4X3_ADD2"
EXIT_GUARD = 2
EXIT_CONFLICT = 3
# Udalosť živého kanála (D-079), na ktorú viewer obnoví modely (`components/live-channel.tsx`).
LIVE_REVISION_EVENT = "model_revision"
CURRENT_CACHE_CONTROL = "max-age=60"


class Conflict(Exception):
    """Aktuálna revízia už nie je základ úlohy."""


# ── technická poistka ─────────────────────────────────────────────────────────

@dataclass
class GuardReport:
    """Výsledok technickej poistky. Nekontroluje obsah (IDS), len či súbor nie je poškodený
    a či sa zo súboru nestratili alebo nepribudli objekty, o ktorých zoznam zmien nevie."""

    ok: bool = True
    errors: list[str] = field(default_factory=list)
    schema: Optional[str] = None
    objects: int = 0                                         # IfcObjectDefinition s GlobalId
    added: list[str] = field(default_factory=list)           # GUID oproti základu
    removed: list[str] = field(default_factory=list)
    class_delta: dict[str, int] = field(default_factory=dict)

    def fail(self, msg: str) -> None:
        self.ok = False
        self.errors.append(msg)


def _object_guids(f: ifcopenshell.file) -> dict[str, str]:
    """GlobalId → IFC trieda pre IfcObjectDefinition (objekty, typy, kontext).

    Vzťahy a sady vlastností (tiež IfcRoot) sa pri úpravách bežne vytvárajú aj rušia,
    preto sa porovnávajú len objekty."""
    return {e.GlobalId: e.is_a() for e in f.by_type("IfcObjectDefinition") if e.GlobalId}


def _schema_of(f: ifcopenshell.file) -> str:
    return getattr(f, "schema_identifier", None) or f.schema


def guard(
    new_path: Path,
    base_path: Optional[Path] = None,
    changes: Optional[dict] = None,
    strict: bool = True,
) -> GuardReport:
    """Technická poistka pred zverejnením (D-086 bod 6).

    - súbor sa otvorí v ifcopenshell a schéma ostáva (IFC4X3_ADD2 alebo schéma základu);
    - žiadny GlobalId IfcRoot nie je v súbore dvakrát;
    - `strict`: každý pridaný a odobratý objekt (GlobalId) je v zozname zmien ako
      `add` / `remove`. Bez základu (prvá revízia) alebo pri návrate sa to len hlási.
    """
    rep = GuardReport()
    try:
        new = ifcopenshell.open(str(new_path))
    except Exception as exc:  # noqa: BLE001 - poškodený súbor môže zhodiť parser hocijako
        rep.fail(f"súbor sa nedá otvoriť: {exc}")
        return rep
    rep.schema = _schema_of(new)

    roots = Counter(e.GlobalId for e in new.by_type("IfcRoot") if e.GlobalId)
    dup = sorted(g for g, n in roots.items() if n > 1)
    if dup:
        rep.fail(f"GlobalId je v súbore viackrát ({len(dup)}): {', '.join(dup[:20])}")

    new_objs = _object_guids(new)
    rep.objects = len(new_objs)
    if base_path is None:
        if rep.schema != EXPECTED_SCHEMA:
            rep.fail(f"schéma {rep.schema}, očakávaná {EXPECTED_SCHEMA}")
        return rep

    base = ifcopenshell.open(str(base_path))
    if rep.schema != _schema_of(base):
        rep.fail(f"schéma sa zmenila: {_schema_of(base)} -> {rep.schema}")
    base_objs = _object_guids(base)
    rep.added = sorted(set(new_objs) - set(base_objs))
    rep.removed = sorted(set(base_objs) - set(new_objs))
    delta = Counter(new_objs.values())
    delta.subtract(Counter(base_objs.values()))
    rep.class_delta = {cls: n for cls, n in sorted(delta.items()) if n}

    if not strict:
        return rep
    declared = (changes or {}).get("changes") or []
    for op, found in (("add", rep.added), ("remove", rep.removed)):
        allowed = {c.get("guid") for c in declared if c.get("op") == op}
        extra = [g for g in found if g not in allowed]
        if extra:
            label = "pribudli" if op == "add" else "zmizli"
            rep.fail(
                f"{label} objekty, ktoré zoznam zmien nehlási ako '{op}' ({len(extra)}): "
                + ", ".join(f"{g} {new_objs.get(g) or base_objs.get(g)}" for g in extra[:20])
            )
    return rep


# ── úložisko ──────────────────────────────────────────────────────────────────

def archive_key(model: str, revision: int) -> str:
    return f"archive/{model}/v{revision:03d}.ifc.gz"


def current_key(model: str) -> str:
    return f"{model}.ifc"


def _put(key: str, data: bytes, *, upsert: bool, content_type: str, cache_control: str) -> None:
    base, secret = _storage_env()
    status, body = _request(
        "POST",
        f"{base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(key)}",
        secret,
        data=data,
        content_type=content_type,
        extra_headers={"x-upsert": "true" if upsert else "false", "cache-control": cache_control},
    )
    if status not in (200, 201):
        raise RuntimeError(f"upload {key} zlyhal ({status}): {body.decode(errors='replace')}")


def _get(key: str) -> bytes:
    base, secret = _storage_env()
    status, body = _request(
        "GET", f"{base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(key)}", secret
    )
    if status != 200:
        raise RuntimeError(f"stiahnutie {key} zlyhalo ({status}): {body.decode(errors='replace')}")
    return body


def compress(data: bytes) -> bytes:
    # mtime=0: rovnaký obsah = rovnaký archív
    return gzip.compress(data, compresslevel=6, mtime=0)


def fetch_revision(model: str, revision: int, dest: Path) -> Path:
    dest.write_bytes(gzip.decompress(_get(archive_key(model, revision))))
    return dest


def announce(model: str, db_url: Optional[str] = None) -> Optional[int]:
    """Po re-ETL oznámi aktuálnu revíziu modelu na živom kanáli; vráti ju, ak odišla."""
    with psycopg.connect(db_url or config.database_url()) as conn, conn.cursor() as cur:
        row = cur.execute(
            "select revision, summary from model_revisions where model = %s and is_current",
            (model,),
        ).fetchone()
    if row is None:
        raise SystemExit(f"{model}: žiadna aktuálna revízia")
    return row[0] if broadcast_revision(model, row[0], row[1]) else None


def broadcast_revision(model: str, revision: int, summary: Optional[str]) -> bool:
    """Oznámi novú revíziu na živom kanáli (D-079); viewer s `?live=` obnoví modely."""
    channel = (os.environ.get("LIVE_CHANNEL") or "").strip()
    if not channel:
        return False
    base, secret = _storage_env()
    payload = {
        "model": model,
        "revision": revision,
        "summary": summary,
        "sentAt": datetime.now(timezone.utc).isoformat(),
    }
    body = {"messages": [{"topic": channel, "event": LIVE_REVISION_EVENT, "payload": payload,
                          "private": False}]}
    status, _ = _request(
        "POST", f"{base}/realtime/v1/api/broadcast", secret,
        data=json.dumps(body).encode(), content_type="application/json",
    )
    return 200 <= status < 300


# ── revízie v DB ──────────────────────────────────────────────────────────────

def current_revision(cur, model: str) -> Optional[tuple[int, str]]:
    """(revízia, sha256) aktuálnej revízie modelu alebo None."""
    row = cur.execute(
        "select revision, sha256 from model_revisions where model = %s and is_current",
        (model,),
    ).fetchone()
    return (row[0], row[1]) if row else None


def _lock(cur, model: str) -> None:
    # Advisory lock na celú transakciu: súbežné zverejnenia toho istého modelu idú po jednom.
    cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"model_revisions:{model}",))


def publish(
    *,
    model: str,
    path: Path,
    base: Optional[int],
    revision: Optional[int] = None,
    changes: Optional[dict] = None,
    task_id: Optional[str] = None,
    recipe_ref: Optional[str] = None,
    summary: Optional[str] = None,
    author: Optional[str] = None,
    strict: bool = True,
    dry_run: bool = False,
    db_url: Optional[str] = None,
) -> dict[str, Any]:
    """Poistka → archív → zápis revízie (compare-and-swap) → aktuálny kľúč."""
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    url = db_url or config.database_url()
    summary = summary or (changes or {}).get("summary")

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur_rev = current_revision(cur, model)
    if cur_rev is not None and cur_rev[1] == sha:
        return {"status": "unchanged", "model": model, "revision": cur_rev[0]}
    if (cur_rev[0] if cur_rev else None) != base:
        raise Conflict(f"{model}: aktuálna revízia je {cur_rev[0] if cur_rev else 'žiadna'}, "
                       f"úloha vychádza z {base}")

    with tempfile.TemporaryDirectory() as tmp:
        base_path = fetch_revision(model, base, Path(tmp) / "base.ifc") if base is not None else None
        rep = guard(path, base_path, changes, strict=strict and base is not None)
    result: dict[str, Any] = {"model": model, "base": base, "sha256": sha, "guard": asdict(rep)}
    if not rep.ok:
        result["status"] = "guard_failed"
        return result
    if dry_run:
        result["status"] = "dry_run"
        return result

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            _lock(cur, model)
            now = current_revision(cur, model)
            if (now[0] if now else None) != base:
                raise Conflict(f"{model}: medzitým vznikla revízia {now[0]}, úloha vychádza z {base}")
            top = cur.execute(
                "select max(revision) from model_revisions where model = %s", (model,)
            ).fetchone()[0]
            new_rev = revision if revision is not None else (top + 1 if top is not None else 0)
            if top is not None and new_rev <= top:
                raise ValueError(f"{model}: revízia v{new_rev} nie je vyššia ako v{top}")
            key = archive_key(model, new_rev)
            _put(key, compress(data), upsert=False, content_type="application/gzip",
                 cache_control="max-age=31536000, immutable")
            cur.execute("update model_revisions set is_current = false where model = %s and is_current",
                        (model,))
            cur.execute(
                """
                insert into model_revisions
                  (model, revision, parent_revision, is_current, sha256, size_bytes,
                   archive_path, task_id, recipe_ref, summary, author, guard)
                values (%s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (model, new_rev, base, sha, len(data), f"{BUCKET}/{key}", task_id, recipe_ref,
                 summary, author, json.dumps(asdict(rep))),
            )
            if task_id:
                cur.execute(
                    "update model_tasks set status = 'resolved', result_revision = %s, "
                    "updated_at = now() where id = %s",
                    (new_rev, task_id),
                )
        conn.commit()

    # Až po commite: pri zlyhaní ostane DB pravdou a `sync` aktuálny kľúč dorovná.
    _put(current_key(model), data, upsert=True, content_type="application/octet-stream",
         cache_control=CURRENT_CACHE_CONTROL)
    result.update(status="published", revision=new_rev)
    return result


def revert(model: str, to: int, author: Optional[str] = None, db_url: Optional[str] = None) -> dict:
    """Návrat = nová revízia s obsahom staršej; história sa neprepisuje."""
    url = db_url or config.database_url()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        now = current_revision(cur, model)
    if now is None:
        raise SystemExit(f"{model}: žiadna aktuálna revízia")
    with tempfile.TemporaryDirectory() as tmp:
        old = fetch_revision(model, to, Path(tmp) / f"{model}_v{to}.ifc")
        return publish(model=model, path=old, base=now[0], summary=f"návrat na v{to}",
                       author=author, strict=False, db_url=url)


def sync(model: str, db_url: Optional[str] = None) -> int:
    """Aktuálny kľúč `ifc/<model>.ifc` znova z archívu aktuálnej revízie."""
    with psycopg.connect(db_url or config.database_url()) as conn, conn.cursor() as cur:
        now = current_revision(cur, model)
    if now is None:
        raise SystemExit(f"{model}: žiadna aktuálna revízia")
    data = gzip.decompress(_get(archive_key(model, now[0])))
    _put(current_key(model), data, upsert=True, content_type="application/octet-stream",
         cache_control=CURRENT_CACHE_CONTROL)
    return now[0]


# ── CLI ───────────────────────────────────────────────────────────────────────

def _print(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("publish", help="zverejniť novú revíziu modelu")
    p.add_argument("--model", required=True)
    p.add_argument("--file", required=True, type=Path)
    p.add_argument("--base", type=int, help="revízia, nad ktorou úloha vznikla (compare-and-swap)")
    p.add_argument("--revision", type=int, help="číslo novej revízie (default aktuálna + 1)")
    p.add_argument("--changes", type=Path, help="zoznam zmien (JSON, D-086)")
    p.add_argument("--task", help="id úlohy v model_tasks")
    p.add_argument("--recipe", help="recept v OCB (cesta@commit)")
    p.add_argument("--summary")
    p.add_argument("--author")
    p.add_argument("--bootstrap", action="store_true",
                   help="prvá revízia alebo prevzatie súboru bez zoznamu zmien (poistka len hlási)")
    p.add_argument("--dry-run", action="store_true", help="len poistka, nič sa nezapíše")

    r = sub.add_parser("revert", help="návrat na staršiu revíziu (ako nová revízia)")
    r.add_argument("--model", required=True)
    r.add_argument("--to", required=True, type=int)
    r.add_argument("--author")

    a = sub.add_parser("announce", help="po re-ETL oznámiť aktuálnu revíziu na živom kanáli")
    a.add_argument("--model", required=True)

    s = sub.add_parser("sync", help="aktuálny kľúč znova z archívu")
    s.add_argument("--model", required=True)

    st = sub.add_parser("status", help="zoznam revízií")
    st.add_argument("--model")

    sub.add_parser("close-legacy", help="uzavrieť aktívne hrany a GUID so zdrojom bez mena modelu")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "publish":
            changes = json.loads(args.changes.read_text(encoding="utf-8")) if args.changes else None
            if not args.bootstrap and args.base is not None and changes is None:
                raise SystemExit("--changes je povinné (alebo --bootstrap pri prevzatí súboru)")
            result = publish(
                model=args.model, path=args.file, base=args.base, revision=args.revision,
                changes=changes, task_id=args.task, recipe_ref=args.recipe,
                summary=args.summary, author=args.author, strict=not args.bootstrap,
                dry_run=args.dry_run,
            )
            _print(result)
            return EXIT_GUARD if result["status"] == "guard_failed" else 0
        if args.cmd == "revert":
            result = revert(args.model, args.to, args.author)
            _print(result)
            return EXIT_GUARD if result["status"] == "guard_failed" else 0
        if args.cmd == "announce":
            rev = announce(args.model)
            print(f"{args.model}: v{rev} oznámená na živom kanáli" if rev is not None
                  else f"{args.model}: živý kanál nie je nastavený alebo neodpovedal (LIVE_CHANNEL)")
            return 0
        if args.cmd == "sync":
            print(f"{args.model}: aktuálny kľúč = v{sync(args.model)}")
            return 0
        if args.cmd == "status":
            with psycopg.connect(config.database_url()) as conn, conn.cursor() as cur:
                rows = cur.execute(
                    "select model, revision, parent_revision, is_current, size_bytes, created_at, "
                    "coalesce(summary, '') from model_revisions "
                    "where %s::text is null or model = %s order by model, revision",
                    (args.model, args.model),
                ).fetchall()
            for m, rev, parent, cur_flag, size, created, summ in rows:
                mark = "*" if cur_flag else " "
                print(f"{mark} {m} v{rev:03d} <- {parent if parent is not None else '-'}  "
                      f"{size / 1e6:.1f} MB  {created:%Y-%m-%d %H:%M}  {summ}")
            return 0
        if args.cmd == "close-legacy":
            with psycopg.connect(config.database_url()) as conn:
                with conn.cursor() as cur:
                    closed = close_legacy(cur)
                conn.commit()
            print(f"Uzavreté staré hrany {closed['edges']}, GUID záznamy {closed['guids']} (D-086).")
            return 0
    except Conflict as exc:
        print(f"KONFLIKT: {exc}", file=sys.stderr)
        return EXIT_CONFLICT
    return 1


if __name__ == "__main__":
    sys.exit(main())
