"""D-133: hrubé čiary výkresu pre kalibráciu podkladu (`document_pages.lines`)."""

from __future__ import annotations

from pathlib import Path

import fitz

from etl.pdf_text import LINE_MIN_COUNT, LINE_WIDTH_TIERS, extract_pages_full, index_pdf, page_lines


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


def _thin_pdf(tmp_path: Path, n: int, width: float) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=400, height=200)
    page.insert_text((40, 50), "1.01", fontsize=10)
    for i in range(n):
        page.draw_line((10, 10 + i * 0.5), (110, 10 + i * 0.5), width=width)
    out = tmp_path / "t.pdf"
    doc.save(out)
    doc.close()
    return out


def test_thin_lines_use_lower_width_tier(tmp_path: Path) -> None:
    """#283: požiarny pôdorys s čiarami 0,4 pt dostane `lines` s nižším prahom."""
    data = extract_pages_full(_thin_pdf(tmp_path, LINE_MIN_COUNT, 0.4))[0][3]
    assert data is not None
    assert data["min_w"] == 0.25
    assert len(data["segs"]) == LINE_MIN_COUNT


def test_thick_lines_keep_first_tier(tmp_path: Path) -> None:
    data = extract_pages_full(_pdf(tmp_path, LINE_MIN_COUNT))[0][3]
    assert data is not None and data["min_w"] == LINE_WIDTH_TIERS[0]


def test_hairlines_below_all_tiers_are_not_a_drawing(tmp_path: Path) -> None:
    assert extract_pages_full(_thin_pdf(tmp_path, LINE_MIN_COUNT * 2, 0.1))[0][3] is None


def test_page_lines_takes_quads() -> None:
    p = fitz.Point
    q = fitz.Quad(p(0, 0), p(10, 0), p(0, 10), p(10, 10))
    d = [{"width": 1.0, "items": [("qu", q)] * 60}]
    data = page_lines(d, 100, 100)
    assert data is not None and len(data["segs"]) == 240


def test_index_pdf_writes_lines_and_size(tmp_path: Path) -> None:
    class Cur:
        def __init__(self) -> None:
            self.sql: list[tuple] = []

        def execute(self, sql: str, params: tuple = ()) -> None:
            self.sql.append((sql, params))

    cur = Cur()
    assert index_pdf(cur, "doc-1", _pdf(tmp_path, LINE_MIN_COUNT)) == 1
    insert = next(p for s, p in cur.sql if s.startswith("insert into document_pages"))
    assert insert[0] == "doc-1" and insert[1] == 1
    assert '"segs"' in insert[4] and insert[5] == "[400.0, 200.0]"
