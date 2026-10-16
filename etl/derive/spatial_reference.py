"""Odvodzovač `spatial_reference` (D-080): prvok → priestor podľa geometrie.

Pre každý prvok federácie (default: IfcDistributionElement + IfcFurnishingElement)
zistí, v ktorých priestorových prvkoch (default: IfcSpace, IfcSpatialZone) leží,
a vydá hranu `rel_referenced_in_spatial_structure` (IFC-kanonická,
IfcRelReferencedInSpatialStructure — neexkluzívna, takže nekoliduje s natívnym
`ContainedInStructure` prvku na podlaží, ktoré je SET[0:1]).

Priestor = hranol: pôdorys tela IfcSpace × výška od podlahy po úroveň podlažia
nad ním (VZT býva v podhľade nad telom miestnosti). Prvok reprezentuje stred
obálky + vzorka vrcholov; podiel bodov vnútri priestoru určí rolu:
  * `inside`  — aspoň `inside_ratio` bodov (prvok je v miestnosti),
  * `partial` — aspoň `partial_ratio` bodov (napr. potrubie prechádza miestnosťou).
Prvok, ktorý zdrojový súbor už obsahuje priamo v tom priestore, sa preskočí.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import DerivedEdge
from .geometry import Footprint, footprint, iter_meshes, map_frame, offset_to, points_inside, sample_points

REL_TYPE = "rel_referenced_in_spatial_structure"


@dataclass
class SpatialReferenceConfig:
    element_classes: tuple[str, ...] = ("IfcDistributionElement", "IfcFurnishingElement")
    spatial_classes: tuple[str, ...] = ("IfcSpace", "IfcSpatialZone")
    inside_ratio: float = 0.5
    partial_ratio: float = 0.1
    extend_to_storey_above: bool = True
    max_points: int = 48


@dataclass
class SpatialReferenceResult:
    edges: list[DerivedEdge] = field(default_factory=list)
    elements_total: int = 0
    elements_matched: int = 0
    spaces_total: int = 0
    unmatched: list[tuple[str, str]] = field(default_factory=list)  # (guid, ifc_type)
    # QA: dvojice priestorov, do ktorých naraz padol ten istý prvok s rolou inside —
    # priestory sa prekrývajú (duplicitné miestnosti, Revit Areas ako IfcSpace…).
    overlaps: dict[tuple[str, str], int] = field(default_factory=dict)


def _by_types(model, classes) -> list:
    out = []
    for c in classes:
        try:
            out.extend(model.by_type(c))
        except RuntimeError:
            pass  # trieda v schéme modelu neexistuje (napr. IfcSpatialZone v IFC2X3)
    return out


def _native_space_containment(model) -> set[tuple[str, str]]:
    pairs = set()
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        st = rel.RelatingStructure
        for e in rel.RelatedElements:
            pairs.add((e.GlobalId, st.GlobalId))
    for rel in model.by_type("IfcRelReferencedInSpatialStructure"):
        st = rel.RelatingStructure
        for e in rel.RelatedElements:
            if hasattr(e, "GlobalId"):
                pairs.add((e.GlobalId, st.GlobalId))
    return pairs


def _storey_tops(models, offsets) -> list[float]:
    """Úrovne podlaží (m, referenčný rámec) zo všetkých modelov, zoradené."""
    levels = set()
    for model, off in zip(models, offsets):
        scale = _length_scale(model)
        for s in model.by_type("IfcBuildingStorey"):
            if s.Elevation is not None:
                levels.add(round(float(s.Elevation) * scale + off[2], 3))
    return sorted(levels)


def _length_scale(model) -> float:
    """Prevod dĺžkovej jednotky projektu na metre (IfcSIUnit s prefixom)."""
    try:
        import ifcopenshell.util.unit as uu

        return float(uu.calculate_unit_scale(model))
    except Exception:  # pragma: no cover - fallback pre staré ifcopenshell
        return 1.0


def derive(models: list, config: SpatialReferenceConfig | None = None) -> SpatialReferenceResult:
    """`models[0]` je referenčný rámec; ostatné sa zarovnajú cez IfcMapConversion."""
    cfg = config or SpatialReferenceConfig()
    ref_frame = map_frame(models[0])
    offsets = [offset_to(ref_frame, map_frame(m)) for m in models]
    levels = _storey_tops(models, offsets)

    footprints: list[Footprint] = []
    for model, off in zip(models, offsets):
        for mesh in iter_meshes(model, _by_types(model, cfg.spatial_classes), off):
            z_top = None
            if cfg.extend_to_storey_above:
                z0 = float(mesh.verts[:, 2].min())
                above = [lv for lv in levels if lv > z0 + 0.5]
                z_top = above[0] if above else None
            fp = footprint(mesh, z_top=z_top)
            if fp is not None:
                footprints.append(fp)

    native = set().union(*(_native_space_containment(m) for m in models))
    res = SpatialReferenceResult(spaces_total=len(footprints))
    space_guids = {fp.guid for fp in footprints}

    for model, off in zip(models, offsets):
        for mesh in iter_meshes(model, _by_types(model, cfg.element_classes), off):
            res.elements_total += 1
            pts = sample_points(mesh, cfg.max_points)
            ratios = []
            for fp in footprints:
                # rýchly prefilter obálkou
                if (
                    pts[:, 0].max() < fp.xy_min[0] or pts[:, 0].min() > fp.xy_max[0]
                    or pts[:, 1].max() < fp.xy_min[1] or pts[:, 1].min() > fp.xy_max[1]
                    or pts[:, 2].max() < fp.z_min or pts[:, 2].min() > fp.z_max
                ):
                    continue
                r = float(points_inside(fp, pts).mean())
                if r >= cfg.partial_ratio:
                    ratios.append((r, fp.guid))
            if not ratios:
                res.unmatched.append((mesh.guid, mesh.ifc_type))
                continue
            res.elements_matched += 1
            inside = sorted(g for r, g in ratios if r >= cfg.inside_ratio)
            for i, a in enumerate(inside):
                for b in inside[i + 1:]:
                    res.overlaps[(a, b)] = res.overlaps.get((a, b), 0) + 1
            for r, sguid in sorted(ratios, reverse=True):
                if (mesh.guid, sguid) in native:
                    continue
                role = "inside" if r >= cfg.inside_ratio else "partial"
                res.edges.append(DerivedEdge(REL_TYPE, mesh.guid, sguid, role, round(r, 3)))

    assert all(e.to_guid in space_guids for e in res.edges)
    return res
