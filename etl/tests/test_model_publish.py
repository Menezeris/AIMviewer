"""Revízie IFC modelov (D-086): technická poistka a compare-and-swap zápis revízie.

Poistka beží nad malými IFC súbormi vytvorenými cez `ifcopenshell.api`. Zápis
revízií potrebuje Postgres: testy bežia len s `AIM_TEST_DATABASE_URL` (prázdna
databáza, migrácia sa aplikuje do vlastnej schémy testu). Úložisko je slovník v pamäti.
"""

from __future__ import annotations

import gzip
import json
import os
import uuid
from pathlib import Path

import ifcopenshell
import ifcopenshell.guid
import pytest

from etl import model_publish as mp

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261018120000_model_revisions.sql"
)


def _model(tmp: Path, name: str, walls: list[str], schema: str = "IFC4X3_ADD2") -> Path:
    f = ifcopenshell.file(schema=schema)
    f.createIfcProject("0" * 22, Name="P")
    for guid in walls:
        f.createIfcWall(guid, Name=guid)
    path = tmp / f"{name}.ifc"
    f.write(str(path))
    return path


W1, W2, W3 = (ifcopenshell.guid.new() for _ in range(3))


# ── poistka ──────────────────────────────────────────────────────────────────

def test_guard_first_revision_checks_schema(tmp_path: Path) -> None:
    assert mp.guard(_model(tmp_path, "a", [W1])).ok
    rep = mp.guard(_model(tmp_path, "b", [W1], schema="IFC4"))
    assert not rep.ok and "schéma IFC4" in rep.errors[0]


def test_guard_rejects_unreadable_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.ifc"
    bad.write_text("ISO-10303-21;\nHEADER;\nnie je IFC")
    rep = mp.guard(bad)
    assert not rep.ok and rep.errors[0].startswith("súbor sa nedá otvoriť")


def test_guard_rejects_duplicate_globalid(tmp_path: Path) -> None:
    rep = mp.guard(_model(tmp_path, "a", [W1, W1]))
    assert not rep.ok and W1 in rep.errors[0]


def test_guard_requires_declared_add_and_remove(tmp_path: Path) -> None:
    base = _model(tmp_path, "base", [W1, W2])
    new = _model(tmp_path, "new", [W1, W3])
    rep = mp.guard(new, base, {"changes": []})
    assert not rep.ok
    assert rep.added == [W3] and rep.removed == [W2]
    assert rep.class_delta == {}  # jedna stena preč, jedna pribudla
    assert len(rep.errors) == 2

    declared = {"changes": [{"guid": W3, "op": "add"}, {"guid": W2, "op": "remove"}]}
    assert mp.guard(new, base, declared).ok


def test_guard_not_strict_only_reports(tmp_path: Path) -> None:
    rep = mp.guard(_model(tmp_path, "new", [W1]), _model(tmp_path, "base", [W1, W2]), strict=False)
    assert rep.ok and rep.removed == [W2] and rep.class_delta == {"IfcWall": -1}


def test_guard_schema_change_against_base(tmp_path: Path) -> None:
    rep = mp.guard(_model(tmp_path, "new", [W1], schema="IFC4"), _model(tmp_path, "base", [W1]))
    assert not rep.ok and "schéma sa zmenila" in rep.errors[0]


# ── zápis revízií (Postgres) ─────────────────────────────────────────────────

DB = os.environ.get("AIM_TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not DB, reason="AIM_TEST_DATABASE_URL nie je nastavené")


@pytest.fixture
def db_url():
    import psycopg

    schema = f"t_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(DB, autocommit=True) as conn:
        conn.execute(f"create schema {schema}")
        conn.execute(f"set search_path to {schema}")
        conn.execute(MIGRATION.read_text(encoding="utf-8"))
    sep = "&" if "?" in DB else "?"
    yield f"{DB}{sep}options=-csearch_path%3D{schema}"
    with psycopg.connect(DB, autocommit=True) as conn:
        conn.execute(f"drop schema {schema} cascade")


@pytest.fixture
def storage(monkeypatch):
    store: dict[str, bytes] = {}

    def put(key, data, *, upsert, content_type, cache_control):
        if key in store and not upsert:
            raise RuntimeError(f"{key} už existuje")
        store[key] = data

    def get(key):
        return store[key]

    monkeypatch.setattr(mp, "_put", put)
    monkeypatch.setattr(mp, "_get", get)
    monkeypatch.delenv("LIVE_CHANNEL", raising=False)
    return store


def _revisions(db_url: str) -> list[tuple]:
    import psycopg

    with psycopg.connect(db_url) as conn:
        return conn.execute(
            "select revision, parent_revision, is_current, summary from model_revisions "
            "where model = 'ASR' order by revision"
        ).fetchall()


@needs_db
def test_publish_bootstrap_then_change(tmp_path, db_url, storage) -> None:
    v0 = _model(tmp_path, "v0", [W1, W2])
    res = mp.publish(model="ASR", path=v0, base=None, revision=72, strict=False,
                     summary="prevzatie", db_url=db_url)
    assert res["status"] == "published" and res["revision"] == 72
    assert gzip.decompress(storage["archive/ASR/v072.ifc.gz"]) == v0.read_bytes()
    assert storage["ASR.ifc"] == v0.read_bytes()

    v1 = _model(tmp_path, "v1", [W1, W2, W3])
    changes = {"summary": "nová stena", "changes": [{"guid": W3, "op": "add"}]}
    res = mp.publish(model="ASR", path=v1, base=72, changes=changes, db_url=db_url)
    assert res["status"] == "published" and res["revision"] == 73
    assert _revisions(db_url) == [(72, None, False, "prevzatie"), (73, 72, True, "nová stena")]
    assert storage["ASR.ifc"] == v1.read_bytes()

    # rovnaký obsah znova = nič nové
    assert mp.publish(model="ASR", path=v1, base=73, changes=changes, db_url=db_url)["status"] == "unchanged"


@needs_db
def test_publish_conflict_when_base_is_stale(tmp_path, db_url, storage) -> None:
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1]), base=None, strict=False, db_url=db_url)
    mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1, W2]), base=0,
               changes={"changes": [{"guid": W2, "op": "add"}]}, db_url=db_url)
    with pytest.raises(mp.Conflict):
        mp.publish(model="ASR", path=_model(tmp_path, "v1b", [W1, W3]), base=0,
                   changes={"changes": [{"guid": W3, "op": "add"}]}, db_url=db_url)
    assert [r[0] for r in _revisions(db_url)] == [0, 1]


@needs_db
def test_publish_guard_failure_writes_nothing(tmp_path, db_url, storage) -> None:
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1, W2]), base=None, strict=False,
               db_url=db_url)
    before = dict(storage)
    res = mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1]), base=0,
                     changes={"changes": []}, db_url=db_url)
    assert res["status"] == "guard_failed" and res["guard"]["removed"] == [W2]
    assert storage == before and len(_revisions(db_url)) == 1


@needs_db
def test_revert_is_a_new_revision(tmp_path, db_url, storage) -> None:
    v0 = _model(tmp_path, "v0", [W1, W2])
    mp.publish(model="ASR", path=v0, base=None, strict=False, db_url=db_url)
    mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1]), base=0,
               changes={"changes": [{"guid": W2, "op": "remove"}]}, db_url=db_url)
    res = mp.revert("ASR", 0, db_url=db_url)
    assert res["status"] == "published" and res["revision"] == 2
    assert storage["ASR.ifc"] == v0.read_bytes()
    assert _revisions(db_url)[-1] == (2, 1, True, "návrat na v0")


@needs_db
def test_task_is_resolved_with_result_revision(tmp_path, db_url, storage) -> None:
    import psycopg

    with psycopg.connect(db_url) as conn:
        task = conn.execute(
            "insert into model_tasks (model, title) values ('ASR', 't') returning id"
        ).fetchone()[0]
        conn.commit()
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1]), base=None, strict=False,
               task_id=str(task), db_url=db_url)
    with psycopg.connect(db_url) as conn:
        assert conn.execute(
            "select status, result_revision from model_tasks where id = %s", (task,)
        ).fetchone() == ("resolved", 0)


def test_changes_file_format_roundtrip(tmp_path: Path) -> None:
    """Zoznam zmien je obyčajný JSON; poistka číta len `changes[].guid` a `op`."""
    doc = {"summary": "s", "changes": [{"guid": W1, "ifc_class": "IfcWall", "op": "modify",
                                        "what": "Pset_WallCommon.FireRating",
                                        "before": "REI 30", "after": "REI 60"}]}
    p = tmp_path / "zmeny.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    base = _model(tmp_path, "base", [W1])
    assert mp.guard(_model(tmp_path, "new", [W1]), base, json.loads(p.read_text())).ok
