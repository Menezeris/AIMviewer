"""D-169: OCR číta len strany bez textovej vrstvy (obrázok, krivky) a zapisuje ich ako `blocks` so src=ocr."""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from etl import ocr as ocr_mod
from etl import pdf_text
from etl.ocr import lines_from_data, ocr_unavailable, page_conf
from etl.pdf_text import extract_pages_full, is_ocr_page

TITLE = "VYSOKÉ UČENÍ TECHNICKÉ V BRNĚ"


def _pdf(tmp_path: Path) -> Path:
    """Strana 1 s textovou vrstvou, strana 2 len s obrázkom textu (ako titulka #279), strana 3 prázdna."""
    doc = fitz.open()
    doc.new_page(width=595, height=842).insert_text((60, 80), "D.1.1.09 VYPIS SKLADIEB", fontsize=12)

    # Titulka ako raster: text s diakritikou (vstavané písmo MuPDF) vyrenderovaný do bitmapy.
    src = fitz.open()
    sp = src.new_page(width=420, height=120)
    sp.insert_htmlbox(
        fitz.Rect(10, 10, 410, 110),
        f"<p style='font-size:20px'>{TITLE}</p><p style='font-size:14px'>Fakulta stavební</p>",
    )
    pix = sp.get_pixmap(dpi=150)
    img_page = doc.new_page(width=595, height=842)
    img_page.insert_image(fitz.Rect(50, 100, 545, 242), pixmap=pix)

    doc.new_page(width=595, height=842)
    out = tmp_path / "titulka.pdf"
    doc.save(out)
    doc.close()
    return out


def test_text_layer_page_never_goes_to_ocr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake_ocr(page: fitz.Page):
        calls.append(page.number + 1)
        return ocr_mod.OcrPage("X", [{"t": "X", "x": 1, "y": 1, "w": 1, "h": 1, "src": "ocr", "conf": 0.9}], 0.9)

    monkeypatch.setattr(pdf_text, "ocr_unavailable", lambda: None)
    monkeypatch.setattr(pdf_text, "ocr_page", fake_ocr)
    pages = extract_pages_full(_pdf(tmp_path), ocr=True)
    # Len obrázková strana 2; strana 1 má textovú vrstvu, strana 3 je prázdna.
    assert calls == [2]
    assert [p[0] for p in pages] == [1, 2]
    assert not is_ocr_page(pages[0]) and "src" not in pages[0][2][0]
    assert is_ocr_page(pages[1])


def test_no_ocr_keeps_textless_pages_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pdf_text, "ocr_page", lambda page: pytest.fail("OCR nemá bežať"))
    assert [p[0] for p in extract_pages_full(_pdf(tmp_path), ocr=False)] == [1]


def test_lines_from_data_groups_words_and_drops_noise() -> None:
    data = {
        "text": ["VYSOKÉ", "UČENÍ", "", "~", "Brno"],
        "conf": [96, 90, -1, 12, 80],
        "block_num": [1, 1, 1, 2, 3],
        "par_num": [1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 1, 1],
        "left": [100, 300, 0, 50, 100],
        "top": [100, 105, 0, 500, 800],
        "width": [180, 150, 0, 10, 90],
        "height": [40, 35, 0, 10, 30],
    }
    lines = lines_from_data(data, 1000, 1000)
    assert lines == [
        {"t": "VYSOKÉ UČENÍ", "x": 10.0, "y": 10.0, "w": 35.0, "h": 4.0, "src": "ocr", "conf": 0.93},
        {"t": "Brno", "x": 10.0, "y": 80.0, "w": 9.0, "h": 3.0, "src": "ocr", "conf": 0.8},
    ]
    assert page_conf(lines) == round((0.93 * 12 + 0.8 * 4) / 16, 2)


@pytest.mark.skipif(ocr_unavailable() is not None, reason=f"OCR nedostupné: {ocr_unavailable()}")
def test_real_ocr_reads_czech_title_with_diacritics(tmp_path: Path) -> None:
    pages = extract_pages_full(_pdf(tmp_path), ocr=True)
    assert [p[0] for p in pages] == [1, 2]
    _, text, blocks, _ = pages[1]
    assert TITLE in text
    title = next(b for b in blocks if b["t"] == TITLE)
    assert title["src"] == "ocr" and title["conf"] >= 0.8
    # Obrázok je na strane v rámci x 50-545 pt, y 100-242 pt (v % strany 595 x 842).
    assert 8 <= title["x"] <= 20 and 11 <= title["y"] <= 20
    assert 0 < title["w"] < 85 and 0 < title["h"] < 6
