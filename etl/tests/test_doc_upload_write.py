"""Test of `_write_document` - a re-upload of a document must not drop `_drawing_links` (E4).

Regression: the objects upsert set `properties = excluded.properties` (the CDE pset
only), so a repeated E3 run overwrote the whole JSONB including `_drawing_links`,
which pdf_link merges there (E4, D-042). The clickable drawing regions then
vanished after a PDF re-upload until someone ran E4 again.

The generated SQL is checked: only the 'CDE' key may be replaced, the rest of properties
must be preserved (jsonb `- 'CDE' || excluded`).
"""

from __future__ import annotations

from etl.doc_upload import _write_document, read_manifest


class StubCursor:
    """Records execute() and serves fetchone results in order."""

    def __init__(self, fetchone_results: list) -> None:
        self.calls: list[tuple[str, tuple]] = []
        self._fetchone = list(fetchone_results)

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self.calls.append((" ".join(sql.split()), params))
        return self

    def fetchone(self):
        return self._fetchone.pop(0)


def _manifest_row(monkeypatch, tmp_path):
    import etl.doc_upload as du

    manifest = tmp_path / "docs.csv"
    manifest.write_text(
        "# komentár\n"
        "source_path,container_name,target_ref,status,revision\n"
        "ASR/pdf/v1.pdf,AIM_DSP_D1_ASR_VD_001_Pôdorys,1NP,S2,P01\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(du, "_MANIFEST", manifest)
    return read_manifest()[0]


def test_objects_upsert_preserves_non_cde_properties(monkeypatch, tmp_path) -> None:
    row = _manifest_row(monkeypatch, tmp_path)
    cur = StubCursor(fetchone_results=[("target-uuid",), ("doc-uuid",)])

    _write_document(cur, row, location="https://x/storage/doc.pdf", storage_type="supabase")

    upsert_sql = next(sql for sql, _ in cur.calls if "insert into objects" in sql)
    # the whole properties must not be replaced - only the CDE pset
    assert "properties = excluded.properties" not in upsert_sql
    assert "- 'CDE'" in upsert_sql
    assert "|| excluded.properties" in upsert_sql


def test_write_document_emits_all_three_writes(monkeypatch, tmp_path) -> None:
    row = _manifest_row(monkeypatch, tmp_path)
    cur = StubCursor(fetchone_results=[("target-uuid",), ("doc-uuid",)])

    _write_document(cur, row, location="https://x/storage/doc.pdf", storage_type="supabase")

    sqls = [sql for sql, _ in cur.calls]
    assert any("insert into objects" in s for s in sqls)
    assert any("insert into documents" in s for s in sqls)
    assert any("insert into relationships" in s for s in sqls)
    # the edge goes to the relationships base table with a canonical rel_type (D-051)
    rel_sql = next(s for s in sqls if "insert into relationships" in s)
    assert "'rel_associates_document'" in rel_sql
