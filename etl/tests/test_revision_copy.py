"""Úplná kópia revízie a porovnanie revízií (D-183 K2) nad malým IFC súborom.

Unit testy sú bez DB. Zápis do DB a SQL porovnanie overuje `test_revision_copy_db` len pri premennej
`AIM_TEST_DATABASE_URL` (lokálny Postgres s migráciami, nikdy produkcia)."""

from __future__ import annotations

import gzip
import hashlib
import json
import os

import ifcopenshell
import ifcopenshell.guid
import pytest

from etl import revision_compare, revision_copy


def _point(f, xyz):
    return f.createIfcCartesianPoint([float(c) for c in xyz])


def _placement(f, rel_to, xyz):
    return f.createIfcLocalPlacement(rel_to, f.createIfcAxis2Placement3D(_point(f, xyz), None, None))


def _model(*, seg_x: float = 1000.0, terminal_name: str = "VV.02.01", length: float = 2.4,
           manufacturer: str = "ACME", damper_storey: str = "2NP", storey_z: float = 3000.0,
           drop_segment: bool = False) -> ifcopenshell.file:
    """Mini VZT: 2 podlažia, prívodný systém, potrubie s Qto, vyústka s typom a psetom typu, klapka, port,
    geometria (tvar a poloha), história vlastníka. GlobalId prvkov sú pevné, psetov a vzťahov náhodné (ako Revit)."""
    f = ifcopenshell.file(schema="IFC4X3_ADD2")
    g = ifcopenshell.guid.new
    person = f.createIfcPerson(None, "Augustin", "Samuel")
    org = f.createIfcOrganization(None, "Assetin")
    app = f.createIfcApplication(org, "2027", "Autodesk Revit 2027", "Revit")
    oh = f.createIfcOwnerHistory(f.createIfcPersonAndOrganization(person, org), app, None, "NOCHANGE", None, None, None, 0)
    units = f.createIfcUnitAssignment([f.createIfcSIUnit(None, "LENGTHUNIT", "MILLI", "METRE")])
    ctx = f.createIfcGeometricRepresentationContext(None, "Model", 3, 1e-5, f.createIfcAxis2Placement3D(_point(f, (0, 0, 0)), None, None), None)
    project = f.createIfcProject("0PROJECT00000000000000", oh, "OCB", RepresentationContexts=[ctx], UnitsInContext=units)
    site = f.createIfcSite("0SITE0000000000000000", oh, "Parcela", ObjectPlacement=_placement(f, None, (0, 0, 0)))
    building = f.createIfcBuilding("0BUILDING000000000000", oh, "SO01", ObjectPlacement=_placement(f, site.ObjectPlacement, (0, 0, 0)))
    s2 = f.createIfcBuildingStorey("0STOREY2NP00000000000", oh, "2NP", ObjectPlacement=_placement(f, building.ObjectPlacement, (0, 0, storey_z)), Elevation=storey_z)
    s3 = f.createIfcBuildingStorey("0STOREY3NP00000000000", oh, "3NP", ObjectPlacement=_placement(f, building.ObjectPlacement, (0, 0, 6000)), Elevation=6000.0)
    f.createIfcRelAggregates(g(), oh, RelatingObject=project, RelatedObjects=[site])
    f.createIfcRelAggregates(g(), oh, RelatingObject=site, RelatedObjects=[building])
    f.createIfcRelAggregates(g(), oh, RelatingObject=building, RelatedObjects=[s2, s3])

    body = f.createIfcShapeRepresentation(ctx, "Body", "SweptSolid", [f.createIfcCartesianPoint([0.0, 0.0, 0.0])])
    seg = f.createIfcDuctSegment("0SEGMENT0000000000000", oh, "PO.02.0001", ObjectPlacement=_placement(f, s2.ObjectPlacement, (seg_x, 0, 0)),
                                 Representation=f.createIfcProductDefinitionShape(None, None, [body]), PredefinedType="RIGIDSEGMENT")
    seg2 = f.createIfcDuctSegment("0SEGMENT2000000000000", oh, "PO.02.0002", ObjectPlacement=_placement(f, s2.ObjectPlacement, (5000, 0, 0)))
    term = f.createIfcAirTerminal("0TERMINAL000000000000", oh, terminal_name, ObjectPlacement=_placement(f, s2.ObjectPlacement, (2000, 0, 0)))
    damper = f.createIfcDamper("0DAMPER00000000000000", oh, "KL.02.003", ObjectPlacement=_placement(f, (s2 if damper_storey == "2NP" else s3).ObjectPlacement, (3000, 0, 0)))
    port = f.createIfcDistributionPort("0PORT0000000000000000", oh, "Port", ObjectPlacement=_placement(f, seg.ObjectPlacement, (0, 0, 0)), FlowDirection="SOURCE")
    elems2 = [seg, term] + ([] if drop_segment else [seg2]) + ([damper] if damper_storey == "2NP" else [])
    f.createIfcRelContainedInSpatialStructure(g(), oh, RelatingStructure=s2, RelatedElements=elems2)
    if damper_storey != "2NP":
        f.createIfcRelContainedInSpatialStructure(g(), oh, RelatingStructure=s3, RelatedElements=[damper])
    if drop_segment:
        f.remove(seg2)
    f.createIfcRelNests(g(), oh, RelatingObject=seg, RelatedObjects=[port])

    system = f.createIfcDistributionSystem("0SYSTEM00000000000000", oh, "Prívod-2NP", PredefinedType="VENTILATION")
    members = [e for e in (seg, term, damper) if e is not None] + ([] if drop_segment else [seg2])
    f.createIfcRelAssignsToGroup(g(), oh, RelatedObjects=members, RelatingGroup=system)

    ttype = f.createIfcAirTerminalType("0TERMTYPE000000000000", oh, "Vyústka typ", PredefinedType="DIFFUSER")
    tps = f.createIfcPropertySet(g(), oh, "Pset_ManufacturerTypeInformation", None,
                                 [f.createIfcPropertySingleValue("Manufacturer", None, f.createIfcLabel(manufacturer), None)])
    ttype.HasPropertySets = [tps]
    f.createIfcRelDefinesByType(g(), oh, RelatedObjects=[term], RelatingType=ttype)

    qto = f.createIfcElementQuantity(g(), oh, "Qto_DuctSegmentBaseQuantities", None, None,
                                     [f.createIfcQuantityLength("Length", None, None, length, None)])
    pset = f.createIfcPropertySet(g(), oh, "Pset_DuctSegmentCommon", None, [
        f.createIfcPropertySingleValue("Reference", None, f.createIfcIdentifier("R1"), None),
        f.createIfcPropertyEnumeratedValue("Shape", None, [f.createIfcLabel("ROUND")], None),
    ])
    f.createIfcRelDefinesByProperties(g(), oh, RelatedObjects=[seg], RelatingPropertyDefinition=qto)
    f.createIfcRelDefinesByProperties(g(), oh, RelatedObjects=[seg], RelatingPropertyDefinition=pset)

    doc = f.createIfcDocumentInformation("D.1.1.09", "Pôdorys 2NP")
    f.createIfcRelAssociatesDocument(g(), oh, RelatedObjects=[seg], RelatingDocument=doc)
    mat = f.createIfcMaterial("Pozink")
    f.createIfcRelAssociatesMaterial(g(), oh, RelatedObjects=[seg], RelatingMaterial=mat)
    return f


def _rows(copy, attr):
    return {tuple(r[k] for k in attr[1]): r for r in getattr(copy, attr[0])}


def test_extract_full_copy_without_geometry() -> None:
    f = _model()
    copy = revision_copy.extract(f)
    exp = copy.expected
    # každý IfcRoot je objekt, vzťah alebo sada vlastností
    assert exp["ifc_root"] == exp["ifc_root_accounted"] == len(f.by_type("IfcRoot"))
    objs = {o["global_id"]: o for o in copy.objects}
    assert exp["objects"]["IfcDuctSegment"] == 2 and "0PORT0000000000000000" in objs
    seg = objs["0SEGMENT0000000000000"]
    assert seg["attributes"]["Name"] == "PO.02.0001" and seg["attributes"]["PredefinedType"] == "RIGIDSEGMENT"
    # bez geometrie, polohy a OwnerHistory v atribútoch; história len informačne
    text = json.dumps([o["attributes"] for o in copy.objects])
    for word in ("Representation", "ObjectPlacement", "IfcCartesianPoint", "IfcShapeRepresentation", "OwnerHistory"):
        assert word not in text
    assert seg["file_owner_history"]["ChangeAction"] == "NOCHANGE"
    assert seg["file_owner_history"]["OwningApplication"] == "Autodesk Revit 2027"
    # jednotky projektu ostanú (nie sú geometria)
    assert objs["0PROJECT00000000000000"]["attributes"]["UnitsInContext"]["Units"][0]["Prefix"] == "MILLI"


def test_relationship_pairs_and_natural_keys() -> None:
    copy = revision_copy.extract(_model())
    rels = _rows(copy, ("relationships", ("rel_class", "relating", "related")))
    assert ("IfcRelContainedInSpatialStructure", "0STOREY2NP00000000000", "0SEGMENT0000000000000") in rels
    assert ("IfcRelAssignsToGroup", "0SYSTEM00000000000000", "0DAMPER00000000000000") in rels
    assert ("IfcRelNests", "0SEGMENT0000000000000", "0PORT0000000000000000") in rels
    assert ("IfcRelDefinesByType", "0TERMTYPE000000000000", "0TERMINAL000000000000") in rels
    # strana bez GlobalId: prirodzený kľúč
    assert ("IfcRelAssociatesDocument", "IfcDocumentInformation:D.1.1.09", "0SEGMENT0000000000000") in rels
    assert ("IfcRelAssociatesMaterial", "IfcMaterial:Pozink", "0SEGMENT0000000000000") in rels
    # psety nie sú vo vzťahoch, ale v sadách (nositeľ, meno)
    assert not any(r["rel_class"] == "IfcRelDefinesByProperties" for r in copy.relationships)
    assert sum(copy.expected["relationship_pairs"].values()) == sum(r["multiplicity"] for r in copy.relationships)


def test_property_sets_on_occurrence_and_type() -> None:
    copy = revision_copy.extract(_model())
    ps = _rows(copy, ("property_sets", ("global_id", "pset_name")))
    assert ps[("0SEGMENT0000000000000", "Qto_DuctSegmentBaseQuantities")]["properties"] == {"Length": 2.4}
    common = ps[("0SEGMENT0000000000000", "Pset_DuctSegmentCommon")]["properties"]
    assert common == {"Reference": "R1", "Shape": ["ROUND"]}
    assert ps[("0TERMTYPE000000000000", "Pset_ManufacturerTypeInformation")]["properties"] == {"Manufacturer": "ACME"}
    assert copy.expected["pset_orphans"] == 0


def test_hashes_ignore_own_guids_of_psets_and_relationships() -> None:
    """Revit pri exporte mení GlobalId psetov a vzťahov: kópia ostane rovnaká (D-183 P1)."""
    a, b = revision_copy.extract(_model()), revision_copy.extract(_model())
    for part in ("objects", "relationships", "property_sets"):
        assert sorted(r["content_hash"] for r in getattr(a, part)) == sorted(r["content_hash"] for r in getattr(b, part))
    assert a.relationships[0]["rel_global_ids"] != b.relationships[0]["rel_global_ids"]


def test_single_value_change_changes_only_its_row() -> None:
    a = _rows(revision_copy.extract(_model()), ("property_sets", ("global_id", "pset_name")))
    b = _rows(revision_copy.extract(_model(length=2.4004)), ("property_sets", ("global_id", "pset_name")))
    changed = [k for k in a if a[k]["content_hash"] != b[k]["content_hash"]]
    assert changed == [("0SEGMENT0000000000000", "Qto_DuctSegmentBaseQuantities")]


def test_number_precision() -> None:
    assert revision_copy.value(2.4000000000001) == 2.4
    assert revision_copy.value(2.4004) == 2.4004
    assert revision_copy.value(3.0) == 3


def test_duplicate_guids_and_header() -> None:
    f = _model()
    assert revision_copy.duplicate_guids(f) == []
    f.createIfcWall("0SEGMENT0000000000000")
    assert revision_copy.duplicate_guids(f) == ["0SEGMENT0000000000000"]
    h = revision_copy.file_header(f)
    assert h["FILE_SCHEMA"] == ["IFC4X3_ADD2"] and "FILE_NAME" in h


def test_open_verified_rejects_wrong_sha() -> None:
    data = _model().to_string().encode()
    _, sha = revision_copy.open_verified(data, hashlib.sha256(data).hexdigest())
    assert sha == hashlib.sha256(data).hexdigest()
    with pytest.raises(SystemExit):
        revision_copy.open_verified(data, "0" * 64)


def test_completeness_reports_differences() -> None:
    exp = {"objects": {"IfcWall": 2}, "relationship_pairs": {}, "pset_attachments": {}, "ifc_root": 3, "ifc_root_accounted": 3}
    assert revision_copy.completeness(exp, {"objects": {"IfcWall": 2}}) == []
    assert revision_copy.completeness(exp, {"objects": {"IfcWall": 1}}) == ["objects.IfcWall: súbor 2, DB 1"]
    assert revision_copy.completeness({**exp, "ifc_root_accounted": 2}, {"objects": {"IfcWall": 2}})


# ── poloha (zo súborov) ───────────────────────────────────────────────────────

def test_placement_relative_to_storey() -> None:
    res = revision_compare.placement_changes(_model(), _model(seg_x=1100.0))
    assert set(res["elements"]) == {"0SEGMENT0000000000000"}
    assert res["elements"]["0SEGMENT0000000000000"]["dx"] == pytest.approx(0.1)
    # port sa pohol s potrubím: voči hostiteľovi stojí, MODIFIED je len potrubie
    assert res["common_shift"] is None and res["georeference"] is None


def test_placement_below_tolerance_is_nochange() -> None:
    assert revision_compare.placement_changes(_model(), _model(seg_x=1000.5))["elements"] == {}


def test_storey_move_marks_only_storey() -> None:
    res = revision_compare.placement_changes(_model(), _model(storey_z=3200.0))
    assert set(res["elements"]) == {"0STOREY2NP00000000000"}


def test_moved_to_other_storey_is_relation_not_placement() -> None:
    res = revision_compare.placement_changes(_model(), _model(damper_storey="3NP"))
    assert "0DAMPER00000000000000" not in res["elements"]


def test_merge_adds_placement_aspect() -> None:
    rows = [{"global_id": "A", "ifc_class": "IfcDamper", "change_action": "MODIFIED", "aspects": {"attributes": ["Name"]}},
            {"global_id": "B", "ifc_class": "IfcAirTerminal", "change_action": "NOCHANGE", "aspects": {"via_type": "T"}}]
    placement = {"elements": {"A": {"dx": 0.1}, "B": {"dx": 0.2}, "C": {"dz": 1.0}}}
    out = {r["global_id"]: r for r in revision_compare.merge(rows, placement, {"C": "IfcWall"})}
    assert out["A"]["aspects"] == {"attributes": ["Name"], "placement": {"dx": 0.1}}
    assert out["B"]["change_action"] == "MODIFIED" and out["B"]["aspects"]["via_type"] == "T"
    assert out["C"] == {"global_id": "C", "ifc_class": "IfcWall", "change_action": "MODIFIED", "aspects": {"placement": {"dz": 1.0}}}


# ── DB (len lokálny Postgres s migráciami) ────────────────────────────────────

DB = os.environ.get("AIM_TEST_DATABASE_URL")


@pytest.mark.skipif(not DB, reason="AIM_TEST_DATABASE_URL nie je nastavené (lokálny Postgres s migráciami)")
def test_revision_copy_db(tmp_path) -> None:
    import psycopg

    files = {1: _model(), 2: _model(terminal_name="VV.02.01-X", length=2.1, manufacturer="INÝ",
                                       damper_storey="3NP", drop_segment=True, seg_x=1100.0)}
    paths = {}
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute("delete from model_revisions where model = 'TST'")
        for rev, f in files.items():
            data = f.to_string().encode()
            paths[rev] = tmp_path / f"v{rev}.ifc.gz"
            paths[rev].write_bytes(gzip.compress(data))
            cur.execute("insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) "
                        "values ('TST', %s, %s, %s, %s, %s, 'x')",
                        (rev, rev - 1 if rev > 1 else None, rev == 2, hashlib.sha256(data).hexdigest(), len(data)))
        conn.commit()
    try:
        for rev in files:
            res = revision_copy.run("TST", rev, paths[rev], dry_run=False, force=False, db_url=DB)
            assert res["status"] == "done"
        assert revision_copy.run("TST", 1, paths[1], dry_run=False, force=False, db_url=DB)["status"] == "already_done"
        with psycopg.connect(DB) as conn, conn.cursor() as cur:
            got = cur.execute("select count(*) from ifc_rev_storey_elements('TST', 1, '2NP', 'Prívod%')").fetchone()[0]
            assert got == 4
            assert cur.execute("select count(*) from ifc_rev_storey_elements('TST', null, '2NP', 'Prívod%')").fetchone()[0] == 2
            header = cur.execute("select cr.file_header -> 'FILE_SCHEMA' from container_revisions cr "
                                 "join model_revisions m on m.id = cr.model_revision_id where m.model = 'TST' and m.revision = 1").fetchone()[0]
            assert header == ["IFC4X3_ADD2"]
        out = revision_compare.compare("TST", 1, 2, True, paths[1], paths[2], db_url=DB)
        by = {r["global_id"]: r for r in out["changes"]}
        assert by["0SEGMENT2000000000000"]["change_action"] == "DELETED"
        assert by["0TERMINAL000000000000"]["aspects"] == {"attributes": ["Name"]}
        assert by["0TERMTYPE000000000000"]["aspects"] == {"psets": ["Pset_ManufacturerTypeInformation.Manufacturer"]}
        assert by["0DAMPER00000000000000"]["aspects"]["relations"] == [
            "-IfcRelContainedInSpatialStructure:0STOREY2NP00000000000", "+IfcRelContainedInSpatialStructure:0STOREY3NP00000000000"]
        seg = by["0SEGMENT0000000000000"]["aspects"]
        assert seg["psets"] == ["Qto_DuctSegmentBaseQuantities.Length"] and seg["placement"]["dx"] == pytest.approx(0.1)
        assert out["summary"]["NOCHANGE_via_type"] == 0  # vyústka sa zmenila sama (meno), poznámku cez typ nedostane
        # chybný sha256 archívu: nič sa nezapíše
        with pytest.raises(SystemExit):
            revision_copy.run("TST", 2, paths[1], dry_run=False, force=True, db_url=DB)
    finally:
        with psycopg.connect(DB) as conn, conn.cursor() as cur:
            cur.execute("delete from model_revisions where model = 'TST' and revision = 2")
            cur.execute("delete from model_revisions where model = 'TST'")
            cur.execute("delete from information_containers where model = 'TST'")
            conn.commit()
