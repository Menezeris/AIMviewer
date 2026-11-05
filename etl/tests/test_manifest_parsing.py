"""Tests of the `podklady/docs.csv` parsers - all three must handle `#` comments and a BOM.

Regression: `pdf_text._load_pdf_rows` did not filter `#` comments, the first manifest row
became the DictReader header and `python -m etl.pdf_text` silently processed 0 documents
(`document_pages` empty -> `search_documents` never returns anything).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from etl import doc_upload, pdf_link
from etl.pdf_text import _load_pdf_rows

HEADER = "source_path,container_name,target_ref,status,revision\n"
ROWS = (
    "ASR/pdf/vykres1.pdf,AIM_DSP_D1_ASR_VD_001_Pôdorys,1NP,S2,P01\n"
    "TZB/sprava.pdf,AIM_DSP_D1_VZT_RP_001_Správa,Polyfunkčný objekt,S2,P01\n"
    "ine/model.ifc,AIM_DSP_D1_ASR_MD_001_Model,Polyfunkčný objekt,S2,P01\n"
)
COMMENT = "# Manifest dokumentov pre E3 (D-036).\n# druhý riadok komentára\n"


def _write(path: Path, text: str, bom: bool = False) -> Path:
    data = text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    path.write_bytes(data)
    return path


@pytest.fixture()
def manifest_with_comments(tmp_path: Path) -> Path:
    return _write(tmp_path / "docs.csv", COMMENT + HEADER + ROWS)


@pytest.fixture()
def manifest_with_bom(tmp_path: Path) -> Path:
    return _write(tmp_path / "docs.csv", COMMENT + HEADER + ROWS, bom=True)


def test_pdf_text_skips_comment_lines(manifest_with_comments: Path) -> None:
    rows = _load_pdf_rows(manifest_with_comments)
    assert [r.container_name for r in rows] == [
        "AIM_DSP_D1_ASR_VD_001_Pôdorys",
        "AIM_DSP_D1_VZT_RP_001_Správa",
    ]
    assert rows[0].source_path == "ASR/pdf/vykres1.pdf"


def test_pdf_text_handles_bom(manifest_with_bom: Path) -> None:
    rows = _load_pdf_rows(manifest_with_bom)
    assert len(rows) == 2


def test_doc_upload_read_manifest_handles_bom_and_comments(
    manifest_with_bom: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(doc_upload, "_MANIFEST", manifest_with_bom)
    rows = doc_upload.read_manifest()
    assert [r.container_name for r in rows] == [
        "AIM_DSP_D1_ASR_VD_001_Pôdorys",
        "AIM_DSP_D1_VZT_RP_001_Správa",
        "AIM_DSP_D1_ASR_MD_001_Model",
    ]
    assert rows[0].target_ref == "1NP"


def test_pdf_link_read_drawings_handles_bom_and_comments(
    manifest_with_bom: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pdf_link, "_MANIFEST", manifest_with_bom)
    rows = pdf_link.read_drawings()
    # drawing = TypSouboru 'VD'; the RP report and the MD model are filtered out
    assert [r.container_name for r in rows] == ["AIM_DSP_D1_ASR_VD_001_Pôdorys"]


def test_parsers_agree_on_real_manifest() -> None:
    """All three parsers read the real committed manifest and see the same PDF rows."""
    real = Path(__file__).resolve().parents[2] / "podklady" / "docs.csv"
    if not real.exists():
        pytest.skip("podklady/docs.csv nie je v checkoute")
    pdf_rows = {r.container_name for r in _load_pdf_rows(real)}
    manifest_pdfs = {
        r.container_name
        for r in doc_upload.read_manifest()
        if r.source_path.lower().endswith(".pdf")
    }
    assert pdf_rows == manifest_pdfs
    assert pdf_rows, "manifest obsahuje PDF riadky — parser nesmie vrátiť prázdno"
