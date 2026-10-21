"""D-133: hrubé čiary výkresu pre kalibráciu podkladu (`document_pages.lines`)."""

from __future__ import annotations

from pathlib import Path

import fitz

from etl.pdf_text import LINE_MIN_COUNT, extract_pages_full, page_lines


def _pdf(tmp_path: Path, thick: int) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=400, height=200)
    page.insert_text((40, 50), "1.01", fontsize=10)
    for i in range(thick):
        page.draw_line((10, 10 + i * 0.5), (110, 10 + i * 0.5), width=1.4)
    page.draw_line((10, 150), (300, 150), width=0.3)  # tenká kóta sa neuloží
    page.draw_rect(fitz.Rect(200, 20, 260, 60), width=1.4)
    out = tmp_path / "v.pdf"
    doc.save(out)
    doc.close()
    return out


def test_lines_bottom_left_points_and_thick_only(tmp_path: Path) -> None:
    pages = extract_pages_full(_pdf(tmp_path, LINE_MIN_COUNT))
    data = pages[0][3]
    assert data is not None and data["size"] == [400, 200]
    lines = data["segs"]
    assert len(lines) == LINE_MIN_COUNT + 4
    # Prvá čiara y = 10 od vrchu strany 200 -> 190 od spodku (počiatok vľavo dole).
    assert lines[0] == [10.0, 190.0, 110.0, 190.0, 1.4]
    assert all(seg[4] >= 0.99 for seg in lines)
    # Obdĺžnik = 4 strany.
    assert [200.0, 180.0, 260.0, 180.0, 1.4] in lines


def test_page_without_drawing_has_no_lines(tmp_path: Path) -> None:
    pages = extract_pages_full(_pdf(tmp_path, 3))
    assert pages[0][3] is None


def test_page_lines_skips_curves_and_points() -> None:
    p = fitz.Point
    d = [
        {"width": 1.0, "items": [("c", p(0, 0), p(1, 1), p(2, 2), p(3, 3)), ("l", p(5, 5), p(5, 5))]},
        {"width": 0.5, "items": [("l", p(0, 0), p(10, 0))]},
    ]
    assert page_lines(d, 100, 100) is None
