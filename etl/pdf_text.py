"""Extrakcia textu PDF dokumentov → `document_pages` (D-063).

Dopĺňa E4 (`pdf_link.py` — väzby prvok↔výkres z obsahu): tu sa z KAŽDÉHO PDF
v manifeste (`docs.csv`, nie len výkresy VD) extrahuje text per strana, aby LLM
vedel vyhľadávať v OBSAHU dokumentov (RPC `search_documents`, migrácia
`20260715120000`). Rovnaký vstupný kontrakt ako E4: `source_path` = cesta k PDF
pod `podklady/FINAL`, `container_name` = `object_ref` dokumentu v DB (E3).

PyMuPDF (`fitz`) — už je ETL závislosť (D-041). Extrakcia je
`page.get_text("text")` + normalizácia bielych znakov; vektorové výkresy majú
riedky text (legendy, pečiatky) a to je očakávané. Prázdne strany sa nevkladajú.

D-169 (mení D-123 bod 7): strana BEZ textovej vrstvy, ktorú diagnostika (#279)
označí ako `obrázok` alebo `krivky`, sa prečíta OCR (`etl/ocr.py`, Tesseract
ces+slk+eng). Riadky z OCR majú v `blocks` navyše `src: "ocr"` a `conf`; strany
s textovou vrstvou do OCR nejdú nikdy. Predvolene zapnuté, `--no-ocr` ho vypne,
`--dry-run` len spočíta strany, ktoré by do OCR išli.

Idempotentné: per dokument `DELETE` + `INSERT` v jednej transakcii — opakovaný
beh = rovnaký stav. Dokument, ktorý nie je v DB (chýba E3 upload), sa preskočí
s warningom, beh nezhodí.

D-123: dokumenty z IFC (D-104) v manifeste nie sú a ich PDF ležia v buckete
`documents`, preto `--from-db` berie živé dokumenty priamo z DB (`valid_until is
null`, `documents.location` = URL PDF) a PDF stiahne. Okrem textu strany sa
ukladajú riadky textu s polohou (`blocks`, bbox v % strany, počiatok vľavo
hore), aby tool vedel povedať, KDE na strane text je (výrez pre open_drawing
region, D-117).

D-133: pri vektorových výkresoch sa ukladajú aj hrubé čiary strany (`lines` =
`{size: [W, H], segs: [[x1, y1, x2, y2, w]]}` v bodoch strany, počiatok vľavo dole), z ktorých IFC motor
kalibruje podklad (pôdorys, rez) na rez modelom.

D-158 (kroky 3 a 4): každá strana dostane `page_size` = [šírka, výška] v bodoch
(zobrazená strana, s rotáciou; RFC 8118 viewrect odkazu na stranu) a dokument
`documents.file_sha256` = sha256 súboru PDF (kotva revízie, kľúč keše snímky
výrezu). Rastre strán sa nerobia, snímka sa renderuje v hoste na požiadanie.

Spustenie (z koreňa repa):
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

from .config import database_url
from .ocr import ocr_page, ocr_unavailable

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SOURCE_ROOT = _REPO_ROOT / "podklady" / "FINAL"
_MANIFEST = _REPO_ROOT / "podklady" / "docs.csv"

_WS_RE = re.compile(r"\s+")


@dataclass
class PdfRow:
    source_path: str
    container_name: str  # object_ref dokumentu (E3)


def _load_pdf_rows(manifest: Path) -> list[PdfRow]:
    """Všetky riadky manifestu s PDF zdrojom (výkresy aj ostatné dokumenty)."""
    out: list[PdfRow] = []
    with manifest.open(encoding="utf-8-sig", newline="") as fh:
        # `#` komentáre filtrovať ako doc_upload/pdf_link — prvý riadok manifestu
        # je komentár a bez filtra by sa stal hlavičkou (0 spracovaných PDF).
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
    """(číslo strany 1-based, normalizovaný text) pre neprázdne strany."""
    return [(n, text) for n, text, _ in extract_pages_with_blocks(pdf_path)]


def _pct(v: float, size: float) -> float:
    return round(min(max(v / size * 100.0, 0.0), 100.0), 2) if size > 0 else 0.0


def page_blocks(page_dict: dict, width: float, height: float) -> list[dict]:
    """Riadky textu strany s bbox v % strany (D-123).

    Vstup je `page.get_text("dict")`; riadok = spojené spany jedného `line`.
    Výstup `{t, x, y, w, h}` (x/y = ľavý horný roh), prázdne riadky vynechané.
    """
    out: list[dict] = []
    for block in page_dict.get("blocks", []):
        if block.get("type", 0) != 0:  # 0 = text, 1 = obrázok
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


# D-133: hrubé čiary (rezané konštrukcie) od tejto hrúbky; tenké sú kóty, šrafy, osi.
LINE_MIN_WIDTH = 0.99
# #283/#316: požiarne pôdorysy (PBR) a niektoré exporty kreslia steny tenšie než 0,99 pt, preto sa pri
# nedostatku hrubých čiar skúšajú postupne nižšie prahy (prvý, ktorý dá aspoň LINE_MIN_COUNT úsečiek).
LINE_WIDTH_TIERS = (LINE_MIN_WIDTH, 0.5, 0.25)
# Strana s menej úsečkami nie je vektorový výkres (správa, tabuľka, sken) -> lines = null.
LINE_MIN_COUNT = 200


def _segments(drawings: list[dict], min_width: float, height: float) -> list[list[float]]:
    """Úsečky (`l`), strany obdĺžnikov (`re`) a štvoruholníkov (`qu`) od `min_width`."""
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
    """Hrubé úsečky strany pre kalibráciu podkladu (D-133).

    Vstup je `page.get_drawings()`; čiary (`l`) a strany obdĺžnikov (`re`, `qu`) od
    `LINE_MIN_WIDTH`, krivky sa vynechajú (oblúky dverí). Ak ich je menej než `LINE_MIN_COUNT`,
    skúšajú sa nižšie prahy z `LINE_WIDTH_TIERS` (tenšie čiary, #283). Výstup `{size: [W, H],
    segs: [[x1, y1, x2, y2, w]], min_w}` v bodoch strany s počiatkom vľavo dole (y hore, ako
    `_georef` D-072), zaokrúhlené na 0,1 pt; `size` je rámec, v ktorom kalibrácia počíta,
    `min_w` použitý prah hrúbky. Pri žiadnom prahu s dosť úsečkami = nie výkres, vráti None.
    """
    for min_w in LINE_WIDTH_TIERS:
        out = _segments(drawings, min_w, height)
        if len(out) >= LINE_MIN_COUNT:
            return {"size": [round(width, 2), round(height, 2)], "segs": out, "min_w": min_w}
    return None


# Strana bez textovej vrstvy: čo na nej namiesto textu je (#279, nadväzuje na #238).
TEXTLESS_IMAGE = "obrázok"  # text je rastrový obrázok (sken, CCITT/JBIG2 maska) -> len OCR
TEXTLESS_VECTOR = "krivky"  # text prevedený na krivky (veľa vektorových ťahov bez písma)
TEXTLESS_EMPTY = "prázdna"
# Strana s toľkými vektorovými prvkami bez textu je pravdepodobne text na krivkách, nie čistý list.
TEXTLESS_VECTOR_MIN = 50
# D-169: tieto strany sa rasterizujú a čítajú OCR; prázdna strana nie.
OCR_KINDS = (TEXTLESS_IMAGE, TEXTLESS_VECTOR)


def _page_text(page: fitz.Page) -> str:
    return _WS_RE.sub(" ", page.get_text("text")).strip()


def _textless_kind(page: fitz.Page) -> str:
    """Strana bez textu: obrázok, krivky alebo prázdna (#279)."""
    if page.get_images(full=True):
        return TEXTLESS_IMAGE
    if len(page.get_drawings()) >= TEXTLESS_VECTOR_MIN:
        return TEXTLESS_VECTOR
    return TEXTLESS_EMPTY


def extract_pages_full(pdf_path: Path, ocr: bool = False) -> list[tuple[int, str, list[dict], Optional[dict]]]:
    """(strana, text, riadky s polohou, hrubé čiary alebo None) pre neprázdne strany.

    `ocr=True` (D-169): stranu bez textovej vrstvy typu obrázok alebo krivky prečíta OCR; jej
    riadky majú `src: "ocr"` a `conf`. Strana s textovou vrstvou do OCR nejde. Keď OCR nie je
    nainštalované alebo strana zlyhá, ostane bez textu ako pred D-169.
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
            except Exception as exc:  # noqa: BLE001 - jedna zlá strana nezhodí dokument
                print(f"    ! OCR strany {i} zlyhalo ({exc})")
                continue
            if res is not None:
                pages.append((i, res.text, res.blocks, page_lines(page.get_drawings(), rect.width, rect.height)))
    return pages


def textless_pages(pdf_path: Path) -> dict[int, str]:
    """Strany BEZ textovej vrstvy a dôvod: obrázok, krivky alebo prázdna (#279).

    `search_documents` o takých stranách bez OCR hlási "Strana nemá text"; obrázok a krivky
    číta OCR (D-169, `extract_pages_full(ocr=True)`), prázdna strana ostáva bez textu.
    """
    with fitz.open(pdf_path) as doc:
        return {i: _textless_kind(page) for i, page in enumerate(doc, start=1) if not _page_text(page)}


def page_sizes(pdf_path: Path) -> dict[int, list[float]]:
    """D-158: [šírka, výška] každej strany v bodoch (zobrazená strana, s rotáciou)."""
    with fitz.open(pdf_path) as doc:
        return {i: [round(p.rect.width, 2), round(p.rect.height, 2)] for i, p in enumerate(doc, start=1)}


def file_sha256(pdf_path: Path) -> str:
    """D-158: sha256 súboru PDF (kotva revízie dokumentu)."""
    h = hashlib.sha256()
    with pdf_path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_pages_with_blocks(pdf_path: Path) -> list[tuple[int, str, list[dict]]]:
    """(strana 1-based, normalizovaný text, riadky s polohou) pre neprázdne strany."""
    return [(n, text, blocks) for n, text, blocks, _ in extract_pages_full(pdf_path)]


@dataclass
class DbDoc:
    id: str
    object_ref: str
    location: str


def _db_docs(cur, only: Optional[str]) -> list[DbDoc]:
    """Živé dokumenty s PDF v storage (D-123); `only` = jeden object_ref."""
    sql = (
        "select o.id, o.object_ref, d.location from objects o "
        "join documents d on d.id = o.id "
        "where o.object_type = 'document' and o.valid_until is null "
        "and d.location ilike 'http%%' and d.location ilike '%%.pdf'"
    )
    params: tuple = ()
    if only:
        sql += " and o.object_ref = %s"
        params = (only,)
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
    # Idempotencia: plný refresh strán dokumentu.
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
    """Extrakcia jedného PDF a zápis do `document_pages` (text, riadky, čiary, rozmer, sha256).

    Volá ho `etl.doc_upload` hneď po nahratí dokumentu, aby sa čiary výkresu (kalibrácia
    podkladu, #283/#316) nemuseli dopĺňať ručne cez `--from-db`. Strany bez textovej vrstvy
    číta OCR (D-169), ak nie je `ocr=False`. Vráti počet strán s textom.
    """
    pages = extract_pages_full(pdf_path, ocr=ocr)
    _write_pages(cur, doc_id, pages, page_sizes(pdf_path), file_sha256(pdf_path))
    return len(pages)


def is_ocr_page(page: Page) -> bool:
    """Strana prečítaná OCR (D-169): jej riadky nesú `src: "ocr"`."""
    return bool(page[2]) and page[2][0].get("src") == "ocr"


def _report_textless(pdf_path: Path, pages: list[Page], dry_run: bool) -> int:
    """Strany bez textovej vrstvy (obrázok / krivky) a čo s nimi OCR (D-169, #279).

    Vráti počet strán, ktoré idú (pri `dry_run` by išli) do OCR.
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
    """Na začiatku behu: či OCR beží a prečo nie (D-169)."""
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


def run_from_db(dry_run: bool, only: Optional[str], ocr: bool = True) -> int:
    """D-123: text všetkých živých PDF dokumentov zo storage (nie z manifestu)."""
    conn = psycopg.connect(database_url())
    written_docs = written_pages = ocr_candidates = 0
    _ocr_banner(ocr, dry_run)
    skipped: list[str] = []
    try:
        cur = conn.cursor()
        docs = _db_docs(cur, only)
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
                except Exception as exc:  # noqa: BLE001 - jeden zlý súbor nezhodí beh
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
    args = ap.parse_args(argv)
    ocr = not args.no_ocr

    if args.from_db:
        return run_from_db(args.dry_run, args.only, ocr)

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
            doc_id = _doc_id(cur, row.container_name)
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
