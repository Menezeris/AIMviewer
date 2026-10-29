"""OCR strán PDF bez textovej vrstvy (D-169, #279).

Záchrana, nie náhrada: `etl/pdf_text.py` sem pošle len stranu, ktorá nemá textovú vrstvu a
diagnostika (#279) ju označila ako `obrázok` (sken, CCITT/JBIG2 maska) alebo `krivky` (text
prevedený na vektorové ťahy). Strana sa vyrenderuje do rastra (PyMuPDF), Tesseract z nej
prečíta slová s polohou a istotou a tie sa zložia do riadkov v tvare `blocks` (D-123): `{t, x,
y, w, h}` v % strany, počiatok vľavo hore, navyše `src: "ocr"` a `conf` (0 až 1). Tak fungujú
`regions` aj rámiky `open_drawing highlights` rovnako ako pri textovej vrstve.

Závislosti: Tesseract 5 (Apache-2.0) s jazykmi ces, slk, eng (traineddata Apache-2.0) a
pytesseract (Apache-2.0), ktorý ťahá Pillow (MIT-CMU). Keď niečo chýba, `ocr_unavailable()`
povie čo a ETL strany nechá bez textu ako doteraz, beh nespadne.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional

import fitz  # PyMuPDF

# Čeština prvá: podklady sú z VUT Brno a pri `slk` prvom Tesseract číta "BRNĚ" ako "BRNÉ".
OCR_LANG = os.environ.get("AIM_OCR_LANG", "ces+slk+eng")
OCR_DPI = 300
# Strop rastra (pixely): výkres A1 pri 300 dpi má ~70 MP, Tesseract by bežal minúty.
OCR_MAX_PIXELS = 30_000_000
# Riadok s nižšou priemernou istotou je šum (logo, šrafa, pečiatka), nie text.
OCR_MIN_LINE_CONF = 50

_WS_RE = re.compile(r"\s+")


@dataclass
class OcrPage:
    text: str
    blocks: list[dict]
    conf: float  # istota strany 0 až 1 (priemer riadkov vážený dĺžkou textu)


_unavailable: Optional[str] = None
_checked = False


def ocr_unavailable() -> Optional[str]:
    """None = OCR beží; inak dôvod (chýba pytesseract, Tesseract alebo jazyk)."""
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
    except Exception as exc:  # noqa: BLE001 - TesseractNotFoundError a spol.
        _unavailable = f"Tesseract nie je nainštalovaný ({exc.__class__.__name__})"
        return _unavailable
    missing = [lang for lang in OCR_LANG.split("+") if lang not in langs]
    if missing:
        _unavailable = f"Tesseractu chýbajú jazyky {', '.join(missing)} (tesseract-ocr-{missing[0]})"
    return _unavailable


def _dpi(page: fitz.Page) -> int:
    """OCR_DPI, pri veľkej strane menej, aby raster nepresiahol OCR_MAX_PIXELS."""
    area_in2 = (page.rect.width / 72.0) * (page.rect.height / 72.0)
    if area_in2 <= 0:
        return OCR_DPI
    return max(72, min(OCR_DPI, int((OCR_MAX_PIXELS / area_in2) ** 0.5)))


def _pct(v: float, size: float) -> float:
    return round(min(max(v / size * 100.0, 0.0), 100.0), 2) if size > 0 else 0.0


def lines_from_data(data: dict, img_w: int, img_h: int, min_conf: float = OCR_MIN_LINE_CONF) -> list[dict]:
    """Slová z `pytesseract.image_to_data` (DICT) -> riadky `{t, x, y, w, h, src, conf}` v % strany.

    Riadok = slová s rovnakým (block_num, par_num, line_num); slovo s conf < 0 nie je text.
    Riadok s priemernou istotou pod `min_conf` sa zahodí. Poradie ako číta Tesseract.
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
    """Istota strany: priemer `conf` riadkov vážený dĺžkou textu."""
    total = sum(len(b["t"]) for b in blocks)
    return round(sum(b["conf"] * len(b["t"]) for b in blocks) / total, 2) if total else 0.0


def ocr_page(page: fitz.Page) -> Optional[OcrPage]:
    """Vyrenderuje stranu a prečíta ju Tesseractom; None, keď na nej nič čitateľné nie je."""
    import pytesseract
    from PIL import Image

    # Zobrazená strana (s rotáciou), rovnako ako bbox textovej vrstvy v `page_blocks`.
    pix = page.get_pixmap(dpi=_dpi(page), colorspace=fitz.csGRAY, alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    data = pytesseract.image_to_data(img, lang=OCR_LANG, output_type=pytesseract.Output.DICT)
    blocks = lines_from_data(data, pix.width, pix.height)
    if not blocks:
        return None
    return OcrPage(" ".join(b["t"] for b in blocks), blocks, page_conf(blocks))
