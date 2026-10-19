"""Dokumenty z IFC (D-101): súbory v buckete a ukončenie starej sady.

`Location` dokumentu v IFC je cesta autora (`../Dokumentacia/<Identification>.pdf`).
Load ju preloží na verejnú URL v buckete `documents`, ak tam súbor s rovnakým menom
je (`storage_type='supabase'`); inak ostane zo súboru (`unresolved`) a UI ukáže, že
súbor chýba. Pôvodná hodnota zostane v `properties._ifc_location`. Odkaz na časť
dokumentu (`#page=3`) si fragment ponechá.

Stará sada E3 (D-036, `podklady/docs.csv`) a dokumenty z ETL pred D-101 nemajú
`properties._model`. Jednorazovo ich ukončí `close-legacy` (spúšťa sa po prvom
re-ETL modelu s D-101):

    python -m etl.documents close-legacy [--dry-run]
"""

from __future__ import annotations

import argparse
import posixpath
import sys
import urllib.parse
from typing import Optional

from .model import StagedModel

BUCKET = "documents"
DOCUMENT_TYPES = ("document", "document_reference")


def bucket_names(cur) -> set[str]:
    """Mená súborov v buckete `documents` (storage.objects); prázdne mimo Supabase."""
    if cur.execute("select to_regclass('storage.objects')").fetchone()[0] is None:
        return set()
    rows = cur.execute(
        "select name from storage.objects where bucket_id = %s", (BUCKET,)
    ).fetchall()
    return {r[0] for r in rows}


def public_url(base: str, name: str) -> str:
    return f"{base.rstrip('/')}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(name)}"


def resolve_locations(model: StagedModel, names: set[str], base: Optional[str]) -> int:
    """Preloží `Location` dokumentov a odkazov na URL v buckete. Vráti počet nájdených."""
    found = 0
    for o in model.objects:
        d = o.document
        if o.object_type not in DOCUMENT_TYPES or d is None or not d.location:
            continue
        if d.storage_type == "supabase":
            continue  # už preložené (opakované volanie)
        o.properties["_ifc_location"] = d.location
        path, _, fragment = d.location.partition("#")
        name = posixpath.basename(path.replace("\\", "/"))
        if base and name in names:
            d.location = public_url(base, name) + (f"#{fragment}" if fragment else "")
            d.storage_type = "supabase"
            found += 1
    return found


def mark_model(model: StagedModel, scope: str) -> None:
    """Dokumenty tohto behu patria modelu `scope` - čo model prestane vydávať, ETL ukončí."""
    for o in model.objects:
        if o.object_type in DOCUMENT_TYPES:
            o.properties["_model"] = scope


# Dokumenty modelu `scope`, ktoré tento beh nevydal (premenovaný alebo zmazaný v IFC).
RETIRE_DOCUMENTS = (
    "update objects set valid_until = now() "
    "where valid_until is null and object_type = any(%s) "
    "and properties->>'_model' = %s and not (object_ref = any(%s)) returning id"
)

# Dokumenty bez modelu: stará sada E3 a dokumenty ETL pred D-101.
_LEGACY = (
    "select id from objects where valid_until is null and object_type = any(%s) "
    "and not (properties ? '_model')"
)


def close_legacy(cur) -> dict[str, int]:
    """Ukončí dokumenty bez `_model` a všetky ich aktívne väzby (E3, E4, ETL pred D-101)."""
    legacy = [r[0] for r in cur.execute(_LEGACY, (list(DOCUMENT_TYPES),)).fetchall()]
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
    ap = argparse.ArgumentParser(description="Dokumenty z IFC (D-101)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    legacy = sub.add_parser("close-legacy", help="ukonči dokumenty bez modelu (E3, ETL pred D-101)")
    legacy.add_argument("--dry-run", action="store_true", help="len vypíš, nič nezapisuj")
    args = ap.parse_args(argv)

    import psycopg

    from .config import database_url

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            ids = [r[0] for r in cur.execute(_LEGACY, (list(DOCUMENT_TYPES),)).fetchall()]
            new = cur.execute(
                "select count(*) from objects where valid_until is null "
                "and object_type = any(%s) and properties ? '_model'",
                (list(DOCUMENT_TYPES),),
            ).fetchone()[0]
            if args.dry_run:
                print(f"--dry-run: ukončilo by sa {len(ids)} dokumentov bez modelu "
                      f"(dokumentov z modelov: {new}).")
                return
            if ids and not new:
                raise SystemExit("Žiadny dokument s _model - najprv re-ETL modelu s D-101, "
                                 "inak by ostala knižnica prázdna.")
            closed = close_legacy(cur)
        conn.commit()
    print(f"Ukončené dokumenty bez modelu {closed['documents']}, ich väzby {closed['edges']} "
          f"(dokumentov z modelov: {new}).")


if __name__ == "__main__":
    main()
