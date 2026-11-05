"""Text extraction of PDF documents -> `document_pages` (D-063).

Complements E4 (`pdf_link.py` - element<->drawing links from content): here text is extracted
per page from EVERY PDF in the manifest (`docs.csv`, not only VD drawings), so that the LLM
can search in the CONTENT of documents (RPC `search_documents`, migration
`20260715120000`). Same input contract as E4: `source_path` = path to the PDF
under `podklady/FINAL`, `container_name` = `object_ref` of the document in the DB (E3).

PyMuPDF (`fitz`) - already an ETL dependency (D-041). Extraction is
`page.get_text("text")` + whitespace normalization; vector drawings have
sparse text (legends, title blocks) and that is expected. Empty pages are not inserted.

D-169 (changes D-123 point 7): a page WITHOUT a text layer that the diagnostics (#279)
mark as `obrázok` or `krivky` is read by OCR (`etl/ocr.py`, Tesseract
ces+slk+eng). Lines from OCR additionally have `src: "ocr"` and `conf` in `blocks`; pages
with a text layer never go to OCR. On by default, `--no-ocr` turns it off,
`--dry-run` only counts the pages that would go to OCR.

Idempotent: per document `DELETE` + `INSERT` in one transaction - a repeated
run = the same state. A document that is not in the DB (missing E3 upload) is skipped
with a warning, the run does not fail.

D-123: documents from IFC (D-104) are not in the manifest and their PDFs lie in the bucket
`documents`, so `--from-db` takes live documents directly from the DB (`valid_until is
null`, `documents.location` = PDF URL) and downloads the PDF. Besides the page text,
text lines with position are stored (`blocks`, bbox in % of the page, origin top
left), so that the tool can tell WHERE on the page the text is (crop for open_drawing
region, D-117).

D-133: for vector drawings the thick lines of the page are also stored (`lines` =
`{size: [W, H], segs: [[x1, y1, x2, y2, w]]}` in page points, origin bottom left), from which the IFC engine
calibrates the underlay (floor plan, section) against a section through the model.

D-158 (steps 3 and 4): each page gets `page_size` = [width, height] in points
(the displayed page, with rotation; RFC 8118 viewrect of a link to the page) and the document
`documents.file_sha256` = sha256 of the PDF file (revision anchor, cache key of the crop
snapshot). Page rasters are not made, the snapshot is rendered in the host on demand.

Run (from the repo root):
    python -m etl.pdf_text [--dry-run] [--no-ocr] [--manifest podklady/docs.csv]
    python -m etl.pdf_text --from-db [--dry-run] [--no-ocr] [--only <object_ref>]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import psycopg

from . import project as project_mod
from .config import database_url, project_code
from .ocr import ocr_page, ocr_unavailable

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"

_WS_RE = re.compile(r"\s+")


@dataclass
class PdfRow:
    source_path: str
    container_name: str  # object_ref of the document (E3)


def _load_pdf_rows(manifest: Path) -> list[PdfRow]:
    """All manifest rows with a PDF source (drawings and other documents)."""
    out: list[PdfRow] = []
    with manifest.open(encoding="utf-8-sig", newline="") as fh:
        # filter `#` comments like doc_upload/pdf_link - the first manifest line
        # is a comment and without the filter it would become the header (0 processed PDFs).
        for r in csv.DictReader(line for line in fh if not line.startswith("#")):
            src = (r.get("source_path") or "").strip()
            cn = (r.get("container_name") or "").strip()
            if src.lower().endswith(".pdf") and cn:
                out.append(PdfRow(src, cn))
    return out


def _doc_id(cur, container_name: str) -> Optional[str]:
    cur.execute(
        "select id from objects where object_ref = %s and object_type = 'document'",
        (container_name,),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def extract_pages(pdf_path: Path) -> list[tuple[int, str]]:
    """(page number 1-based, normalized text) for non-empty pages."""
    return [(n, text) for n, text, _ in extract_pages_with_blocks(pdf_path)]


def _pct(v: float, size: float) -> float:
    return round(min(max(v / size * 100.0, 0.0), 100.0), 2) if size > 0 else 0.0


def page_blocks(page_dict: dict, width: float, height: float) -> list[dict]:
    """Text lines of the page with bbox in % of the page (D-123).

    Input is `page.get_text("dict")`; a line = the joined spans of one `line`.
    Output `{t, x, y, w, h}` (x/y = top left corner), empty lines skipped.
    """
    out: list[dict] = []
    for block in page_dict.get("blocks", []):
        if block.get("type", 0) != 0:  # 0 = text, 1 = image
            continue
        for line in block.get("lines", []):
            text = _WS_RE.sub(" ", "".join(s.get("text", "") for s in line.get("spans", []))).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line["bbox"]
            out.append(
                {
                    "t": text,
                    "x": _pct(x0, width),
                    "y": _pct(y0, height),
                    "w": round(_pct(x1, width) - _pct(x0, width), 2),
                    "h": round(_pct(y1, height) - _pct(y0, height), 2),
                }
            )
    return out


# D-133: thick lines (cut structures) from this width; thin ones are dimensions, hatches, axes.
LINE_MIN_WIDTH = 0.99
# #283/#316: fire safety floor plans (PBR) and some exports draw walls thinner than 0.99 pt, so when
# thick lines are lacking, progressively lower thresholds are tried (the first that gives at least LINE_MIN_COUNT segments).
LINE_WIDTH_TIERS = (LINE_MIN_WIDTH, 0.5, 0.25)
# A page with fewer segments is not a vector drawing (report, table, scan) -> lines = null.
LINE_MIN_COUNT = 200


def _segments(drawings: list[dict], min_width: float, height: float) -> list[list[float]]:
    """Line segments (`l`), sides of rectangles (`re`) and quadrilaterals (`qu`) from `min_width`."""
    out: list[list[float]] = []

    def add(x1: float, y1: float, x2: float, y2: float, w: float) -> None:
        a = [round(x1, 1), round(height - y1, 1), round(x2, 1), round(height - y2, 1)]
        if a[:2] != a[2:]:
            out.append(a + [round(w, 2)])

    for d in drawings:
        w = d.get("width") or 0.0
        if w < min_width:
            continue
        for item in d.get("items", []):
            if item[0] == "l":
                add(item[1].x, item[1].y, item[2].x, item[2].y, w)
            elif item[0] == "re":
                r = item[1]
                add(r.x0, r.y0, r.x1, r.y0, w)
                add(r.x1, r.y0, r.x1, r.y1, w)
                add(r.x1, r.y1, r.x0, r.y1, w)
                add(r.x0, r.y1, r.x0, r.y0, w)
            elif item[0] == "qu":
                q = item[1]
                for a, b in ((q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)):
                    add(a.x, a.y, b.x, b.y, w)
    return out


def page_lines(drawings: list[dict], width: float, height: float) -> Optional[dict]:
    """Thick line segments of the page for underlay calibration (D-133).

    Input is `page.get_drawings()`; lines (`l`) and sides of rectangles (`re`, `qu`) from
    `LINE_MIN_WIDTH`, curves are skipped (door arcs). If there are fewer than `LINE_MIN_COUNT`,
    lower thresholds from `LINE_WIDTH_TIERS` are tried (thinner lines, #283). Output `{size: [W, H],
    segs: [[x1, y1, x2, y2, w]], min_w}` in page points with origin bottom left (y up, like
    `_georef` D-072), rounded to 0.1 pt; `size` is the frame in which the calibration computes,
    `min_w` the width threshold used. If no threshold gives enough segments = not a drawing, returns None.
    """
    for min_w in LINE_WIDTH_TIERS:
        out = _segments(drawings, min_w, height)
        if len(out) >= LINE_MIN_COUNT:
            return {"size": [round(width, 2), round(height, 2)], "segs": out, "min_w": min_w}
    return None


# Page without a text layer: what it has instead of text (#279, follows up on #238).
TEXTLESS_IMAGE = "obrázok"  # text is a raster image (scan, CCITT/JBIG2 mask) -> OCR only
TEXTLESS_VECTOR = "krivky"  # text converted to curves (many vector strokes without a font)
TEXTLESS_EMPTY = "prázdna"
# A page with this many vector items and no text is probably text as curves, not a blank sheet.
TEXTLESS_VECTOR_MIN = 50
# D-169: these pages are rasterized and read by OCR; an empty page is not.
OCR_KINDS = (TEXTLESS_IMAGE, TEXTLESS_VECTOR)


def _page_text(page: fitz.Page) -> str:
    return _WS_RE.sub(" ", page.get_text("text")).strip()


def _textless_kind(page: fitz.Page) -> str:
    """Page without text: image, curves or empty (#279)."""
    if page.get_images(full=True):
        return TEXTLESS_IMAGE
    if len(page.get_drawings()) >= TEXTLESS_VECTOR_MIN:
        return TEXTLESS_VECTOR
    return TEXTLESS_EMPTY


def extract_pages_full(pdf_path: Path, ocr: bool = False) -> list[tuple[int, str, list[dict], Optional[dict]]]:
    """(page, text, lines with position, thick lines or None) for non-empty pages.

    `ocr=True` (D-169): a page without a text layer of type image or curves is read by OCR; its
    lines have `src: "ocr"` and `conf`. A page with a text layer does not go to OCR. When OCR is not
    installed or the page fails, it stays without text as before D-169.
    """
    use_ocr = ocr and ocr_unavailable() is None
    pages: list[tuple[int, str, list[dict], Optional[dict]]] = []
    with fitz.open(pdf_path) as doc:
        for i, page in enumerate(doc, start=1):
            rect = page.rect
            text = _page_text(page)
            if text:
                blocks = page_blocks(page.get_text("dict"), rect.width, rect.height)
                pages.append((i, text, blocks, page_lines(page.get_drawings(), rect.width, rect.height)))
                continue
            if not use_ocr or _textless_kind(page) not in OCR_KINDS:
                continue
            try:
                res = ocr_page(page)
            except Exception as exc:  # noqa: BLE001 - one bad page does not fail the document
                print(f"    ! OCR strany {i} zlyhalo ({exc})")
                continue
            if res is not None:
                pages.append((i, res.text, res.blocks, page_lines(page.get_drawings(), rect.width, rect.height)))
    return pages


def textless_pages(pdf_path: Path) -> dict[int, str]:
    """Pages WITHOUT a text layer and the reason: image, curves or empty (#279).

    Without OCR, `search_documents` reports "Strana nemá text" for such pages; image and curves
    are read by OCR (D-169, `extract_pages_full(ocr=True)`), an empty page stays without text.
    """
    with fitz.open(pdf_path) as doc:
        return {i: _textless_kind(page) for i, page in enumerate(doc, start=1) if not _page_text(page)}


def page_sizes(pdf_path: Path) -> dict[int, list[float]]:
    """D-158: [width, height] of each page in points (the displayed page, with rotation)."""
    with fitz.open(pdf_path) as doc:
        return {i: [round(p.rect.width, 2), round(p.rect.height, 2)] for i, p in enumerate(doc, start=1)}


def file_sha256(pdf_path: Path) -> str:
    """D-158: sha256 of the PDF file (document revision anchor)."""
    h = hashlib.sha256()
    with pdf_path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_pages_with_blocks(pdf_path: Path) -> list[tuple[int, str, list[dict]]]:
    """(page 1-based, normalized text, lines with position) for non-empty pages."""
    return [(n, text, blocks) for n, text, blocks, _ in extract_pages_full(pdf_path)]


@dataclass
class DbDoc:
    id: str
    object_ref: str
    location: str


def _db_docs(cur, only: Optional[str], project_id: str = project_mod.OCB_ID) -> list[DbDoc]:
    """Live documents with a PDF in the project storage (D-123, D-189); `only` = one object_ref."""
    sql = (
        "select o.id, o.object_ref, d.location from objects o "
        "join documents d on d.id = o.id "
        "where o.object_type = 'document' and o.valid_until is null and o.project_id = %s "
        "and d.location ilike 'http%%' and d.location ilike '%%.pdf'"
    )
    params: tuple = (project_id,)
    if only:
        sql += " and o.object_ref = %s"
        params = (project_id, only)
    cur.execute(sql + " order by o.object_ref", params)
    return [DbDoc(str(r[0]), r[1], r[2]) for r in cur.fetchall()]


Page = tuple[int, str, list[dict], Optional[dict]]


def _write_pages(
    cur,
    doc_id: str,
    pages: list[Page],
    sizes: Optional[dict[int, list[float]]] = None,
    sha256: Optional[str] = None,
) -> None:
    # Idempotency: full refresh of the document's pages.
    cur.execute("delete from document_pages where document_id = %s", (doc_id,))
    for page_no, text, blocks, lines in pages:
        size = (sizes or {}).get(page_no)
        cur.execute(
            "insert into document_pages (document_id, page, text, blocks, lines, page_size) "
            "values (%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)",
            (
                doc_id,
                page_no,
                text,
                json.dumps(blocks, ensure_ascii=False),
                json.dumps(lines, separators=(",", ":")) if lines is not None else None,
                json.dumps(size) if size is not None else None,
            ),
        )
    if sha256:
        cur.execute("update documents set file_sha256 = %s where id = %s", (sha256, doc_id))


def index_pdf(cur, doc_id: str, pdf_path: Path, ocr: bool = True) -> int:
    """Extract one PDF and write to `document_pages` (text, lines, line segments, size, sha256).

    Called by `etl.doc_upload` right after a document is uploaded, so that the drawing lines (underlay
    calibration, #283/#316) do not have to be filled in by hand via `--from-db`. Pages without a text layer
    are read by OCR (D-169), unless `ocr=False`. Returns the number of pages with text.
    """
    pages = extract_pages_full(pdf_path, ocr=ocr)
    _write_pages(cur, doc_id, pages, page_sizes(pdf_path), file_sha256(pdf_path))
    return len(pages)


def is_ocr_page(page: Page) -> bool:
    """Page read by OCR (D-169): its lines carry `src: "ocr"`."""
    return bool(page[2]) and page[2][0].get("src") == "ocr"


def _report_textless(pdf_path: Path, pages: list[Page], dry_run: bool) -> int:
    """Pages without a text layer (image / curves) and what OCR does with them (D-169, #279).

    Returns the number of pages that go (with `dry_run`, would go) to OCR.
    """
    ocr_done = {p[0] for p in pages if is_ocr_page(p)}
    textless = textless_pages(pdf_path)
    for kind in OCR_KINDS:
        nums = [n for n, k in textless.items() if k == kind]
        if nums:
            shown = ", ".join(map(str, nums[:15])) + (" ..." if len(nums) > 15 else "")
            done = "" if dry_run else f", OCR prečítalo {len([n for n in nums if n in ocr_done])}"
            print(f"    bez textovej vrstvy ({kind}): {len(nums)} strán: {shown}{done}")
    return sum(1 for k in textless.values() if k in OCR_KINDS)


def _ocr_banner(ocr: bool, dry_run: bool) -> None:
    """At the start of the run: whether OCR runs and why not (D-169)."""
    if not ocr:
        print("OCR vypnuté (--no-ocr): strany bez textovej vrstvy ostanú bez textu.")
    elif dry_run:
        print("--dry-run: OCR sa nespúšťa, len sa spočítajú strany, ktoré by doňho išli.")
    elif (reason := ocr_unavailable()) is not None:
        print(f"! OCR nedostupné: {reason}. Strany bez textovej vrstvy ostanú bez textu (D-169).")


def _ocr_summary(candidates: int, ocr: bool, dry_run: bool) -> None:
    if candidates and (dry_run or not ocr or ocr_unavailable() is not None):
        print(f"Do OCR by išlo: {candidates} strán (obrázok / krivky).")


def _report(ref: str, pages: list[Page]) -> None:
    total_chars = sum(len(p[1]) for p in pages)
    lines = sum(len(p[2]) for p in pages)
    segs = sum(len((p[3] or {}).get("segs", [])) for p in pages)
    ocr = sum(1 for p in pages if is_ocr_page(p))
    print(
        f"  {ref:46s} strán s textom {len(pages):3d}  znakov {total_chars:7d}  riadkov {lines:5d}"
        f"  čiar {segs:6d}" + (f"  z OCR {ocr:3d}" if ocr else "")
    )


def run_from_db(dry_run: bool, only: Optional[str], ocr: bool = True,
                code: str = project_mod.OCB_CODE) -> int:
    """D-123: text of all live PDF documents from storage (not from the manifest)."""
    conn = psycopg.connect(database_url())
    written_docs = written_pages = ocr_candidates = 0
    _ocr_banner(ocr, dry_run)
    skipped: list[str] = []
    try:
        cur = conn.cursor()
        docs = _db_docs(cur, only, project_mod.require(cur, code))
        print(f"Živé PDF dokumenty v DB: {len(docs)}")
        with tempfile.TemporaryDirectory() as tmp:
            for d in docs:
                pdf_path = Path(tmp) / "doc.pdf"
                try:
                    with urllib.request.urlopen(d.location, timeout=60) as resp:
                        pdf_path.write_bytes(resp.read())
                    pages = extract_pages_full(pdf_path, ocr=ocr and not dry_run)
                    sizes = page_sizes(pdf_path)
                    sha = file_sha256(pdf_path)
                except Exception as exc:  # noqa: BLE001 - one bad file does not fail the run
                    skipped.append(f"{d.object_ref} ({exc})")
                    continue
                _report(d.object_ref, pages)
                ocr_candidates += _report_textless(pdf_path, pages, dry_run)
                if dry_run:
                    continue
                _write_pages(cur, d.id, pages, sizes, sha)
                written_docs += 1
                written_pages += len(pages)
        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    if skipped:
        print("Preskočené:")
        for s in skipped:
            print(f"  - {s}")
    _ocr_summary(ocr_candidates, ocr, dry_run)
    if not dry_run:
        print(f"Zapísané: {written_docs} dokumentov / {written_pages} strán.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Extrakcia textu PDF → document_pages (D-063)")
    ap.add_argument("--manifest", type=Path, default=_MANIFEST, help="cesta k docs.csv")
    ap.add_argument("--source-root", type=Path, default=_SOURCE_ROOT, help="koreň PDF zdrojov")
    ap.add_argument("--dry-run", action="store_true", help="len extrakcia + report, bez zápisu")
    ap.add_argument(
        "--from-db",
        action="store_true",
        help="D-123: živé dokumenty z DB, PDF zo storage (location), nie z manifestu",
    )
    ap.add_argument("--only", help="s --from-db: len dokument s týmto object_ref")
    ap.add_argument(
        "--no-ocr",
        action="store_true",
        help="D-169: strany bez textovej vrstvy (obrázok, krivky) nečítať OCR",
    )
    ap.add_argument("--project", metavar="CODE", help="project code (D-189); default env AIM_PROJECT or OCB")
    args = ap.parse_args(argv)
    ocr = not args.no_ocr
    code = project_code(args.project)

    if args.from_db:
        return run_from_db(args.dry_run, args.only, ocr, code)

    rows = _load_pdf_rows(args.manifest)
    print(f"PDF v manifeste: {len(rows)}")
    if not rows:
        return 0

    conn = None if args.dry_run else psycopg.connect(database_url())
    written_docs = 0
    written_pages = 0
    ocr_candidates = 0
    skipped: list[str] = []
    _ocr_banner(ocr, args.dry_run)
    try:
        cur = conn.cursor() if conn else None
        for row in rows:
            pdf_path = args.source_root / row.source_path
            if not pdf_path.exists():
                skipped.append(f"{row.container_name} (PDF chýba: {row.source_path})")
                continue
            pages = extract_pages_full(pdf_path, ocr=ocr and not args.dry_run)
            _report(row.container_name, pages)
            ocr_candidates += _report_textless(pdf_path, pages, args.dry_run)
            if cur is None:
                continue
            doc_id = _doc_id(cur, project_mod.qualify(row.container_name, code))
            if doc_id is None:
                skipped.append(f"{row.container_name} (nie je v DB — najprv doc_upload/E3)")
                continue
            _write_pages(cur, doc_id, pages, page_sizes(pdf_path), file_sha256(pdf_path))
            written_docs += 1
            written_pages += len(pages)
        if conn:
            conn.commit()
    finally:
        if conn:
            conn.close()

    if skipped:
        print("Preskočené:")
        for s in skipped:
            print(f"  - {s}")
    _ocr_summary(ocr_candidates, ocr, args.dry_run)
    if not args.dry_run:
        print(f"Zapísané: {written_docs} dokumentov / {written_pages} strán.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
