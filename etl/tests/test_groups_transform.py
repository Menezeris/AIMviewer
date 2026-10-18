"""Projekt, zóny a skupiny ako uzly AIM (D-087) nad malým IFC súborom.

ASR v72 nesie IfcProject, IfcZone (nájomné jednotky, šachty), IfcSpatialZone
(požiarne úseky, energetické zóny) a IfcGroup (skladby). ETL ich emituje ako
`project` / `zone` / `spatial_zone` / `group` aj s väzbami, takže dokumenty na nich
už nevypadnú (predtým `_drop_unemitted_links`).
"""

from __future__ import annotations

from collections import Counter

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
    space = f.createIfcSpace(g(), Name="1.01", LongName="Lobby")
    f.createIfcRelAggregates(g(), RelatingObject=project, RelatedObjects=[site])
    f.createIfcRelAggregates(g(), RelatingObject=site, RelatedObjects=[building])
    f.createIfcRelAggregates(g(), RelatingObject=building, RelatedObjects=[storey])
    f.createIfcRelAggregates(g(), RelatingObject=storey, RelatedObjects=[space])

    fire = f.createIfcSpatialZone(g(), Name="N1.01", PredefinedType="FIRESAFETY")
    part = f.createIfcSpatialZone(g(), Name="N1.01a", PredefinedType="FIRESAFETY")
    f.createIfcRelContainedInSpatialStructure(g(), RelatingStructure=storey, RelatedElements=[fire])
    f.createIfcRelReferencedInSpatialStructure(g(), RelatingStructure=fire, RelatedElements=[space])
    f.createIfcRelAggregates(g(), RelatingObject=fire, RelatedObjects=[part])

    unit = f.createIfcZone(g(), Name="NJ - Retail 1")
    parent = f.createIfcZone(g(), Name="Nájomné priestory")
    f.createIfcRelAssignsToGroup(g(), RelatedObjects=[space], RelatingGroup=unit)
    f.createIfcRelAssignsToGroup(g(), RelatedObjects=[unit, fire], RelatingGroup=parent)

    s1 = f.createIfcGroup(g(), Name="S1")
    s101 = f.createIfcGroup(g(), Name="S1.01")
    f.createIfcRelAggregates(g(), RelatingObject=s1, RelatedObjects=[s101])

    doc = f.createIfcDocumentInformation(Identification="D.1.1.09", Name="Výpis skladieb")
    f.createIfcRelAssociatesDocument(g(), RelatedObjects=[project, s1, fire, unit],
                                     RelatingDocument=doc)
    return f


def test_project_zones_and_groups_are_emitted() -> None:
    st = transform.to_staged(_model())
    types = Counter(o.object_type for o in st.objects)
    assert types["project"] == 1 and types["zone"] == 2
    assert types["spatial_zone"] == 2 and types["group"] == 2

    kind = {o.object_ref: o.object_type for o in st.objects}
    edges = Counter((e.edge_type, kind[e.from_ref], kind[e.to_ref]) for e in st.edges)
    assert edges[("aggregates", "site", "project")] == 1
    assert edges[("aggregates", "spatial_zone", "spatial_zone")] == 1
    assert edges[("aggregates", "group", "group")] == 1
    assert edges[("contained", "spatial_zone", "floor")] == 1
    assert edges[("referenced", "space", "spatial_zone")] == 1
    assert edges[("assigns_to_group", "space", "zone")] == 1
    assert edges[("assigns_to_group", "zone", "zone")] == 1
    assert edges[("assigns_to_group", "spatial_zone", "zone")] == 1
    # dokumenty na projekte, skupine aj zónach ostávajú
    assert edges[("has_document", "project", "document")] == 1
    assert sum(n for (t, *_), n in edges.items() if t == "has_document") == 4
    assert not st.coverage.unlinked


def test_federate_does_not_emit_project_or_zones() -> None:
    st = transform.to_staged(_model(), federate=True, existing_floors=[("1NP", 0.0, "1NP")])
    assert not {"project", "zone", "spatial_zone", "group"} & {o.object_type for o in st.objects}
    # dokumenty na neemitovaných entitách sa vynechajú a zrátajú
    assert st.coverage.unlinked == {"IfcProject": 1, "IfcGroup": 1, "IfcSpatialZone": 1, "IfcZone": 1}
