"""Odvodzovač `spatial_reference` (D-080): prvok → priestor podľa geometrie.

Pre každý prvok federácie (default: IfcDistributionElement + IfcFurnishingElement)
zistí, v ktorých priestorových prvkoch (default: IfcSpace, IfcSpatialZone) leží,
a vydá hranu `rel_referenced_in_spatial_structure` (IFC-kanonická,
IfcRelReferencedInSpatialStructure — neexkluzívna, takže nekoliduje s natívnym
`ContainedInStructure` prvku na podlaží, ktoré je SET[0:1]).

Geometriu rieši ifcopenshell: BVH strom nad presnými BRep telesami
(`ifcopenshell.geom.tree`, OpenCascade) a jeho priestorové dotazy:
  * `inside`  — prvok leží celý v tele priestoru (`select(space, completely_within=True)`),
  * `partial` — prvok telo priestoru pretína (`select(space)`), napr. potrubie
    prechádza miestnosťou.
Rozhoduje teda telo IfcSpace tak, ako ho model nesie; žiadna heuristika navyše
(ak VZT v podhľade nepadne do miestnosti, má model zle definované telo priestoru).
Modely federácie sa zarovnajú cez IfcMapConversion (`model-offset`).
Prvok, ktorý zdrojový súbor už priamo obsahuje/referencuje v tom priestore, sa preskočí.
"""

from __future__ import annotations

import multiprocessing
from dataclasses import dataclass, field

from . import DerivedEdge
from .geometry import map_frame, offset_to

REL_TYPE = "rel_referenced_in_spatial_structure"


@dataclass
class SpatialReferenceConfig:
    element_classes: tuple[str, ...] = ("IfcDistributionElement", "IfcFurnishingElement")
    spatial_classes: tuple[str, ...] = ("IfcSpace", "IfcSpatialZone")
    # Vydávať aj `partial` (prvok pretína priestor). False = len prvky celé vnútri.
    include_partial: bool = True


@dataclass
class SpatialReferenceResult:
    edges: list[DerivedEdge] = field(default_factory=list)
    elements_total: int = 0
    elements_matched: int = 0
    spaces_total: int = 0
    unmatched: list[tuple[str, str]] = field(default_factory=list)  # (guid, ifc_type)
    # QA: dvojice priestorov, v ktorých naraz celý leží ten istý prvok —
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


def _native_space_relations(model) -> set[tuple[str, str]]:
    pairs = set()
    for cls in ("IfcRelContainedInSpatialStructure", "IfcRelReferencedInSpatialStructure"):
        for rel in model.by_type(cls):
            st = rel.RelatingStructure
            for e in rel.RelatedElements:
                if hasattr(e, "GlobalId"):
                    pairs.add((e.GlobalId, st.GlobalId))
    return pairs


def _iterator(model, products, offset):
    """Iterátor natívnych BRep tvarov vo svetových súradniciach + posun federácie."""
    import ifcopenshell.geom
    from ifcopenshell import ifcopenshell_wrapper

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    settings.set("iterator-output", ifcopenshell_wrapper.NATIVE)
    if any(offset):
        settings.set("model-offset", tuple(float(x) for x in offset))
    return ifcopenshell.geom.iterator(settings, model, multiprocessing.cpu_count(), include=products)


def derive(models: list, config: SpatialReferenceConfig | None = None) -> SpatialReferenceResult:
    """`models[0]` je referenčný rámec; ostatné sa zarovnajú cez IfcMapConversion."""
    import ifcopenshell.geom

    cfg = config or SpatialReferenceConfig()
    ref_frame = map_frame(models[0])
    tree = ifcopenshell.geom.tree()
    spaces, elements = [], []
    for model in models:
        off = offset_to(ref_frame, map_frame(model))
        sp = _by_types(model, cfg.spatial_classes)
        el = _by_types(model, cfg.element_classes)
        if sp or el:
            tree.add_iterator(_iterator(model, sp + el, off))
        spaces.extend(sp)
        elements.extend(el)

    element_guids = {e.GlobalId: e for e in elements}
    native = set().union(*(_native_space_relations(m) for m in models))
    res = SpatialReferenceResult(spaces_total=len(spaces), elements_total=len(elements))

    inside: dict[str, set[str]] = {}
    partial: dict[str, set[str]] = {}
    for sp in spaces:
        within = {e.GlobalId for e in tree.select(sp, completely_within=True) if e.GlobalId in element_guids}
        for g in within:
            inside.setdefault(g, set()).add(sp.GlobalId)
        if cfg.include_partial:
            for e in tree.select(sp):
                if e.GlobalId in element_guids and e.GlobalId not in within:
                    partial.setdefault(e.GlobalId, set()).add(sp.GlobalId)

    for guid, el in element_guids.items():
        ins, par = sorted(inside.get(guid, ())), sorted(partial.get(guid, ()))
        if not ins and not par:
            res.unmatched.append((guid, el.is_a()))
            continue
        res.elements_matched += 1
        for i, a in enumerate(ins):
            for b in ins[i + 1:]:
                res.overlaps[(a, b)] = res.overlaps.get((a, b), 0) + 1
        for role, targets in (("inside", ins), ("partial", par)):
            for sguid in targets:
                if (guid, sguid) not in native:
                    res.edges.append(DerivedEdge(REL_TYPE, guid, sguid, role))
    return res
