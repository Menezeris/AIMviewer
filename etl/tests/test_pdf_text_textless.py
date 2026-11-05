"""#279: pages without a text layer (text as an image / curves) are named, not silently skipped."""

from __future__ import annotations

from pathlib import Path

import fitz

from etl.pdf_text import (
    TEXTLESS_EMPTY,
    TEXTLESS_IMAGE,
    TEXTLESS_VECTOR,
    TEXTLESS_VECTOR_MIN,
    extract_pages_full,
    textless_pages,
)


def _pdf(tmp_path: Path) -> Path:
    doc = fitz.open()
    doc.new_page(width=300, height=200).insert_text((30, 50), "D.1.1.09 VYPIS SKLADIEB", fontsize=12)

    # Page 2: the title page as a raster image (the text is drawn into a bitmap, like a scan or a CCITT mask).
    src = fitz.open()
    sp = src.new_page(width=300, height=100)
    sp.insert_text((10, 50), "VYSOKE UCENI TECHNICKE", fontsize=14)
    pix = sp.get_pixmap(dpi=100)
    img_page = doc.new_page(width=300, height=200)
    img_page.insert_image(fitz.Rect(0, 0, 300, 100), pixmap=pix)

    # Page 3: text converted to curves (many strokes, no font or image).
    vec = doc.new_page(width=300, height=200)
    for i in range(TEXTLESS_VECTOR_MIN + 5):
        vec.draw_line((10 + i, 10), (10 + i, 40), width=0.5)

    doc.new_page(width=300, height=200)  # page 4: empty
    out = tmp_path / "titulka.pdf"
    doc.save(out)
    doc.close()
    return out


def test_textless_pages_classified(tmp_path: Path) -> None:
    assert textless_pages(_pdf(tmp_path)) == {2: TEXTLESS_IMAGE, 3: TEXTLESS_VECTOR, 4: TEXTLESS_EMPTY}


def test_textless_pages_are_not_in_text_layer(tmp_path: Path) -> None:
    # Reason for the report "Strana nemá text": the ETL writes only page 1, the image pages without OCR have no text.
    pdf = _pdf(tmp_path)
    assert [p[0] for p in extract_pages_full(pdf)] == [1]
