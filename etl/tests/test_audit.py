"""Transaction log settings of ETL connections (D-196, R12)."""

from __future__ import annotations

from etl import audit


class _Cur:
    def __init__(self, has_log: bool):
        self.calls: list[tuple[str, tuple]] = []
        self.has_log = has_log

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        return self

    def fetchone(self):
        return (self.has_log,)


def test_person_id_only_uuid(monkeypatch):
    monkeypatch.setenv("AIM_PERSON_ID", "11111111-2222-3333-4444-555555555555")
    assert audit.person_id() == "11111111-2222-3333-4444-555555555555"
    monkeypatch.setenv("AIM_PERSON_ID", "drop table x")
    assert audit.person_id() == ""
    monkeypatch.delenv("AIM_PERSON_ID")
    assert audit.person_id() == ""


def test_tag_connections_keeps_callers_name(monkeypatch):
    monkeypatch.delenv("PGAPPNAME", raising=False)
    audit.tag_connections()
    import os
    assert os.environ["PGAPPNAME"].startswith("etl:") and os.environ["PGAPPNAME"].endswith(audit.RUN_ID)
    monkeypatch.setenv("PGAPPNAME", "mine")
    audit.tag_connections()
    assert os.environ["PGAPPNAME"] == "mine"


def test_set_session_is_transaction_local(monkeypatch):
    monkeypatch.delenv("AIM_PERSON_ID", raising=False)
    cur = _Cur(True)
    audit.set_session(cur, "etl:ASR:abc")
    sql, params = cur.calls[0]
    assert "set_config('app.person_id', %s, true)" in sql and "set_config('app.source', %s, true)" in sql
    assert params == ("", "etl:ASR:abc")


def test_write_run_skipped_before_the_log_exists():
    cur = _Cur(False)
    assert audit.write_run(cur, "etl:x", {"objects": 1}, None) is False
    assert len(cur.calls) == 1
    cur = _Cur(True)
    assert audit.write_run(cur, "etl:x", {"objects": 1}, None) is True
    assert "audit.write_run(%s, %s::jsonb, %s::uuid)" in cur.calls[1][0]
