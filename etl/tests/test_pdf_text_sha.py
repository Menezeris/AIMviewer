"""D-158 kroky 3 a 4: veľkosť strán a sha256 súboru PDF (kotva revízie, keš snímky)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import fitz

from etl.pdf_text import _write_pages, extract_pages_full, file_sha256, page_sizes


def _pdf(tmp_path: Path) -> Path:
    doc = fitz.open()
    doc.new_page(width=842, height=595).insert_text((40, 50), "1.01", fontsize=10)
    rotated = doc.new_page(width=595, height=842)
    rotated.insert_text((40, 50), "D.1.1.09", fontsize=10)
    rotated.set_rotation(90)
    out = tmp_path / "v.pdf"
    doc.save(out)
    doc.close()
    return out


def test_page_sizes_shown_page_with_rotation(tmp_path: Path) -> None:
    sizes = page_sizes(_pdf(tmp_path))
    assert sizes == {1: [842.0, 595.0], 2: [842.0, 595.0]}


def test_file_sha256_is_sha_of_bytes(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path)
    assert file_sha256(pdf) == hashlib.sha256(pdf.read_bytes()).hexdigest()


class _Cur:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.calls.append((sql, params))


def test_write_pages_stores_page_size_and_sha(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path)
    cur = _Cur()
    _write_pages(cur, "doc", extract_pages_full(pdf), page_sizes(pdf), file_sha256(pdf))
    inserts = [p for sql, p in cur.calls if sql.startswith("insert into document_pages")]
    assert [p[1] for p in inserts] == [1, 2]
    assert inserts[0][5] == "[842.0, 595.0]"
    sql, params = cur.calls[-1]
    assert sql.startswith("update documents set file_sha256")
    assert params == (file_sha256(pdf), "doc")


def test_write_pages_without_sizes_keeps_null(tmp_path: Path) -> None:
    cur = _Cur()
    _write_pages(cur, "doc", extract_pages_full(_pdf(tmp_path)))
    assert all(p[5] is None for sql, p in cur.calls if sql.startswith("insert"))
    assert not any(sql.startswith("update") for sql, _ in cur.calls)
