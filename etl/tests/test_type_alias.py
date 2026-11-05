"""Merging IFC types with the same type code (D-033) as data: GUID alias (D-183 K3 step 3).

Doors DD01.06.01 and DD01.06.02 have two different IfcDoorTypes, but the type code is one (DD01.06) -> one
`asset_type`. The GUID of the second type is written as an alias of the same node (`ifc_guid_aliases`), not as its
history; `rel_defines_by_type` from the revision copy thus finds it without guessing by object_ref.
"""

from __future__ import annotations

import ifcopenshell
import ifcopenshell.guid

from etl import transform


def _model() -> ifcopenshell.file:
    f = ifcopenshell.file(schema="IFC4X3_ADD2")
    g = ifcopenshell.guid.new
    project = f.createIfcProject(g(), Name="OCB")
    site = f.createIfcSite(g(), Name="Parcela")
    building = f.createIfcBuilding(g(), Name="SO01")
    storey = f.createIfcBuildingStorey(g(), Name="1NP", Elevation=0.0)
    f.createIfcRelAggregates(g(), RelatingObject=project, RelatedObjects=[site])
    f.createIfcRelAggregates(g(), RelatingObject=site, RelatedObjects=[building])
    f.createIfcRelAggregates(g(), RelatingObject=building, RelatedObjects=[storey])
    d1 = f.createIfcDoor(g(), Name="DD01.06.01")
    d2 = f.createIfcDoor(g(), Name="DD01.06.02")
    d3 = f.createIfcDoor(g(), Name="DD01.02.01")
    f.createIfcRelContainedInSpatialStructure(g(), RelatingStructure=storey, RelatedElements=[d1, d2, d3])
    t1 = f.createIfcDoorType(g(), Name="Dvere 800")
    t2 = f.createIfcDoorType(g(), Name="Dvere 800 zrkadlové")
    t3 = f.createIfcDoorType(g(), Name="Dvere 900")
    f.createIfcRelDefinesByType(g(), RelatedObjects=[d1], RelatingType=t1)
    f.createIfcRelDefinesByType(g(), RelatedObjects=[d2], RelatingType=t2)
    f.createIfcRelDefinesByType(g(), RelatedObjects=[d3], RelatingType=t3)
    return f


def test_merged_type_guid_becomes_alias_of_shared_asset_type() -> None:
    f = _model()
    st = transform.to_staged(f)
    types = {o.object_ref: o for o in st.objects if o.object_type == "asset_type"}
    assert set(types) == {"DD01.06", "DD01.02"}
    guids = {t.Name: t.GlobalId for t in f.by_type("IfcDoorType")}
    emitted = types["DD01.06"].ifc_guid
    merged = ({guids["Dvere 800"], guids["Dvere 800 zrkadlové"]} - {emitted}).pop()
    # one alias: the second type with code DD01.06; a type with its own code has no alias
    assert [(a.object_ref, a.ifc_guid, a.reason) for a in st.guid_aliases] == [("DD01.06", merged, "type_code")]
    # the GUID history stays one active GUID per node (D-010), the alias is not in it
    assert merged not in {h.ifc_guid for h in st.guid_history}
    assert st.coverage.types_merged == 1
