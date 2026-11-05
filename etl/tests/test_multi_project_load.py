"""ETL writes project_id (D-189): project from IfcProject.Name, `<code>:` refs outside OCB, per-project close
and reset, discipline IfcProject as an alias, read-only `--check-db`.

The unit tests need no database. The load tests run only with `AIM_TEST_DATABASE_URL` (a local Postgres with
all migrations and the OCB project node, never production) and remove what they wrote.
"""

from __future__ import annotations

import os
import uuid

import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.guid
import pytest

from etl import project as project_mod
from etl import transform
from etl.model import Edge, GuidAlias, GuidHistory, ObjectRow, StagedModel

OCB = project_mod.OCB_ID
OCB_GUID = "2Xj8NwiwHD_hFSIx764rKm"  # IfcProject of OCB's ASR (D-189)


def build(name: str, project_guid: str, federate: bool = False, storey: str = "1NP") -> ifcopenshell.file:
    """Small model: site / building / storey / space, a typed wall with an actor; or (federate) one duct
    segment of a discipline model with its own IfcProject."""
    f = api.run("project.create_file", version="IFC4X3_ADD2")
    p = api.run("root.create_entity", f, ifc_class="IfcProject", name=name)
    p.GlobalId = project_guid
    if federate:
        api.run("root.create_entity", f, ifc_class="IfcDuctSegment", name="D1")
        return f
    site = api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
    bld = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="B")
    st = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name=storey)
    sp = api.run("root.create_entity", f, ifc_class="IfcSpace", name="1.01")
    api.run("aggregate.assign_object", f, products=[site], relating_object=p)
    api.run("aggregate.assign_object", f, products=[bld], relating_object=site)
    api.run("aggregate.assign_object", f, products=[st], relating_object=bld)
    api.run("aggregate.assign_object", f, products=[sp], relating_object=st)
    wall = api.run("root.create_entity", f, ifc_class="IfcWall", name="W1")
    wt = api.run("root.create_entity", f, ifc_class="IfcWallType", name="WT")
    api.run("type.assign_type", f, related_objects=[wall], relating_type=wt)
    api.run("spatial.assign_container", f, products=[wall], relating_structure=st)
    person = f.createIfcPerson(Identification="jd", FamilyName="Doe", GivenName="Jane")
    actor = f.createIfcActor(ifcopenshell.guid.new(), TheActor=person)
    f.createIfcRelAssignsToActor(ifcopenshell.guid.new(), RelatedObjects=[wall], RelatingActor=actor)
    return f


def renamed(f: ifcopenshell.file, name: str) -> ifcopenshell.file:
    """The same file (same GUIDs) for another project, e.g. the next stage."""
    g = ifcopenshell.file.from_string(f.to_string())
    g.by_type("IfcProject")[0].Name = name
    return g


# ── unit tests (no DB) ───────────────────────────────────────────────────────

def test_project_name_must_match_the_code() -> None:
    with pytest.raises(project_mod.ProjectError, match="IfcProject.Name is 'OCB'.*project 'STG2'"):
        transform.to_staged(build("OCB", OCB_GUID), project_code="STG2")
    with pytest.raises(project_mod.ProjectError, match="exactly one IfcProject"):
        f = build("OCB", OCB_GUID)
        f.createIfcProject(ifcopenshell.guid.new(), Name="OCB")
        project_mod.check_file(f, "OCB")


def test_project_ref_is_the_code_and_ocb_refs_stay_plain() -> None:
    s = transform.to_staged(build("OCB", OCB_GUID), project_code="OCB")
    assert (s.project_code, s.project_guid) == ("OCB", OCB_GUID)
    assert [o.object_ref for o in s.objects if o.object_type == "project"] == ["OCB"]
    assert not any(":" in o.object_ref for o in s.objects)
    assert not any("_ref" in o.properties for o in s.objects)


def test_other_project_gets_prefixed_refs_actors_stay_global() -> None:
    s = transform.to_staged(build("STG2", OCB_GUID), project_code="STG2")
    by_type = {o.object_type: o for o in s.objects}
    assert by_type["project"].object_ref == "STG2"
    assert by_type["person"].object_ref == "IfcPerson"           # global node, shared by projects
    assert by_type["space"].object_ref == "STG2:1.01" and by_type["space"].properties["_ref"] == "1.01"
    assert all(o.object_ref.startswith("STG2:") for o in s.objects if o.object_type not in ("project", "person"))
    refs = {o.object_ref for o in s.objects}
    assert all(e.from_ref in refs and e.to_ref in refs for e in s.edges)
    assert all(g.object_ref in refs for g in s.guid_history)
    assert ("aggregates", "STG2:Site", "STG2") in {(e.edge_type, e.from_ref, e.to_ref) for e in s.edges}


def test_qualify_refs_rewrites_every_reference() -> None:
    m = StagedModel(project_code="X")
    m.objects += [ObjectRow("A", "asset"), ObjectRow("X", "project"), ObjectRow("P1", "person")]
    m.edges += [Edge("responsible_for", "P1", "A"), Edge("contained", "A", "1NP")]
    m.guid_history.append(GuidHistory("A", "G"))
    m.guid_aliases.append(GuidAlias("T", "G2"))
    project_mod.qualify_refs(m, "X")
    assert [o.object_ref for o in m.objects] == ["X:A", "X", "P1"]
    assert [(e.from_ref, e.to_ref) for e in m.edges] == [("P1", "X:A"), ("X:A", "X:1NP")]
    assert (m.guid_history[0].object_ref, m.guid_aliases[0].object_ref) == ("X:A", "X:T")


def test_discipline_model_project_becomes_an_alias() -> None:
    s = transform.to_staged(build("OCB", "1ujCBri_f5JOmrrxrlahvh", federate=True), federate=True,
                            project_code="OCB")
    assert not any(o.object_type == "project" for o in s.objects)
    assert [(a.object_ref, a.ifc_guid, a.reason) for a in s.guid_aliases] == [
        ("OCB", "1ujCBri_f5JOmrrxrlahvh", project_mod.ALIAS_REASON)]


@pytest.mark.parametrize("name, ok", [
    ("STG2_DPS_SO01_ARS_DiMS_001_Model.ifc", True),
    ("STG2_DPS_SO01_ARS_DiMS_001_Model.ifc.gz", True),
    ("OCB_DPS_SO01_ARS_DiMS_001_Model.ifc", False),     # another project's code
    ("STG2_DPS_SO01_ARS_VD_001_Model.ifc", False),      # not a model (DiMS)
    ("ASR.ifc", False),                                 # no CDE name
])
def test_cde_file_name_for_new_projects(name: str, ok: bool) -> None:
    if ok:
        assert project_mod.check_file_name(name, "STG2") == []
    else:
        with pytest.raises(project_mod.ProjectError):
            project_mod.check_file_name(name, "STG2")


def test_ocb_file_names_are_grandfathered() -> None:
    assert project_mod.check_file_name("ASR.ifc", "OCB") == []
    assert project_mod.check_file_name("VZT_v011.ifc", "OCB") == []


def test_unknown_cde_codes_are_warnings() -> None:
    assert project_mod.check_file_name("STG2_ZZZ_SO01_ARS_DiMS_001_M.ifc", "STG2") == ["StupeňPD=ZZZ"]


def test_project_code_from_cli_env_default(monkeypatch) -> None:
    from etl import config

    monkeypatch.delenv("AIM_PROJECT", raising=False)
    assert config.project_code() == "OCB"
    monkeypatch.setenv("AIM_PROJECT", "STG2")
    assert config.project_code() == "STG2"
    assert config.project_code("X1") == "X1"


# ── load against a local database ────────────────────────────────────────────

DB = os.environ.get("AIM_TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not DB, reason="AIM_TEST_DATABASE_URL nie je nastavené (lokálny Postgres s migráciami)")


def _snapshot(cur, project_id: str) -> dict[str, list]:
    """Every row of one project's graph, for 'this load did not touch that project'."""
    return {
        "objects": cur.execute(
            "select id, object_ref, object_type, name, ifc_guid, properties, valid_until, updated_at, project_id "
            "from objects where project_id = %s order by id", (project_id,)).fetchall(),
        "relationships": cur.execute(
            "select id, rel_type, from_id, to_id, valid_until, source from relationships "
            "where project_id = %s order by id", (project_id,)).fetchall(),
        "guid_history": cur.execute(
            "select h.id, h.ifc_guid, h.valid_until, h.source from ifc_guid_history h join objects o "
            "on o.id = h.object_id where o.project_id = %s order by h.id", (project_id,)).fetchall(),
        "aliases": cur.execute(
            "select id, ifc_guid, valid_until, source from ifc_guid_aliases where project_id = %s order by id",
            (project_id,)).fetchall(),
    }


@pytest.fixture
def stage_code():
    """A second project code; everything it got is removed afterwards, OCB's test rows too."""
    import psycopg

    from etl.db import reset_data

    code = f"S{uuid.uuid4().hex[:5].upper()}"
    yield code
    with psycopg.connect(DB, autocommit=True) as conn, conn.cursor() as cur:
        for c in (code, "OCB"):
            pid = project_mod.resolve(cur, c)
            if pid:
                reset_data(cur, pid)
        cur.execute("delete from objects where object_type = 'project' and object_ref = %s", (code,))
        cur.execute("delete from objects where object_type in ('person', 'organization') and object_ref = 'IfcPerson'")


@needs_db
def test_two_projects_with_the_same_elements(stage_code) -> None:
    import psycopg

    from etl.check_db import compare
    from etl.db import load_model, reset_data

    code = stage_code
    main = build("OCB", OCB_GUID)
    load_model(DB, transform.to_staged(main, project_code="OCB"), scope="ASR")

    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        ocb_before = _snapshot(cur, OCB)
        assert all(r[8] is not None and str(r[8]) == OCB for r in ocb_before["objects"])
        assert cur.execute("select ifc_guid from objects where id = %s", (OCB,)).fetchone()[0] == OCB_GUID

    # The next stage: the same file, the same GUIDs and codes, another project.
    load_model(DB, transform.to_staged(renamed(main, code), project_code=code), scope="ASR")
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        pid = project_mod.resolve(cur, code)
        assert pid is not None and pid != OCB
        assert cur.execute("select project_id::text, ifc_guid from objects where id = %s",
                           (pid,)).fetchone() == (pid, OCB_GUID)
        assert _snapshot(cur, OCB) == ocb_before, "loading another project changed OCB"
        rows = cur.execute("select object_ref, object_type, properties->>'_ref' from objects where project_id = %s "
                           "and id <> %s", (pid, pid)).fetchall()
        assert len(rows) == len(ocb_before["objects"]) - 1
        assert all(ref.startswith(f"{code}:") and plain == ref.split(":", 1)[1] for ref, _, plain in rows)
        # the actor is one global node, its edges carry the project of the element (trigger, D-189)
        person = cur.execute("select project_id from objects where object_ref = 'IfcPerson'").fetchone()
        assert person == (None,)
        edge_projects = cur.execute(
            "select r.project_id::text from relationships r join objects o on o.id = r.from_id "
            "where o.object_ref = 'IfcPerson' and r.valid_until is null order by 1").fetchall()
        assert sorted(p for (p,) in edge_projects) == sorted([OCB, pid])

        # read-only check: a re-run of either load changes nothing
        assert compare(cur, transform.to_staged(main, project_code="OCB"), "OCB", scope="ASR").total == 0
        diff = compare(cur, transform.to_staged(renamed(main, code), project_code=code), code, scope="ASR")
        assert diff.total == 0, diff.report()

    # a discipline model of the stage maps its IfcProject onto the stage node as an alias
    duct = build(code, ifcopenshell.guid.new(), federate=True)
    staged = transform.to_staged(duct, federate=True, project_code=code)
    load_model(DB, staged, scope="VZT")
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        alias = cur.execute("select object_id::text, project_id::text, reason from ifc_guid_aliases "
                            "where ifc_guid = %s and valid_until is null",
                            (duct.by_type("IfcProject")[0].GlobalId,)).fetchone()
        assert alias == (pid, pid, project_mod.ALIAS_REASON)
        assert _snapshot(cur, OCB) == ocb_before
        assert compare(cur, transform.to_staged(duct, federate=True, project_code=code), code,
                       scope="VZT").total == 0

    # a re-run of the stage keeps the alias and changes no row of either project
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        stage_before = _snapshot(cur, pid)
    load_model(DB, transform.to_staged(duct, federate=True, project_code=code), scope="VZT")
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        after = _snapshot(cur, pid)
        assert after["aliases"] == stage_before["aliases"] and after["relationships"] == stage_before["relationships"]

    # reset of the stage removes only the stage
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        reset_data(cur, pid)
        conn.commit()
        assert cur.execute("select count(*) from objects where project_id = %s", (pid,)).fetchone()[0] == 1
        assert _snapshot(cur, OCB) == ocb_before


@needs_db
def test_check_db_reports_what_a_load_would_change(stage_code) -> None:
    import psycopg

    from etl.check_db import compare
    from etl.db import load_model

    code = stage_code
    main = build(code, ifcopenshell.guid.new())
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        diff = compare(cur, transform.to_staged(main, project_code=code), code, scope="ASR")
    assert diff.project_id is None and "objects" in diff.added
    load_model(DB, transform.to_staged(main, project_code=code), scope="ASR")

    # the wall is renamed and the space removed in the next revision
    nxt = ifcopenshell.file.from_string(main.to_string())
    nxt.by_type("IfcWall")[0].Name = "W1-renamed"
    space = nxt.by_type("IfcSpace")[0]
    api.run("root.remove_product", nxt, product=space)
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        diff = compare(cur, transform.to_staged(nxt, project_code=code), code, scope="ASR")
    assert any("(name)" in c for c in diff.changed.get("objects", [])), diff.report()
    assert diff.closed.get("ifc_guid_history"), diff.report()


@needs_db
def test_federate_without_project_node_fails(stage_code) -> None:
    from etl.db import load_model

    staged = transform.to_staged(build(stage_code, ifcopenshell.guid.new(), federate=True), federate=True,
                                 project_code=stage_code)
    with pytest.raises(project_mod.ProjectError, match="load the main model"):
        load_model(DB, staged, scope="VZT")


@needs_db
def test_revision_copy_is_keyed_by_model_revision_id(tmp_path, stage_code) -> None:
    """The same model code and revision number in two projects: two revision copies (D-189)."""
    import gzip
    import hashlib

    import psycopg

    from etl import revision_copy
    from etl.db import load_model

    code = stage_code
    main = build("OCB", OCB_GUID)
    load_model(DB, transform.to_staged(renamed(main, code), project_code=code), scope="ASR")
    data = renamed(main, code).to_string().encode()
    path = tmp_path / "v001.ifc.gz"
    path.write_bytes(gzip.compress(data))
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        pid = project_mod.resolve(cur, code)
        cur.execute("insert into model_revisions (model, revision, is_current, sha256, size_bytes, archive_path, "
                    "project_id) values ('TSTM', 1, true, %s, %s, 'x', %s)",
                    (hashlib.sha256(data).hexdigest(), len(data), pid))
        conn.commit()
    try:
        res = revision_copy.run("TSTM", 1, path, dry_run=False, force=False, db_url=DB, project_code=code)
        assert res["status"] == "done" and res["project"] == code
        with psycopg.connect(DB) as conn, conn.cursor() as cur:
            mid = cur.execute("select id from model_revisions where project_id = %s and model = 'TSTM'",
                              (pid,)).fetchone()[0]
            n = cur.execute("select count(*) from ifc_rev_objects where model_revision_id = %s", (mid,)).fetchone()[0]
            assert n > 0
            assert cur.execute("select status from ifc_rev_imports where model_revision_id = %s",
                               (mid,)).fetchone() == ("done",)
        with pytest.raises(SystemExit, match="nie je v model_revisions"):
            revision_copy.run("TSTM", 1, path, dry_run=False, force=False, db_url=DB, project_code="OCB")
    finally:
        with psycopg.connect(DB, autocommit=True) as conn:
            pid = project_mod.resolve(conn.cursor(), code)
            conn.execute("delete from model_revisions where project_id = %s", (pid,))
            conn.execute("delete from information_containers where project_id = %s", (pid,))
