"""Revízie IFC modelov (D-086): technická poistka a compare-and-swap zápis revízie.

Poistka beží nad malými IFC súbormi vytvorenými cez `ifcopenshell.api`. Zápis
revízií potrebuje Postgres: testy bežia len s `AIM_TEST_DATABASE_URL` (lokálna databáza so všetkými
migráciami, D-189). Každý test má vlastný projekt (D-189), ktorý na konci zmaže. Úložisko je slovník v pamäti.
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

def _model(tmp: Path, name: str, walls: list[str], schema: str = "IFC4X3_ADD2", project: str = "P") -> Path:
    """Small IFC; with a real project code the file gets a CDE name (D-036, D-190) and IfcProject.Name."""
    f = ifcopenshell.file(schema=schema)
    f.createIfcProject("0" * 22, Name=project)
    for guid in walls:
        f.createIfcWall(guid, Name=guid)
    stem = name if project == "P" or project == "OCB" else f"{project}_DPS_SO01_ARS_DiMS_001_{name}"
    path = tmp / f"{stem}.ifc"
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
def project():
    """A throwaway project (D-189) in the migrated test database; removed with everything it got."""
    import psycopg

    code = f"T{uuid.uuid4().hex[:6].upper()}"
    with psycopg.connect(DB, autocommit=True) as conn:
        pid = conn.execute("insert into objects (object_type, object_ref, name) values ('project', %s, %s) "
                           "returning id", (code, code)).fetchone()[0]
    yield code, str(pid)
    drop_project(str(pid))


def drop_project(pid: str) -> None:
    """Remove a test project; revisions newest first (only the latest one may be deleted, D-183)."""
    import psycopg

    with psycopg.connect(DB, autocommit=True) as conn:
        while conn.execute(
            "delete from model_revisions where id = (select id from model_revisions where project_id = %s "
            "order by container_id, revision desc limit 1) returning id", (pid,)
        ).fetchone():
            pass
        conn.execute("delete from model_tasks where project_id = %s", (pid,))
        conn.execute("delete from information_containers where project_id = %s", (pid,))
        conn.execute("delete from objects where id = %s", (pid,))


@pytest.fixture
def db_url(project):
    return DB


@pytest.fixture
def storage(monkeypatch):
    store: dict[str, bytes] = {}

    def put(key, data, *, upsert, content_type, cache_control):
        assert isinstance(cache_control, int)
        if key in store and not upsert:
            raise RuntimeError(f"{key} už existuje")
        store[key] = data

    def get(key):
        return store[key]

    monkeypatch.setattr(mp, "_put", put)
    monkeypatch.setattr(mp, "_get", get)
    monkeypatch.delenv("LIVE_CHANNEL", raising=False)
    return store


def _revisions(db_url: str, pid: str) -> list[tuple]:
    import psycopg

    with psycopg.connect(db_url) as conn:
        return conn.execute(
            "select revision, parent_revision, is_current, summary from model_revisions "
            "where model = 'ASR' and project_id = %s order by revision", (pid,)
        ).fetchall()


def _container(db_url: str, pid: str) -> str:
    import psycopg

    with psycopg.connect(db_url) as conn:
        return str(conn.execute("select id from information_containers where project_id = %s and model = 'ASR'",
                                (pid,)).fetchone()[0])


@needs_db
def test_publish_bootstrap_then_change(tmp_path, db_url, storage, project) -> None:
    code, pid = project
    v0 = _model(tmp_path, "v0", [W1, W2], project=code)
    res = mp.publish(model="ASR", path=v0, base=None, revision=72, strict=False,
                     summary="prevzatie", db_url=db_url, project_code=code)
    assert res["status"] == "published" and res["revision"] == 72
    # D-190: a new project archives by the model UUID (its container), not by the code
    cid = _container(db_url, pid)
    assert res["container_id"] == cid and res["archive"] == f"ifc/archive/{cid}/v072.ifc.gz"
    assert gzip.decompress(storage[f"archive/{cid}/v072.ifc.gz"]) == v0.read_bytes()
    assert storage[f"{cid}.ifc"] == v0.read_bytes()

    v1 = _model(tmp_path, "v1", [W1, W2, W3], project=code)
    changes = {"summary": "nová stena", "changes": [{"guid": W3, "op": "add"}]}
    res = mp.publish(model="ASR", path=v1, base=72, changes=changes, db_url=db_url, project_code=code)
    assert res["status"] == "published" and res["revision"] == 73
    assert _revisions(db_url, pid) == [(72, None, False, "prevzatie"), (73, 72, True, "nová stena")]
    assert storage[f"{cid}.ifc"] == v1.read_bytes()

    # rovnaký obsah znova = nič nové
    assert mp.publish(model="ASR", path=v1, base=73, changes=changes, db_url=db_url,
                      project_code=code)["status"] == "unchanged"


@needs_db
def test_same_model_code_in_two_projects_is_two_models(tmp_path, db_url, storage, project) -> None:
    """D-189: ASR of one project is not ASR of another; each has its own container and revision line."""
    import psycopg

    code, pid = project
    other_code = f"U{code[1:]}"
    with psycopg.connect(DB, autocommit=True) as conn:
        other = str(conn.execute("insert into objects (object_type, object_ref, name) values ('project', %s, %s) "
                                 "returning id", (other_code, other_code)).fetchone()[0])
    try:
        mp.publish(model="ASR", path=_model(tmp_path, "a", [W1], project=code), base=None, revision=5,
                   strict=False, db_url=db_url, project_code=code)
        res = mp.publish(model="ASR", path=_model(tmp_path, "b", [W1, W2], project=other_code), base=None,
                         revision=1, strict=False, db_url=db_url, project_code=other_code)
        assert res["status"] == "published" and res["revision"] == 1
        assert _container(db_url, pid) != _container(db_url, other)
        assert [r[0] for r in _revisions(db_url, pid)] == [5]
        assert [r[0] for r in _revisions(db_url, other)] == [1]
    finally:
        drop_project(other)


@needs_db
def test_publish_rejects_wrong_project_name_and_file_name(tmp_path, db_url, storage, project) -> None:
    code, _ = project
    res = mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1], project=code).rename(
        tmp_path / f"{code}_DPS_SO01_ARS_DiMS_001_ok.ifc"), base=None, strict=False, db_url=db_url,
        project_code=code)
    assert res["status"] == "published"
    wrong = _model(tmp_path, "x", [W1], project="OCB")
    named = wrong.rename(tmp_path / f"{code}_DPS_SO01_ARS_DiMS_001_x.ifc")
    res = mp.publish(model="ASR", path=named, base=0, strict=False, db_url=db_url, project_code=code)
    assert res["status"] == "guard_failed" and "IfcProject.Name" in res["guard"]["errors"][0]
    with pytest.raises(SystemExit, match="CDE scheme"):
        mp.publish(model="ASR", path=_model(tmp_path, "plain", [W1], project="P").rename(tmp_path / "ASR.ifc"),
                   base=0, strict=False, db_url=db_url, project_code=code)


@needs_db
def test_publish_conflict_when_base_is_stale(tmp_path, db_url, storage, project) -> None:
    code, pid = project
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1], project=code), base=None, strict=False,
               db_url=db_url, project_code=code)
    mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1, W2], project=code), base=0,
               changes={"changes": [{"guid": W2, "op": "add"}]}, db_url=db_url, project_code=code)
    with pytest.raises(mp.Conflict):
        mp.publish(model="ASR", path=_model(tmp_path, "v1b", [W1, W3], project=code), base=0,
                   changes={"changes": [{"guid": W3, "op": "add"}]}, db_url=db_url, project_code=code)
    assert [r[0] for r in _revisions(db_url, pid)] == [0, 1]


@needs_db
def test_publish_guard_failure_writes_nothing(tmp_path, db_url, storage, project) -> None:
    code, pid = project
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1, W2], project=code), base=None, strict=False,
               db_url=db_url, project_code=code)
    before = dict(storage)
    res = mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1], project=code), base=0,
                     changes={"changes": []}, db_url=db_url, project_code=code)
    assert res["status"] == "guard_failed" and res["guard"]["removed"] == [W2]
    assert storage == before and len(_revisions(db_url, pid)) == 1


@needs_db
def test_revert_is_a_new_revision(tmp_path, db_url, storage, project) -> None:
    code, pid = project
    v0 = _model(tmp_path, "v0", [W1, W2], project=code)
    mp.publish(model="ASR", path=v0, base=None, strict=False, db_url=db_url, project_code=code)
    mp.publish(model="ASR", path=_model(tmp_path, "v1", [W1], project=code), base=0,
               changes={"changes": [{"guid": W2, "op": "remove"}]}, db_url=db_url, project_code=code)
    res = mp.revert("ASR", 0, db_url=db_url, project_code=code)
    assert res["status"] == "published" and res["revision"] == 2
    assert storage[f"{_container(db_url, pid)}.ifc"] == v0.read_bytes()
    assert _revisions(db_url, pid)[-1] == (2, 1, True, "návrat na v0")


@needs_db
def test_task_is_resolved_with_result_revision(tmp_path, db_url, storage, project) -> None:
    import psycopg

    code, pid = project
    with psycopg.connect(db_url) as conn:
        task = conn.execute(
            "insert into model_tasks (model, title, project_id) values ('ASR', 't', %s) returning id", (pid,)
        ).fetchone()[0]
        conn.commit()
    mp.publish(model="ASR", path=_model(tmp_path, "v0", [W1], project=code), base=None, strict=False,
               task_id=str(task), db_url=db_url, project_code=code)
    with psycopg.connect(db_url) as conn:
        assert conn.execute(
            "select status, result_revision from model_tasks where id = %s", (task,)
        ).fetchone() == ("resolved", 0)


def test_archive_keys_by_project() -> None:
    """OCB keeps its code paths; every other project uses the container UUID (D-190)."""
    ocb = mp.ModelRef("OCB", "p-ocb", "ASR", "c-1")
    new = mp.ModelRef("STAGE2", "p-2", "ASR", "3f1c")
    assert (mp.archive_key(ocb, 7), mp.current_key(ocb)) == ("archive/ASR/v007.ifc.gz", "ASR.ifc")
    assert (mp.archive_key(new, 7), mp.current_key(new)) == ("archive/3f1c/v007.ifc.gz", "3f1c.ifc")
    assert mp.storage_key("ifc/archive/ASR/v079.ifc.gz") == "archive/ASR/v079.ifc.gz"


@needs_db
def test_bcf_topic_without_model_and_atomic_comment(db_url, project) -> None:
    """D-099: téma nad federáciou nemá model; komentár sa pripája bez prepisu poľa."""
    import psycopg

    _, pid = project
    with psycopg.connect(db_url) as conn:
        task, number = conn.execute(
            "insert into model_tasks (title, assigned_to, project_id) values ('t', 'claude', %s) "
            "returning id, number", (pid,)
        ).fetchone()
        first = conn.execute("select model_task_add_comment(%s, 'Claude', 'a')", (task,)).fetchone()[0]
        conn.execute("select model_task_add_comment(%s, 'Samuel', 'b')", (task,))
        assert conn.execute("select model_task_add_comment(gen_random_uuid(), 'x', 'y')").fetchone()[0] is None
        row = conn.execute(
            "select comments, modified_by, topic_type, status from model_tasks where id = %s", (task,)
        ).fetchone()
    assert number >= 1 and first["comment"] == "a" and first["guid"]
    assert [c["comment"] for c in row[0]] == ["a", "b"]
    assert row[1:] == ("Samuel", "Issue", "open")


def test_changes_file_format_roundtrip(tmp_path: Path) -> None:
    """Zoznam zmien je obyčajný JSON; poistka číta len `changes[].guid` a `op`."""
    doc = {"summary": "s", "changes": [{"guid": W1, "ifc_class": "IfcWall", "op": "modify",
                                        "what": "Pset_WallCommon.FireRating",
                                        "before": "REI 30", "after": "REI 60"}]}
    p = tmp_path / "zmeny.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    base = _model(tmp_path, "base", [W1])
    assert mp.guard(_model(tmp_path, "new", [W1]), base, json.loads(p.read_text())).ok
