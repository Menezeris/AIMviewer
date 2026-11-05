"""OCR of PDF pages without a text layer (D-169, #279).

A rescue, not a replacement: `etl/pdf_text.py` sends here only a page that has no text layer and
that the diagnostics (#279) marked as `obrázok` (a scan, CCITT/JBIG2 mask) or `krivky` (text
converted to vector strokes). The page is rendered to a raster (PyMuPDF), Tesseract reads
words from it with position and confidence, and these are assembled into lines in the `blocks` shape (D-123): `{t, x,
y, w, h}` in % of the page, origin top left, plus `src: "ocr"` and `conf` (0 to 1). This way `regions` and the
`open_drawing highlights` frames work the same as with a text layer.

Dependencies: Tesseract 5 (Apache-2.0) with the languages ces, slk, eng (traineddata Apache-2.0) and
pytesseract (Apache-2.0), which pulls in Pillow (MIT-CMU). When something is missing, `ocr_unavailable()`
says what, and the ETL leaves the pages without text as before; the run does not fail.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional

import fitz  # PyMuPDF

# Czech first: the source documents are from VUT Brno and with `slk` first Tesseract reads "BRNĚ" as "BRNÉ".
OCR_LANG = os.environ.get("AIM_OCR_LANG", "ces+slk+eng")
OCR_DPI = 300
# Raster cap (pixels): an A1 drawing at 300 dpi is ~70 MP, Tesseract would run for minutes.
OCR_MAX_PIXELS = 30_000_000
# A line with a lower average confidence is noise (logo, hatching, stamp), not text.
OCR_MIN_LINE_CONF = 50

_WS_RE = re.compile(r"\s+")


@dataclass
class OcrPage:
    text: str
    blocks: list[dict]
    conf: float  # page confidence 0 to 1 (average of the lines weighted by text length)


_unavailable: Optional[str] = None
_checked = False


def ocr_unavailable() -> Optional[str]:
    """None = OCR works; otherwise the reason (pytesseract, Tesseract or a language is missing)."""
    global _checked, _unavailable
    if _checked:
        return _unavailable
    _checked = True
    try:
        import pytesseract

        langs = set(pytesseract.get_languages(config=""))
    except ImportError:
        _unavailable = "chýba balík pytesseract (pip install -r etl/requirements.txt)"
        return _unavailable
    except Exception as exc:  # noqa: BLE001 - TesseractNotFoundError and the like
        _unavailable = f"Tesseract nie je nainštalovaný ({exc.__class__.__name__})"
        return _unavailable
    missing = [lang for lang in OCR_LANG.split("+") if lang not in langs]
    if missing:
        _unavailable = f"Tesseractu chýbajú jazyky {', '.join(missing)} (tesseract-ocr-{missing[0]})"
    return _unavailable


def _dpi(page: fitz.Page) -> int:
    """OCR_DPI, lower for a large page so that the raster does not exceed OCR_MAX_PIXELS."""
    area_in2 = (page.rect.width / 72.0) * (page.rect.height / 72.0)
    if area_in2 <= 0:
        return OCR_DPI
    return max(72, min(OCR_DPI, int((OCR_MAX_PIXELS / area_in2) ** 0.5)))


def _pct(v: float, size: float) -> float:
    return round(min(max(v / size * 100.0, 0.0), 100.0), 2) if size > 0 else 0.0


def lines_from_data(data: dict, img_w: int, img_h: int, min_conf: float = OCR_MIN_LINE_CONF) -> list[dict]:
    """Words from `pytesseract.image_to_data` (DICT) -> lines `{t, x, y, w, h, src, conf}` in % of the page.

    A line = words with the same (block_num, par_num, line_num); a word with conf < 0 is not text.
    A line with an average confidence below `min_conf` is dropped. The order is as Tesseract reads.
    """
    rows: dict[tuple[int, int, int], list[int]] = {}
    for i, word in enumerate(data.get("text", [])):
        if not str(word).strip() or float(data["conf"][i]) < 0:
            continue
        key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
        rows.setdefault(key, []).append(i)
    out: list[dict] = []
    for idx in rows.values():
        text = _WS_RE.sub(" ", " ".join(str(data["text"][i]) for i in idx)).strip()
        conf = sum(float(data["conf"][i]) for i in idx) / len(idx)
        if not text or conf < min_conf:
            continue
        x0 = min(int(data["left"][i]) for i in idx)
        y0 = min(int(data["top"][i]) for i in idx)
        x1 = max(int(data["left"][i]) + int(data["width"][i]) for i in idx)
        y1 = max(int(data["top"][i]) + int(data["height"][i]) for i in idx)
        out.append(
            {
                "t": text,
                "x": _pct(x0, img_w),
                "y": _pct(y0, img_h),
                "w": round(_pct(x1, img_w) - _pct(x0, img_w), 2),
                "h": round(_pct(y1, img_h) - _pct(y0, img_h), 2),
                "src": "ocr",
                "conf": round(conf / 100.0, 2),
            }
        )
    return out


def page_conf(blocks: list[dict]) -> float:
    """Page confidence: the average `conf` of the lines weighted by text length."""
    total = sum(len(b["t"]) for b in blocks)
    return round(sum(b["conf"] * len(b["t"]) for b in blocks) / total, 2) if total else 0.0


def ocr_page(page: fitz.Page) -> Optional[OcrPage]:
    """Renders the page and reads it with Tesseract; None when nothing legible is on it."""
    import pytesseract
    from PIL import Image

    # The displayed page (with rotation), the same as the text-layer bbox in `page_blocks`.
    pix = page.get_pixmap(dpi=_dpi(page), colorspace=fitz.csGRAY, alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    data = pytesseract.image_to_data(img, lang=OCR_LANG, output_type=pytesseract.Output.DICT)
    blocks = lines_from_data(data, pix.width, pix.height)
    if not blocks:
        return None
    return OcrPage(" ".join(b["t"] for b in blocks), blocks, page_conf(blocks))
