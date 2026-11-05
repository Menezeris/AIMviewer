"""Documents from the IFC (D-104): files in the bucket and closing the old set.

The IFC document `Location` is the author's path (`../Dokumentacia/<Identification>.pdf`).
Load translates it to a public URL in the `documents` bucket if a file with the same name
is there (`storage_type='supabase'`); otherwise it stays as in the file (`unresolved`) and the UI shows that
the file is missing. The original value stays in `properties._ifc_location`. A link to a part of
a document (`#page=3`) keeps its fragment.

The old E3 set (D-036, `podklady/docs.csv`) and documents from the ETL before D-104 have no
`properties._model`. `close-legacy` closes them once (run it after the first
re-ETL of a model with D-104):

    python -m etl.documents close-legacy [--dry-run]
"""

from __future__ import annotations

import argparse
import posixpath
import sys
import urllib.parse
from typing import Optional

from .model import StagedModel
from .project import OCB_ID

BUCKET = "documents"
DOCUMENT_TYPES = ("document", "document_reference")


def bucket_names(cur) -> set[str]:
    """File names in the `documents` bucket (storage.objects); empty outside Supabase."""
    if cur.execute("select to_regclass('storage.objects')").fetchone()[0] is None:
        return set()
    rows = cur.execute(
        "select name from storage.objects where bucket_id = %s", (BUCKET,)
    ).fetchall()
    return {r[0] for r in rows}


def public_url(base: str, name: str) -> str:
    return f"{base.rstrip('/')}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(name)}"


def resolve_locations(model: StagedModel, names: set[str], base: Optional[str]) -> int:
    """Translates the `Location` of documents and references to URLs in the bucket. Returns the number found."""
    found = 0
    for o in model.objects:
        d = o.document
        if o.object_type not in DOCUMENT_TYPES or d is None or not d.location:
            continue
        if d.storage_type == "supabase":
            continue  # already translated (repeated call)
        o.properties["_ifc_location"] = d.location
        path, _, fragment = d.location.partition("#")
        name = posixpath.basename(path.replace("\\", "/"))
        if base and name in names:
            d.location = public_url(base, name) + (f"#{fragment}" if fragment else "")
            d.storage_type = "supabase"
            found += 1
    return found


def mark_model(model: StagedModel, scope: str) -> None:
    """Documents of this run belong to model `scope` - what the model stops emitting, the ETL closes."""
    for o in model.objects:
        if o.object_type in DOCUMENT_TYPES:
            o.properties["_model"] = scope


# Documents of model `scope` that this run did not emit (renamed or deleted in the IFC).
RETIRE_DOCUMENTS = (
    "update objects set valid_until = now() "
    "where valid_until is null and object_type = any(%s) "
    "and properties->>'_model' = %s and project_id = %s and not (object_ref = any(%s)) returning id"
)

# Documents without a model: the old E3 set and documents from the ETL before D-104.
_LEGACY = (
    "select id from objects where valid_until is null and object_type = any(%s) "
    "and not (properties ? '_model') and project_id = %s"
)


def close_legacy(cur, project_id: str = OCB_ID) -> dict[str, int]:
    """Closes documents without `_model` and all their active edges (E3, E4, ETL before D-104), in one project."""
    legacy = [r[0] for r in cur.execute(_LEGACY, (list(DOCUMENT_TYPES), project_id)).fetchall()]
    if not legacy:
        return {"documents": 0, "edges": 0}
    edges = cur.execute(
        "update relationships set valid_until = now() where valid_until is null "
        "and (from_id = any(%s) or to_id = any(%s)) returning id",
        (legacy, legacy),
    ).fetchall()
    cur.execute("update objects set valid_until = now() where id = any(%s)", (legacy,))
    return {"documents": len(legacy), "edges": len(edges)}


def main(argv: Optional[list[str]] = None) -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Dokumenty z IFC (D-104)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    legacy = sub.add_parser("close-legacy", help="ukonči dokumenty bez modelu (E3, ETL pred D-104)")
    legacy.add_argument("--dry-run", action="store_true", help="len vypíš, nič nezapisuj")
    legacy.add_argument("--project", metavar="CODE", help="project code (D-189); default env AIM_PROJECT or OCB")
    args = ap.parse_args(argv)

    import psycopg

    from . import project as project_mod
    from .config import database_url, project_code

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            pid = project_mod.require(cur, project_code(args.project))
            ids = [r[0] for r in cur.execute(_LEGACY, (list(DOCUMENT_TYPES), pid)).fetchall()]
            new = cur.execute(
                "select count(*) from objects where valid_until is null "
                "and object_type = any(%s) and properties ? '_model' and project_id = %s",
                (list(DOCUMENT_TYPES), pid),
            ).fetchone()[0]
            if args.dry_run:
                print(f"--dry-run: ukončilo by sa {len(ids)} dokumentov bez modelu "
                      f"(dokumentov z modelov: {new}).")
                return
            if ids and not new:
                raise SystemExit("Žiadny dokument s _model - najprv re-ETL modelu s D-104, "
                                 "inak by ostala knižnica prázdna.")
            closed = close_legacy(cur, pid)
        conn.commit()
    print(f"Ukončené dokumenty bez modelu {closed['documents']}, ich väzby {closed['edges']} "
          f"(dokumentov z modelov: {new}).")


if __name__ == "__main__":
    main()
