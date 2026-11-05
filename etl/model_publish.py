"""Revízie IFC modelov federácie (D-086, F13): technická poistka, archív, zverejnenie.

IFC súbor je master. Každá zverejnená verzia sa uloží nemenne a skomprimovane do
`ifc/archive/<model>/vNNN.ifc.gz`, zapíše sa do `model_revisions` a nahrá sa aj na
doterajší kľúč `ifc/<model>.ifc`, z ktorého čítajú viewer, motor (D-084) aj ETL.
D-189: the model is a container of a project (`--project`, default AIM_PROJECT or OCB); outside OCB the
archive is `ifc/archive/<container uuid>/vNNN.ifc.gz` and the current key `ifc/<container uuid>.ifc` (D-190).
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
from . import project as project_mod
from .db import close_legacy
from .ifc_upload import (
    ARCHIVE_CACHE_SECONDS, BUCKET, CURRENT_CACHE_SECONDS, _request, _storage_env, put_object,
)

EXPECTED_SCHEMA = "IFC4X3_ADD2"
EXIT_GUARD = 2
EXIT_CONFLICT = 3
# Udalosť živého kanála (D-079), na ktorú viewer obnoví modely (`components/live-channel.tsx`).
LIVE_REVISION_EVENT = "model_revision"
# Aktuálny kľúč sa prepisuje každou revíziou, preto krátka cache. Archív sa nikdy neprepíše
# (upsert=false), preto dlhá: viewer aj IFC motor čítajú práve archív (D-135).
CURRENT_CACHE_CONTROL = CURRENT_CACHE_SECONDS
ARCHIVE_CACHE_CONTROL = ARCHIVE_CACHE_SECONDS


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
    project_code: Optional[str] = None,
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
    if project_code is not None:
        try:
            project_mod.check_file(new, project_code, new_path.name)
        except project_mod.ProjectError as exc:
            rep.fail(str(exc))

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


# ── model identity (D-189) ────────────────────────────────────────────────────

@dataclass(frozen=True)
class ModelRef:
    """A model of a project: the code (`ASR`) is a label unique within the project, the identity is the
    container (`information_containers.id`). `container_id` is None while the model has no revision yet."""

    project_code: str
    project_id: str
    model: str
    container_id: Optional[str] = None

    @property
    def legacy(self) -> bool:
        return project_mod.is_legacy(self.project_code)


def model_ref(cur, project_code: str, model: str, create: bool = False) -> ModelRef:
    """Resolve project and container of a model; `create=True` makes the container (first revision)."""
    project_id = project_mod.require(cur, project_code)
    row = cur.execute(
        "select id from information_containers where project_id = %s and model = %s", (project_id, model)
    ).fetchone()
    if row is None and create:
        row = cur.execute("select container_for_model(%s, %s)", (project_id, model)).fetchone()
    return ModelRef(project_code, project_id, model, str(row[0]) if row else None)


# ── úložisko ──────────────────────────────────────────────────────────────────

def archive_key(m: ModelRef, revision: int) -> str:
    """Archive key of a new revision. OCB keeps `archive/<model>/vNNN.ifc.gz`; other projects use the model
    UUID, `archive/<container uuid>/vNNN.ifc.gz` (D-190). Readers use `model_revisions.archive_path`."""
    folder = m.model if m.legacy else m.container_id
    if not folder:
        raise ValueError(f"{m.model}: model without a container has no archive key")
    return f"archive/{folder}/v{revision:03d}.ifc.gz"


def current_key(m: ModelRef) -> str:
    return f"{m.model}.ifc" if m.legacy else f"{m.container_id}.ifc"


def _put(key: str, data: bytes, *, upsert: bool, content_type: str, cache_control: int) -> None:
    """`cache_control` = sekundy (`cacheControl` formulára Storage, nie hlavička)."""
    base, secret = _storage_env()
    status, body = put_object(
        base, secret, BUCKET, key, data,
        content_type=content_type, upsert=upsert, cache_seconds=cache_control,
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


def storage_key(archive_path: str) -> str:
    """`model_revisions.archive_path` (`ifc/archive/...`) -> key inside the bucket."""
    prefix = f"{BUCKET}/"
    return archive_path[len(prefix):] if archive_path.startswith(prefix) else archive_path


def revision_archive(cur, m: ModelRef, revision: int) -> str:
    """Stored archive key of a revision (never rebuilt from the code, D-189)."""
    row = cur.execute(
        "select archive_path from model_revisions where container_id = %s and revision = %s",
        (m.container_id, revision),
    ).fetchone()
    if row is None or not row[0]:
        raise SystemExit(f"{m.project_code}/{m.model}: revision v{revision} has no archive")
    return storage_key(row[0])


def fetch_revision(key: str, dest: Path) -> Path:
    dest.write_bytes(gzip.decompress(_get(key)))
    return dest


def announce(model: str, db_url: Optional[str] = None, project_code: Optional[str] = None) -> Optional[int]:
    """Po re-ETL oznámi aktuálnu revíziu modelu na živom kanáli; vráti ju, ak odišla."""
    code = config.project_code(project_code)
    with psycopg.connect(db_url or config.database_url()) as conn, conn.cursor() as cur:
        m = model_ref(cur, code, model)
        row = cur.execute(
            "select revision, summary from model_revisions where container_id = %s and is_current",
            (m.container_id,),
        ).fetchone() if m.container_id else None
    if row is None:
        raise SystemExit(f"{code}/{model}: žiadna aktuálna revízia")
    return row[0] if broadcast_revision(model, row[0], row[1], project=code) else None


def broadcast_revision(model: str, revision: int, summary: Optional[str], project: Optional[str] = None) -> bool:
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
    if project:
        payload["project"] = project
    body = {"messages": [{"topic": channel, "event": LIVE_REVISION_EVENT, "payload": payload,
                          "private": False}]}
    status, _ = _request(
        "POST", f"{base}/realtime/v1/api/broadcast", secret,
        data=json.dumps(body).encode(), content_type="application/json",
    )
    return 200 <= status < 300


# ── revízie v DB ──────────────────────────────────────────────────────────────

def current_revision(cur, m: ModelRef) -> Optional[tuple[int, str]]:
    """(revízia, sha256) aktuálnej revízie modelu alebo None."""
    if m.container_id is None:
        return None
    row = cur.execute(
        "select revision, sha256 from model_revisions where container_id = %s and is_current",
        (m.container_id,),
    ).fetchone()
    return (row[0], row[1]) if row else None


def _lock(cur, m: ModelRef) -> None:
    # Advisory lock na celú transakciu: súbežné zverejnenia toho istého modelu (kontajnera) idú po jednom.
    cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"model_revisions:{m.container_id}",))


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
    project_code: Optional[str] = None,
    check_name: bool = True,
) -> dict[str, Any]:
    """Poistka → archív → zápis revízie (compare-and-swap) → aktuálny kľúč.

    `project_code` (D-189): the model is resolved within the project, the file must carry the project code in
    IfcProject.Name, and outside OCB its name follows the CDE scheme (D-036, D-190)."""
    code = config.project_code(project_code)
    if check_name:
        for warning in project_mod.check_file_name(path.name, code):
            print(f"File name: code outside the CDE vocabulary ({warning}), D-036.", file=sys.stderr)
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    url = db_url or config.database_url()
    summary = summary or (changes or {}).get("summary")

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        m = model_ref(cur, code, model)
        cur_rev = current_revision(cur, m)
        base_key = revision_archive(cur, m, base) if base is not None else None
    if cur_rev is not None and cur_rev[1] == sha:
        return {"status": "unchanged", "project": code, "model": model, "revision": cur_rev[0]}
    if (cur_rev[0] if cur_rev else None) != base:
        raise Conflict(f"{model}: aktuálna revízia je {cur_rev[0] if cur_rev else 'žiadna'}, "
                       f"úloha vychádza z {base}")

    with tempfile.TemporaryDirectory() as tmp:
        base_path = fetch_revision(base_key, Path(tmp) / "base.ifc") if base_key is not None else None
        rep = guard(path, base_path, changes, strict=strict and base is not None, project_code=code)
    result: dict[str, Any] = {"project": code, "model": model, "base": base, "sha256": sha,
                              "guard": asdict(rep)}
    if not rep.ok:
        result["status"] = "guard_failed"
        return result
    if dry_run:
        result["status"] = "dry_run"
        return result

    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            m = model_ref(cur, code, model, create=True)
            _lock(cur, m)
            now = current_revision(cur, m)
            if (now[0] if now else None) != base:
                raise Conflict(f"{model}: medzitým vznikla revízia {now[0]}, úloha vychádza z {base}")
            top = cur.execute(
                "select max(revision) from model_revisions where container_id = %s", (m.container_id,)
            ).fetchone()[0]
            new_rev = revision if revision is not None else (top + 1 if top is not None else 0)
            if top is not None and new_rev <= top:
                raise ValueError(f"{model}: revízia v{new_rev} nie je vyššia ako v{top}")
            key = archive_key(m, new_rev)
            _put(key, compress(data), upsert=False, content_type="application/gzip",
                 cache_control=ARCHIVE_CACHE_CONTROL)
            cur.execute("update model_revisions set is_current = false where container_id = %s and is_current",
                        (m.container_id,))
            cur.execute(
                """
                insert into model_revisions
                  (model, revision, parent_revision, is_current, sha256, size_bytes,
                   archive_path, task_id, recipe_ref, summary, author, guard, project_id, container_id)
                values (%s, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (model, new_rev, base, sha, len(data), f"{BUCKET}/{key}", task_id, recipe_ref,
                 summary, author, json.dumps(asdict(rep)), m.project_id, m.container_id),
            )
            if task_id:
                cur.execute(
                    "update model_tasks set status = 'resolved', result_revision = %s, "
                    "updated_at = now() where id = %s and project_id = %s",
                    (new_rev, task_id, m.project_id),
                )
        conn.commit()

    # Až po commite: pri zlyhaní ostane DB pravdou a `sync` aktuálny kľúč dorovná.
    _put(current_key(m), data, upsert=True, content_type="application/octet-stream",
         cache_control=CURRENT_CACHE_CONTROL)
    result.update(status="published", revision=new_rev, container_id=m.container_id, archive=f"{BUCKET}/{key}")
    return result


def revert(model: str, to: int, author: Optional[str] = None, db_url: Optional[str] = None,
           project_code: Optional[str] = None) -> dict:
    """Návrat = nová revízia s obsahom staršej; história sa neprepisuje."""
    code = config.project_code(project_code)
    url = db_url or config.database_url()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        m = model_ref(cur, code, model)
        now = current_revision(cur, m)
        old_key = revision_archive(cur, m, to) if now is not None else None
    if now is None:
        raise SystemExit(f"{code}/{model}: žiadna aktuálna revízia")
    with tempfile.TemporaryDirectory() as tmp:
        old = fetch_revision(old_key, Path(tmp) / f"{model}_v{to}.ifc")
        # The archived revision passed the file-name rule when it was published.
        return publish(model=model, path=old, base=now[0], summary=f"návrat na v{to}",
                       author=author, strict=False, db_url=url, project_code=code, check_name=False)


def sync(model: str, db_url: Optional[str] = None, project_code: Optional[str] = None) -> int:
    """Aktuálny kľúč znova z archívu aktuálnej revízie."""
    code = config.project_code(project_code)
    with psycopg.connect(db_url or config.database_url()) as conn, conn.cursor() as cur:
        m = model_ref(cur, code, model)
        now = current_revision(cur, m)
        key = revision_archive(cur, m, now[0]) if now is not None else None
    if now is None:
        raise SystemExit(f"{code}/{model}: žiadna aktuálna revízia")
    data = gzip.decompress(_get(key))
    _put(current_key(m), data, upsert=True, content_type="application/octet-stream",
         cache_control=CURRENT_CACHE_CONTROL)
    return now[0]


# ── CLI ───────────────────────────────────────────────────────────────────────

def _print(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    proj = argparse.ArgumentParser(add_help=False)
    proj.add_argument("--project", metavar="CODE",
                      help="project code (D-189); default env AIM_PROJECT or OCB")

    p = sub.add_parser("publish", parents=[proj], help="zverejniť novú revíziu modelu")
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

    r = sub.add_parser("revert", parents=[proj], help="návrat na staršiu revíziu (ako nová revízia)")
    r.add_argument("--model", required=True)
    r.add_argument("--to", required=True, type=int)
    r.add_argument("--author")

    a = sub.add_parser("announce", parents=[proj], help="po re-ETL oznámiť aktuálnu revíziu na živom kanáli")
    a.add_argument("--model", required=True)

    s = sub.add_parser("sync", parents=[proj], help="aktuálny kľúč znova z archívu")
    s.add_argument("--model", required=True)

    st = sub.add_parser("status", parents=[proj], help="zoznam revízií")
    st.add_argument("--model")

    sub.add_parser("close-legacy", parents=[proj], help="uzavrieť aktívne hrany a GUID so zdrojom bez mena modelu")

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
                dry_run=args.dry_run, project_code=args.project,
            )
            _print(result)
            return EXIT_GUARD if result["status"] == "guard_failed" else 0
        if args.cmd == "revert":
            result = revert(args.model, args.to, args.author, project_code=args.project)
            _print(result)
            return EXIT_GUARD if result["status"] == "guard_failed" else 0
        if args.cmd == "announce":
            rev = announce(args.model, project_code=args.project)
            print(f"{args.model}: v{rev} oznámená na živom kanáli" if rev is not None
                  else f"{args.model}: živý kanál nie je nastavený alebo neodpovedal (LIVE_CHANNEL)")
            return 0
        if args.cmd == "sync":
            print(f"{args.model}: aktuálny kľúč = v{sync(args.model, project_code=args.project)}")
            return 0
        if args.cmd == "status":
            with psycopg.connect(config.database_url()) as conn, conn.cursor() as cur:
                pid = project_mod.require(cur, config.project_code(args.project))
                rows = cur.execute(
                    "select model, revision, parent_revision, is_current, size_bytes, created_at, "
                    "coalesce(summary, '') from model_revisions "
                    "where project_id = %s and (%s::text is null or model = %s) order by model, revision",
                    (pid, args.model, args.model),
                ).fetchall()
            for m, rev, parent, cur_flag, size, created, summ in rows:
                mark = "*" if cur_flag else " "
                print(f"{mark} {m} v{rev:03d} <- {parent if parent is not None else '-'}  "
                      f"{size / 1e6:.1f} MB  {created:%Y-%m-%d %H:%M}  {summ}")
            return 0
        if args.cmd == "close-legacy":
            with psycopg.connect(config.database_url()) as conn:
                with conn.cursor() as cur:
                    closed = close_legacy(cur, project_mod.require(cur, config.project_code(args.project)))
                conn.commit()
            print(f"Uzavreté staré hrany {closed['edges']}, GUID záznamy {closed['guids']}, "
                  f"zaniknuté objekty {closed['objects']}, ručné väzby presunuté na nástupcu "
                  f"{closed['repointed']} (D-086, D-088).")
            return 0
    except Conflict as exc:
        print(f"KONFLIKT: {exc}", file=sys.stderr)
        return EXIT_CONFLICT
    return 1


if __name__ == "__main__":
    sys.exit(main())
