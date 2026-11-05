"""Relationship manifest IFC end types (D-196, R10): migration block equals the generator output.

Needs ifcopenshell only (the schema ships with it); CI runs it in the `ifc-manifest` job.
"""

from __future__ import annotations

import pytest

pytest.importorskip("ifcopenshell")

from etl import manifest as m  # noqa: E402
from etl.entity_manifest import ROOT  # noqa: E402


def _by_type() -> dict[str, m.RelType]:
    return {r.rel_type: r for r in m.build_manifest()}


def test_migration_block_matches_generator():
    text = (ROOT / m.IFC_TYPES_MIGRATION).read_text(encoding="utf-8")
    assert m.migration_ifc_types_block(text) == m.sql_ifc_types(), (
        "drift: replace the generated block with python -m etl.manifest --sql-ifc-types"
    )


def test_declared_end_types():
    rows = _by_type()
    # Relating = to end: the To types are the Relating attribute.
    assert rows["rel_aggregates"].from_ifc_types == ["IfcObjectDefinition"]
    assert rows["rel_contained_in_spatial_structure"].from_ifc_types == ["IfcProduct"]
    assert rows["rel_contained_in_spatial_structure"].to_ifc_types == ["IfcSpatialElement"]
    assert rows["rel_space_boundary"].to_ifc_types == ["IfcExternalSpatialElement", "IfcSpace"]
    assert rows["rel_defines_by_type"].to_ifc_types == ["IfcTypeObject"]
    # SELECT expanded to entities.
    assert rows["rel_referenced_in_spatial_structure"].from_ifc_types == ["IfcGroup", "IfcProduct"]
    assert rows["rel_associates_document"].to_ifc_types == ["IfcDocumentInformation", "IfcDocumentReference"]
    assert "IfcExternalInformation" in rows["rel_external_reference_relationship"].from_ifc_types
    # Relating = from end; PLATFORM.md 5.3: the actor is an IfcActor node.
    assert rows["rel_assigns_to_actor"].from_ifc_types == ["IfcActor"]
    assert "actor" in rows["rel_assigns_to_actor"].from_object_types
    # Resource without Relating/Related.
    assert (rows["rel_member_of"].from_ifc_types, rows["rel_member_of"].to_ifc_types) == (
        ["IfcPerson"], ["IfcOrganization"])
    # aim_* state their own; empty = no IFC check.
    assert rows["aim_rel_capture_located"].from_ifc_types == []
    assert rows["aim_rel_capture_located"].to_ifc_types == ["IfcSpatialElement"]
    assert rows["aim_rel_capture_media"].to_ifc_types == []


def test_every_type_is_an_entity():
    from ifcopenshell import ifcopenshell_wrapper as w

    schema = w.schema_by_name("IFC4X3_ADD2")
    for r in m.build_manifest():
        for t in (r.from_ifc_types or []) + (r.to_ifc_types or []):
            assert isinstance(schema.declaration_by_name(t), w.entity), (r.rel_type, t)


def test_aim_type_must_state_its_types(monkeypatch):
    bad = m.RelType(rel_type="aim_rel_x", ifc_entity=None, relating_attr=None, relating_end="to",
                    from_object_types=["capture"], to_object_types=["space"], namespace="aim",
                    export_path="icdd")
    monkeypatch.setattr(m, "_SPECS", [bad])
    with pytest.raises(ValueError, match="must state from_ifc_types"):
        m.build_manifest()


def test_ifc_type_must_not_be_stated_by_hand(monkeypatch):
    bad = m.RelType(rel_type="rel_aggregates", ifc_entity="IfcRelAggregates", relating_attr="RelatingObject",
                    related_attr="RelatedObjects", relating_end="to", from_object_types=["space"],
                    to_object_types=["floor"], from_ifc_types=["IfcSpace"])
    monkeypatch.setattr(m, "_SPECS", [bad])
    with pytest.raises(ValueError, match="come from the schema"):
        m.build_manifest()


def test_wrong_related_attr_fails(monkeypatch):
    bad = m.RelType(rel_type="rel_aggregates", ifc_entity="IfcRelAggregates", relating_attr="RelatingObject",
                    related_attr="RelatedElements", relating_end="to", from_object_types=["space"],
                    to_object_types=["floor"])
    monkeypatch.setattr(m, "_SPECS", [bad])
    with pytest.raises(ValueError, match="has no attribute 'RelatedElements'"):
        m.build_manifest()
