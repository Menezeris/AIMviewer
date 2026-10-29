"""#279: strany bez textovej vrstvy (text ako obrázok / krivky) sa pomenujú, nie ticho preskočia."""

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

    # Strana 2: titulka ako rastrový obrázok (text je nakreslený do bitmapy, ako sken alebo CCITT maska).
    src = fitz.open()
    sp = src.new_page(width=300, height=100)
    sp.insert_text((10, 50), "VYSOKE UCENI TECHNICKE", fontsize=14)
    pix = sp.get_pixmap(dpi=100)
    img_page = doc.new_page(width=300, height=200)
    img_page.insert_image(fitz.Rect(0, 0, 300, 100), pixmap=pix)

    # Strana 3: text prevedený na krivky (veľa ťahov, žiadne písmo ani obrázok).
    vec = doc.new_page(width=300, height=200)
    for i in range(TEXTLESS_VECTOR_MIN + 5):
        vec.draw_line((10 + i, 10), (10 + i, 40), width=0.5)

    doc.new_page(width=300, height=200)  # strana 4: prázdna
    out = tmp_path / "titulka.pdf"
    doc.save(out)
    doc.close()
    return out


def test_textless_pages_classified(tmp_path: Path) -> None:
    assert textless_pages(_pdf(tmp_path)) == {2: TEXTLESS_IMAGE, 3: TEXTLESS_VECTOR, 4: TEXTLESS_EMPTY}


def test_textless_pages_are_not_in_text_layer(tmp_path: Path) -> None:
    # Dôvod hlásenia "Strana nemá text": ETL zapíše len stranu 1, obrázkové strany bez OCR text nemajú.
    pdf = _pdf(tmp_path)
    assert [p[0] for p in extract_pages_full(pdf)] == [1]
