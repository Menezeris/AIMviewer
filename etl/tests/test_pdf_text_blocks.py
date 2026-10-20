"""D-123: riadky textu s polohou v % strany (`document_pages.blocks`).

Overuje `extract_pages_with_blocks` na vygenerovanom PDF: text strany ostáva ako
pred D-123 a každý riadok má bbox v % strany s počiatkom vľavo hore, aby sa dal
dať priamo do `open_drawing region` (D-117).
"""

from __future__ import annotations

from pathlib import Path

import fitz

from etl.pdf_text import extract_pages, extract_pages_with_blocks, page_blocks


def _pdf(tmp_path: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=400, height=200)
    # Base14 písmo nemá "ť"; diakritiku z Latin-1 overí "á".
    page.insert_text((40, 50), "1.05 Technická miestnost", fontsize=10)
    page.insert_text((300, 180), "250", fontsize=10)
    doc.new_page(width=400, height=200)  # prázdna strana sa nevloží
    out = tmp_path / "v.pdf"
    doc.save(out)
    doc.close()
    return out


def test_blocks_have_page_percent_bbox(tmp_path: Path) -> None:
    pages = extract_pages_with_blocks(_pdf(tmp_path))
    assert [p[0] for p in pages] == [1]
    _, text, blocks = pages[0]
    assert "Technická miestnost" in text
    by_text = {b["t"]: b for b in blocks}
    room = by_text["1.05 Technická miestnost"]
    # Baseline y=50 na strane 200 vysokej: horný okraj riadku je pod 25 %.
    assert 9 <= room["x"] <= 11
    assert 15 <= room["y"] <= 25 < room["y"] + room["h"] + 1
    dim = by_text["250"]
    assert dim["x"] > 70 and dim["y"] > 80
    assert all(0 <= b["x"] <= 100 and 0 <= b["y"] <= 100 and b["w"] > 0 for b in blocks)


def test_extract_pages_keeps_text_contract(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path)
    assert extract_pages(pdf) == [(n, t) for n, t, _ in extract_pages_with_blocks(pdf)]


def test_page_blocks_skips_images_and_empty_lines() -> None:
    d = {
        "blocks": [
            {"type": 1, "bbox": (0, 0, 10, 10)},
            {
                "type": 0,
                "lines": [
                    {"bbox": (0, 0, 50, 10), "spans": [{"text": "  "}]},
                    {"bbox": (100, 50, 200, 60), "spans": [{"text": "Legenda "}, {"text": " materiálov"}]},
                ],
            },
        ]
    }
    assert page_blocks(d, 200, 100) == [{"t": "Legenda materiálov", "x": 50.0, "y": 50.0, "w": 50.0, "h": 10.0}]
