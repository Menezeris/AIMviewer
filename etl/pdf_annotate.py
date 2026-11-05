"""PDF URI annotations - codes clickable in any viewer (D-042 phase B / MVP).

Reads the link regions from `objects.properties._drawing_links` (written by phase A,
`pdf_link.py`) and for each region inserts a PDF URI-link annotation (`page.insert_link`)
pointing to `${SITE_URL}/{target_route}/{target_id}`. The result is a separate annotated
PDF - the codes are clickable in any viewer, **zero frontend**.

**No second detection** (D-042): the coordinates are not taken from the PDF again but from
`_drawing_links` (a single source of truth). The source PDF is **not overwritten** - the annotated ones go
to a separate path (`podklady/ANNOTATED/`, mirroring the relative `source_path`).

The coordinates in `_drawing_links` are in PDF bottom-left (y up); `page.insert_link` expects a
rect in the `page.rect` space (top-left, y down) -> the inverse of the y-flip is here (`_to_page_rect`).
Drawing pages have rotation 0; PyMuPDF handles the mediabox offset internally (the same
space as `get_text`, from which the bbox came).

`--dry-run` = a report without writing files.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from .config import database_url, site_url
from .pdf_link import _SOURCE_ROOT, DrawingRow, read_drawings

# Annotated PDFs go next to the source - they mirror the relative `source_path` (source untouched).
_OUT_ROOT = _SOURCE_ROOT.parent / "ANNOTATED"


def _to_page_rect(bbox: list[float], page_size: list[float]) -> "fitz.Rect":
    """`_drawing_links` bbox (PDF bottom-left) -> `page.rect` rect (top-left). The inverse of the y-flip."""
    x0, by0, x1, by1 = bbox
    _w, h = page_size
    return fitz.Rect(x0, h - by1, x1, h - by0)


def _load_links(cur, container_name: str) -> Optional[list[dict]]:
    """The `_drawing_links` blob of a document (or None if the document/key is missing)."""
    row = cur.execute(
        "select properties->'_drawing_links' from objects "
        "where object_ref = %s and object_type = 'document'",
        (container_name,),
    ).fetchone()
    if row is None:
        return None
    return row[0]


def annotate_drawing(cur, row: DrawingRow, base_url: str, dry: bool) -> int:
    """Inserts URI-link annotations into a copy of the drawing; returns the number of inserted links."""
    pdf_path = _SOURCE_ROOT / row.source_path
    if not pdf_path.exists():
        raise SystemExit(f"PDF chýba: {row.source_path}")

    links = _load_links(cur, row.container_name)
    if links is None:
        raise SystemExit(
            f"dokument '{row.container_name}' nemá _drawing_links — najprv spusti "
            f"pdf_link (D-042 fáza A)."
        )
    if not links:
        return 0  # 0 regions (e.g. a PBR floor plan) -> nothing to annotate

    doc = fitz.open(pdf_path)
    for region in links:
        uri = f"{base_url}/{region['target_route']}/{region['target_id']}"
        rect = _to_page_rect(region["bbox"], region["page_size"])
        page = doc[region["page"] - 1]   # `page` is 1-based
        page.insert_link({"kind": fitz.LINK_URI, "from": rect, "uri": uri})

    if not dry:
        out_path = _OUT_ROOT / row.source_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(out_path)
    doc.close()
    return len(links)


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="PDF URI-anotácie výkresov (D-042 fáza B).")
    ap.add_argument("--dry-run", action="store_true",
                    help="report bez zápisu anotovaných PDF.")
    args = ap.parse_args(argv)

    base_url = site_url()
    drawings = read_drawings()
    print(f"Výkresy v manifeste (VD): {len(drawings)}")
    print(f"SITE_URL: {base_url}")
    print(f"Výstup:   {_OUT_ROOT}\n")

    total = 0
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            for row in drawings:
                n = annotate_drawing(cur, row, base_url, args.dry_run)
                total += n
                status = "anotované" if (n and not args.dry_run) else (
                    "—" if not n else "(dry-run)")
                print(f"  {row.container_name:42s} linkov {n:3d}  {status}")
        conn.rollback()  # we only read from the DB; no DB write in this phase

    tail = " (--dry-run → súbory sa nezapisujú)" if args.dry_run else ""
    print(f"\nHotovo: {total} URI-linkov{tail}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
