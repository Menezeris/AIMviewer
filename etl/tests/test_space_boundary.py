"""IfcRelSpaceBoundary → hrana `space_boundary` (D-156) nad malým IFC súborom.

Dvere DD01.08 ležia v štruktúre len na podlaží a s miestnosťou 1.01 ich spája iba hranica
priestoru (1st level, plus druhá hranica 2nd level virtual). Druhé dvere sú hranicou
spojené s dvoma miestnosťami; stena má len virtuálnu hranicu."""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.guid

from etl import manifest, transform


def _model() -> ifcopenshell.file:
    f = ifcopenshell.file(schema="IFC4X3_ADD2")
    g = ifcopenshell.guid.new
    project = f.createIfcProject(g(), Name="OCB")
    site = f.createIfcSite(g(), Name="Parcela")
    building = f.createIfcBuilding(g(), Name="SO01")
    storey = f.createIfcBuildingStorey(g(), Name="1NP", Elevation=0.0)
    s101 = f.createIfcSpace(g(), Name="1.01", LongName="Lobby")
    s102 = f.createIfcSpace(g(), Name="1.02", LongName="Chodba")
    f.createIfcRelAggregates(g(), RelatingObject=project, RelatedObjects=[site])
    f.createIfcRelAggregates(g(), RelatingObject=site, RelatedObjects=[building])
    f.createIfcRelAggregates(g(), RelatingObject=building, RelatedObjects=[storey])
    f.createIfcRelAggregates(g(), RelatingObject=storey, RelatedObjects=[s101, s102])

    d1 = f.createIfcDoor(g(), Name="DD01.08.0001")
    d2 = f.createIfcDoor(g(), Name="DD01.04.01")
    wall = f.createIfcWall(g(), Name="W1")
    f.createIfcRelContainedInSpatialStructure(g(), RelatingStructure=storey,
                                              RelatedElements=[d1, d2, wall])

    def boundary(space, element, kind, level="IfcRelSpaceBoundary2ndLevel"):
        return f.create_entity(
            level, GlobalId=g(), RelatingSpace=space, RelatedBuildingElement=element,
            PhysicalOrVirtualBoundary=kind, InternalOrExternalBoundary="INTERNAL",
        )

    boundary(s101, d1, "VIRTUAL")        # druhá hranica toho istého páru: vyhrá physical
    boundary(s101, d1, "PHYSICAL", "IfcRelSpaceBoundary")
    boundary(s101, d2, "PHYSICAL")
    boundary(s102, d2, "PHYSICAL")
    boundary(s102, wall, "VIRTUAL")
    return f


def _edges():
    st = transform.to_staged(_model())
    kind = {o.object_ref: o.name for o in st.objects}
    return {(kind[e.from_ref], kind[e.to_ref]): e.role for e in st.edges if e.edge_type == "space_boundary"}


def test_boundary_edges_one_per_pair_with_role() -> None:
    got = _edges()
    assert got == {
        ("DD01.08.0001", "1.01"): "physical",
        ("DD01.04.01", "1.01"): "physical",
        ("DD01.04.01", "1.02"): "physical",
        ("W1", "1.02"): "virtual",
    }


def test_boundary_to_unemitted_object_is_dropped() -> None:
    f = _model()
    g = ifcopenshell.guid.new
    space = f.by_type("IfcSpace")[0]
    ghost = f.createIfcOpeningElement(g(), Name="ghost")   # nie je asset
    f.create_entity("IfcRelSpaceBoundary", GlobalId=g(), RelatingSpace=space,
                    RelatedBuildingElement=ghost, PhysicalOrVirtualBoundary="PHYSICAL")
    st = transform.to_staged(f)
    assert len([e for e in st.edges if e.edge_type == "space_boundary"]) == 4


def test_manifest_routes_space_boundary() -> None:
    assert manifest.EDGE_TYPE_TO_REL_TYPE["space_boundary"] == "rel_space_boundary"
    spec = next(s for s in manifest._SPECS if s.rel_type == "rel_space_boundary")
    assert spec.ifc_entity == "IfcRelSpaceBoundary" and spec.to_object_types == ["space"]
