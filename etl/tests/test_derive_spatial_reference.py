"""Odvodzovač prvok → priestor (D-080): zarovnanie, rekonciliácia zápisu, integrácia.

DB sa nepoužíva (stub kurzor). Integračný test postaví malý IFC4X3 model cez
ifcopenshell.api: dve miestnosti 4×4×3 m vedľa seba, vyústenie v prvej, vyústenie
nad telom miestnosti (podhľad), vyústenie mimo a potrubie cez obe miestnosti.
"""

from __future__ import annotations

import numpy as np
import pytest

from etl.derive import DerivedEdge
from etl.derive.db import edge_uuid, write_edges
from etl.derive.geometry import MapFrame, offset_to


def test_offset_between_map_conversions() -> None:
    ref = MapFrame(100.0, 200.0, 0.0, 1.0, 0.0)
    other = MapFrame(110.0, 195.0, 1.0, 1.0, 0.0)
    assert offset_to(ref, other).tolist() == [10.0, -5.0, 1.0]
    rot = MapFrame(0.0, 0.0, 0.0, 0.0, 1.0)  # os X modelu = sever
    assert np.allclose(offset_to(rot, MapFrame(0.0, 10.0, 0.0, 0.0, 1.0)), [10.0, 0.0, 0.0])
    with pytest.raises(ValueError):
        offset_to(ref, MapFrame(0, 0, 0, 0.0, 1.0))


class StubCursor:
    def __init__(self, guid_rows, allowed=(["asset"], ["space"]), closed=()):
        self.calls: list[tuple[str, tuple]] = []
        self._guid_rows, self._allowed, self._closed = guid_rows, allowed, closed
        self._last = ""

    def execute(self, sql: str, params: tuple = ()) -> "StubCursor":
        self._last = " ".join(sql.split())
        self.calls.append((self._last, params))
        return self

    def fetchall(self):
        if "from ifc_guid_history" in self._last:
            return self._guid_rows
        if self._last.startswith("update relationships"):
            return [(c,) for c in self._closed]
        return []

    def fetchone(self):
        return self._allowed


def test_write_edges_upserts_resolvable_and_closes_stale() -> None:
    rows = [("E1", "uuid-e1", "asset"), ("S1", "uuid-s1", "space"), ("D1", "uuid-d1", "document")]
    cur = StubCursor(rows, closed=("old-1",))
    edges = [
        DerivedEdge("rel_referenced_in_spatial_structure", "E1", "S1", "inside"),
        DerivedEdge("rel_referenced_in_spatial_structure", "E2", "S1", "inside"),  # E2 nie je v DB
        DerivedEdge("rel_referenced_in_spatial_structure", "D1", "S1", "inside"),  # nepovolený typ
    ]
    st = write_edges(cur, "derive:spatial_reference", "rel_referenced_in_spatial_structure", edges)
    assert (st.written, st.closed) == (1, 1)
    assert st.unresolved_guids == {"E2"}
    assert st.disallowed == [("D1", "document")]
    inserts = [c for c in cur.calls if c[0].startswith("insert into relationships")]
    assert len(inserts) == 1
    eid = edge_uuid("derive:spatial_reference", edges[0])
    assert inserts[0][1] == (eid, "rel_referenced_in_spatial_structure", "uuid-e1", "uuid-s1",
                             "inside", "derive:spatial_reference")
    update = [c for c in cur.calls if c[0].startswith("update relationships")][0]
    assert update[1] == ("derive:spatial_reference", "rel_referenced_in_spatial_structure", [eid])


def test_edge_uuid_is_deterministic() -> None:
    e = DerivedEdge("rel_referenced_in_spatial_structure", "E1", "S1", "inside")
    assert edge_uuid("derive:x", e) == edge_uuid("derive:x", DerivedEdge(e.rel_type, "E1", "S1", "partial"))
    assert edge_uuid("derive:x", e) != edge_uuid("derive:y", e)


def _model():
    ifcopenshell = pytest.importorskip("ifcopenshell")
    api = pytest.importorskip("ifcopenshell.api")
    m = ifcopenshell.api.run("project.create_file", version="IFC4X3")
    project = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcProject")
    ifcopenshell.api.run("unit.assign_unit", m)
    ctx = ifcopenshell.api.run("context.add_context", m, context_type="Model")
    body = ifcopenshell.api.run("context.add_context", m, context_type="Model",
                                context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
    building = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcBuilding")
    ifcopenshell.api.run("aggregate.assign_object", m, relating_object=project, products=[building])
    storeys = []
    for elev in (0.0, 4.0):
        st = ifcopenshell.api.run("root.create_entity", m, ifc_class="IfcBuildingStorey")
        st.Elevation = elev * 1000  # mm (unit.assign_unit default)
        ifcopenshell.api.run("aggregate.assign_object", m, relating_object=building, products=[st])
        storeys.append(st)

    def placed(ifc_class, x, y, z, dx, dy, dz, storey, name):
        el = ifcopenshell.api.run("root.create_entity", m, ifc_class=ifc_class, name=name)
        mat = np.eye(4)
        mat[:3, 3] = [x, y, z]  # api pracuje v SI (m), súbor je v mm
        ifcopenshell.api.run("geometry.edit_object_placement", m, product=el, matrix=mat)
        rep = ifcopenshell.api.run("geometry.add_wall_representation", m, context=body,
                                   length=dx, height=dz, thickness=dy)
        ifcopenshell.api.run("geometry.assign_representation", m, product=el, representation=rep)
        if ifc_class == "IfcSpace":
            ifcopenshell.api.run("aggregate.assign_object", m, relating_object=storey, products=[el])
        else:
            ifcopenshell.api.run("spatial.assign_container", m, relating_structure=storey, products=[el])
        return el

    space = placed("IfcSpace", 0, 0, 0, 4, 4, 3, storeys[0], "1.01")
    space2 = placed("IfcSpace", 4, 0, 0, 4, 4, 3, storeys[0], "1.02")
    t_in = placed("IfcAirTerminal", 1, 1, 2.5, 0.3, 0.3, 0.1, storeys[0], "in")
    t_plenum = placed("IfcAirTerminal", 2, 2, 3.5, 0.3, 0.3, 0.1, storeys[0], "plenum")
    t_out = placed("IfcAirTerminal", 9, 6, 1, 0.3, 0.3, 0.1, storeys[0], "out")
    duct = placed("IfcDuctSegment", 2, 1.5, 2, 4, 0.3, 0.3, storeys[0], "duct")
    return m, space, space2, t_in, t_plenum, t_out, duct


def test_derive_inside_partial_and_unmatched() -> None:
    from etl.derive.spatial_reference import REL_TYPE, SpatialReferenceConfig, derive

    m, space, space2, t_in, t_plenum, t_out, duct = _model()
    res = derive([m])
    got = {(e.from_guid, e.to_guid, e.role) for e in res.edges}
    assert (t_in.GlobalId, space.GlobalId, "inside") in got
    # potrubie prechádza oboma miestnosťami → partial v oboch, inside v žiadnej
    assert (duct.GlobalId, space.GlobalId, "partial") in got
    assert (duct.GlobalId, space2.GlobalId, "partial") in got
    assert all(e.rel_type == REL_TYPE for e in res.edges)
    # nad telom miestnosti = mimo; rozhoduje telo IfcSpace, nie heuristika
    unmatched = {g for g, _ in res.unmatched}
    assert {t_plenum.GlobalId, t_out.GlobalId} <= unmatched
    assert res.overlaps == {}

    strict = derive([m], SpatialReferenceConfig(include_partial=False))
    assert duct.GlobalId not in {e.from_guid for e in strict.edges}


def _faceted_box(m, x, y, z, d, flip=frozenset()):
    """IfcFacetedBrep kocky d×d×d na (x, y, z) v mm; `flip` = indexy stien s opačným poradím
    vrcholov (Revit exportuje rodiny s nejednotne orientovanými stenami)."""
    p = [m.createIfcCartesianPoint((x + dx * d, y + dy * d, z + dz * d))
         for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    faces = []
    for i, q in enumerate(quads):
        pts = [p[k] for k in (reversed(q) if i in flip else q)]
        faces.append(m.createIfcFace([m.createIfcFaceOuterBound(m.createIfcPolyLoop(pts), True)]))
    return m.createIfcFacetedBrep(m.createIfcClosedShell(faces))


def test_faceted_brep_with_inconsistent_faces_is_matched() -> None:
    """#92: výustky a tvarovky VZT z Revitu majú telo IfcFacetedBrep (často cez IfcMappedItem
    typu) s nejednotne orientovanými stenami; bez `reorient-shells` ich presný test voči telu
    priestoru minul a nedostali žiadnu hranu."""
    import ifcopenshell.guid

    from etl.derive.spatial_reference import derive

    m, space, *_ = _model()
    body = next(c for c in m.by_type("IfcGeometricRepresentationSubContext")
                if c.ContextIdentifier == "Body")
    storey = m.by_type("IfcBuildingStorey")[0]
    origin = m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((0.0, 0.0, 0.0)))
    terminals = []
    for name, x, flip in (("brep", 500.0, {1, 3}), ("mapped", 2500.0, {0, 2, 5})):
        brep = _faceted_box(m, x, 500.0, 2000.0, 300.0, flip)
        rep = m.createIfcShapeRepresentation(body, "Body", "Brep", [brep])
        if name == "mapped":
            src = m.createIfcRepresentationMap(origin, rep)
            target = m.createIfcCartesianTransformationOperator3D(
                None, None, m.createIfcCartesianPoint((0.0, 0.0, 0.0)), 1.0, None)
            rep = m.createIfcShapeRepresentation(body, "Body", "MappedRepresentation",
                                                 [m.createIfcMappedItem(src, target)])
        el = m.createIfcAirTerminal(GlobalId=ifcopenshell.guid.new(), Name=name,
                                    ObjectPlacement=m.createIfcLocalPlacement(None, origin),
                                    Representation=m.createIfcProductDefinitionShape(None, None, [rep]))
        m.createIfcRelContainedInSpatialStructure(
            ifcopenshell.guid.new(), None, None, None, [el], storey)
        terminals.append(el)

    got = {(e.from_guid, e.to_guid, e.role) for e in derive([m]).edges}
    for el in terminals:
        assert (el.GlobalId, space.GlobalId, "inside") in got, el.Name
