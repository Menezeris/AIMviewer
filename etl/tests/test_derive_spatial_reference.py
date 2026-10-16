"""Odvodzovač prvok → priestor (D-080): geometria, rekonciliácia zápisu, integrácia.

DB sa nepoužíva (stub kurzor). Integračný test postaví malý IFC4X3 model cez
ifcopenshell.api: miestnosť 4×4×3 m na podlaží 0 m, nad ňou podlažie 4 m,
vyústenie v miestnosti, vyústenie v podhľade (nad telom miestnosti) a vyústenie
mimo nej.
"""

from __future__ import annotations

import numpy as np
import pytest

from etl.derive import DerivedEdge
from etl.derive.db import edge_uuid, write_edges
from etl.derive.geometry import MapFrame, Mesh, footprint, offset_to, points_inside


def _box(guid: str, x0, y0, z0, x1, y1, z1) -> Mesh:
    v = np.array([[x, y, z] for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)], dtype=float)
    f = np.array([
        [0, 2, 1], [1, 2, 3],  # spodok
        [4, 5, 6], [5, 7, 6],  # vrch
        [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7],
        [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5],
    ])
    return Mesh(guid, "IfcSpace", v, f)


def test_points_inside_l_shaped_footprint_and_height() -> None:
    # L-tvar = dva kvádre zlúčené do jedného „telesa" (zjednotenie projekcií).
    a, b = _box("s", 0, 0, 0, 4, 2, 3), _box("s", 0, 2, 0, 2, 4, 3)
    mesh = Mesh("s", "IfcSpace", np.vstack([a.verts, b.verts]), np.vstack([a.faces, b.faces + 8]))
    fp = footprint(mesh, z_top=4.0)
    pts = np.array([
        [1, 1, 1],    # dnu
        [3, 3, 1],    # vo výreze L → von
        [1, 3, 3.5],  # v podhľade nad telom (z_top=4) → dnu
        [1, 1, 4.5],  # nad podlažím → von
    ], dtype=float)
    assert points_inside(fp, pts).tolist() == [True, False, True, False]


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
    t_in = placed("IfcAirTerminal", 1, 1, 2.5, 0.3, 0.3, 0.1, storeys[0], "in")
    t_plenum = placed("IfcAirTerminal", 2, 2, 3.5, 0.3, 0.3, 0.1, storeys[0], "plenum")
    t_out = placed("IfcAirTerminal", 6, 6, 1, 0.3, 0.3, 0.1, storeys[0], "out")
    return m, space, t_in, t_plenum, t_out


def test_derive_assigns_terminals_to_space_including_plenum() -> None:
    from etl.derive.spatial_reference import REL_TYPE, SpatialReferenceConfig, derive

    m, space, t_in, t_plenum, t_out = _model()
    res = derive([m])
    got = {(e.from_guid, e.to_guid, e.role) for e in res.edges}
    assert (t_in.GlobalId, space.GlobalId, "inside") in got
    assert (t_plenum.GlobalId, space.GlobalId, "inside") in got
    assert all(e.rel_type == REL_TYPE for e in res.edges)
    assert (t_out.GlobalId, "IfcAirTerminal") in res.unmatched

    strict = derive([m], SpatialReferenceConfig(extend_to_storey_above=False))
    assert t_plenum.GlobalId not in {e.from_guid for e in strict.edges}
