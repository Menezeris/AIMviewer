"""Mapping IFC -> staged model (D-031), following SCHEMA.md + the CLAUDE conventions.

Covers the standard IFC patterns the schema models:
  - spatial hierarchy  Site->Building->Storey->Space  (IfcRelAggregates /
    IfcRelContainedInSpatialStructure)            -> objects + rel_aggregates / rel_contained_in_spatial_structure
  - elements (occurrence) + their types               -> objects(asset/asset_type)
    + rel_defines_by_type (IfcRelDefinesByType)
  - property sets (Pset_/Qto_ = standard, otherwise custom) -> properties JSONB
  - classifications on type and occurrence              -> classification_* + rel_associates_classification
  - documents, actors (B)                            -> documents/persons + rel_*

NOTE (to be tuned on the thesis model, D-031 prereq): the source of `object_ref`
(Tag/Name/GlobalId), which elements are an "asset", and the concrete pset/classification names
are model-specific. The places are marked `TODO(model)`.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import ifcopenshell
import ifcopenshell.util.element as ue

from . import project as project_mod
from . import scheme as scheme_mod
from .extract import attr
from .model import (
    ClassLink,
    ClassificationRef,
    ClassificationSystem,
    CoverageReport,
    DocumentExt,
    Edge,
    GuidAlias,
    GuidHistory,
    ObjectRow,
    PersonExt,
    StagedModel,
)
from .scheme import INSTANCE, TYPE, CodingScheme, FieldContext

def _safe_psets(entity: Any, inherit: bool) -> dict[str, dict[str, Any]]:
    """`get_psets` without `id` keys, tolerant of older ifcopenshell without `should_inherit`."""
    if entity is None:
        return {}
    try:
        psets = ue.get_psets(entity, should_inherit=inherit)
    except TypeError:
        psets = ue.get_psets(entity)
    out: dict[str, dict[str, Any]] = {}
    for name, props in (psets or {}).items():
        if isinstance(props, dict):
            clean = {k: v for k, v in props.items() if k != "id"}
            if clean:
                out[name] = clean
    return out


def _entity_classifications(entity: Any) -> list[tuple[str, str]]:
    """(system, identification) pairs for the `classification` field source (D-033)."""
    pairs: list[tuple[str, str]] = []
    for assoc in attr(entity, "HasAssociations") or []:
        if not assoc.is_a("IfcRelAssociatesClassification"):
            continue
        cref = attr(assoc, "RelatingClassification")
        if cref is None or not cref.is_a("IfcClassificationReference"):
            continue
        ident = attr(cref, "Identification") or attr(cref, "ItemReference")
        if not ident:
            continue
        source = attr(cref, "ReferencedSource")
        sys_name = (attr(source, "Name") if source else None) or "Neznámy systém"
        pairs.append((sys_name, str(ident)))
    return pairs


class _RefAllocator:
    """`object_ref` from the coding scheme (D-033), replaces the provisional Tag/Name/GUID
    from D-031. Instance (`asset`) = instance SNIM code; type (`asset_type`) = type code
    derived from the occurrence (type entities have no psets of their own). Fallback to `ifc_guid`
    **only when the code is missing in the source** or not unique (collision). For non-SNIM nodes
    (space, documents, actors) generic Name -> GlobalId (Tag is deliberately NOT used).
    """

    def __init__(self, coding: CodingScheme) -> None:
        self.scheme = coding
        self._applicable = coding.applicable_classes()
        self._by_id: dict[int, str] = {}     # entity.id() -> ref (stable per entity)
        self._used: set[str] = set()         # all assigned refs (uniqueness)
        self.cov = CoverageReport()

    # - context for the resolver (keeps scheme.py independent of ifcopenshell) -
    def ctx(self, entity: Any) -> FieldContext:
        the_type = ue.get_type(entity)
        return FieldContext(
            psets=_safe_psets(entity, inherit=True),
            type_psets=_safe_psets(the_type, inherit=False),
            attrs=lambda name, e=entity: attr(e, name),
            classifications=_entity_classifications(entity),
        )

    def _unique(self, base: str) -> str:
        cand, i = base, 2
        while cand in self._used:
            cand, i = f"{base}-{i}", i + 1
        self._used.add(cand)
        return cand

    def generic_ref(self, entity: Any) -> str:
        """Name -> GlobalId (+ suffix on collision). For space/documents/actors."""
        cached = self._by_id.get(entity.id())
        if cached is not None:
            return cached
        base = attr(entity, "Name") or attr(entity, "GlobalId") or entity.is_a()
        ref = self._unique(str(base))
        self._by_id[entity.id()] = ref
        return ref

    def named_ref(self, entity: Any, base: str) -> str:
        """Ref from the entity's own key (e.g. a document's `Identification`, D-104) + suffix on collision."""
        cached = self._by_id.get(entity.id())
        if cached is not None:
            return cached
        ref = self._unique(base)
        self._by_id[entity.id()] = ref
        return ref

    def ref(self, entity: Any) -> str:
        """Ref already assigned (asset/type), otherwise generic - for document/actor links."""
        return self._by_id.get(entity.id()) or self.generic_ref(entity)

    def allocate_asset(self, entity: Any) -> tuple[str, Optional[str]]:
        """Assigns the instance `object_ref` and returns (ref, type_code|None).

        Updates coverage. The type code is derived from the occurrence's type-level fields
        (even when the instance code falls back - the type stays coded)."""
        cls = entity.is_a()
        ctx = self.ctx(entity)
        cat, tsp = self.scheme.category_for(ctx)
        type_code = cat._join(ctx, TYPE)[0] if cat is not None else None

        self.cov.assets_total += 1
        guid = attr(entity, "GlobalId")

        def fallback(reason: str) -> str:
            ref = self._unique(str(guid or attr(entity, "Name") or cls))
            self.cov.assets_fallback[reason] = self.cov.assets_fallback.get(reason, 0) + 1
            self.cov.fallback_classes[cls] = self.cov.fallback_classes.get(cls, 0) + 1
            return ref

        if cat is None:
            if tsp is None:
                ref = fallback("bez SNIM kódu (žiadny Assembly Code)")
            else:
                self.cov.undefined_tsp[tsp] = self.cov.undefined_tsp.get(tsp, 0) + 1
                ref = fallback(f"TSP mimo schémy: {tsp}")
        else:
            code = cat._join(ctx, INSTANCE)[0]
            if cls not in cat.applies_to:                    # mini-IDS: code on an unexpected class
                key = f"{tsp}@{cls}"                          # does not block creating the code, only record it
                self.cov.undefined_tsp[key] = self.cov.undefined_tsp.get(key, 0) + 1
            if code is None:
                ref = fallback("bez INST (Mark) — len typový kód, inštancia cez GUID")
            elif code in self._used:
                self.cov.collisions.append(code)
                ref = fallback("kolízia SNIM kódu (duplicitný Mark)")
            else:
                self._used.add(code)
                ref = code
                self.cov.assets_snim += 1
                self.cov.by_category[f"{cat.tsp} {cat.label}"] = (
                    self.cov.by_category.get(f"{cat.tsp} {cat.label}", 0) + 1
                )

        self._by_id[entity.id()] = ref
        return ref, type_code

    def reserve_type_code(self, type_entity: Any, code: str) -> str:
        """Reserves the type SNIM code as the ref of the type entity (idempotent)."""
        self._used.add(code)
        self._by_id[type_entity.id()] = code
        return code


def _properties(entity: Any) -> dict[str, Any]:
    """Property sets of an entity as a nested dict (without ifcopenshell `id` keys).
    Type psets are NOT inherited into the occurrence (the merge is done by v_asset_effective, D-021)."""
    try:
        psets = ue.get_psets(entity, should_inherit=False)
    except TypeError:  # older ifcopenshell without should_inherit
        psets = ue.get_psets(entity)
    out: dict[str, Any] = {}
    for pset_name, props in (psets or {}).items():
        if not isinstance(props, dict):
            continue
        clean = {k: v for k, v in props.items() if k != "id"}
        if clean:
            out[pset_name] = clean
    return out


# "Real" storey: 1NP, 2NP... also the library standard notation 1.NP / 2. NP (not 1NP_SH_ZD).
_NP_EXACT = re.compile(r"^\d+\.?\s?NP$")
# NP prefix of an auxiliary level: 1NP_HH_ZD -> 1NP, 2.NP_VZT -> 2NP.
_NP_PREFIX = re.compile(r"(\d+)\.?\s?NP")


def _np_key(name: Optional[str]) -> Optional[str]:
    """Normalized storey key (`2NP`) from a name in any notation (2NP, 2.NP, 2. NP)."""
    m = _NP_PREFIX.search(name or "")
    return f"{m.group(1)}NP" if m else None


def _is_top_level(entity: Any) -> bool:
    """The element "hangs directly in the space" (D-034): it is not nested in another element.

    `get_aggregate` = parent via `IfcRelAggregates`. None (the element is only *contained*
    in a storey) or a spatial parent => top-level. An element parent (curtain wall,
    stairs) => sub-component.
    """
    agg = ue.get_aggregate(entity)
    if agg is None:
        return True
    return agg.is_a("IfcSpatialStructureElement") or agg.is_a("IfcSpace")


def _is_asset(entity: Any, coding: CodingScheme) -> bool:
    """Import scope from the policy in the scheme (D-034) - NOT a hardcoded list of classes."""
    return coding.scope.is_asset(entity.is_a, _is_top_level(entity))


def _resolve_floors(model: ifcopenshell.file) -> tuple[list[Any], dict[int, Any]]:
    """Storey consolidation (D-035): merges auxiliary Revit levels into real storeys.

    A real storey = name `^\\d+NP$` **or** aggregates at least one space.
    Auxiliary levels (`1NP_SH_ZD`, `2NP_HH_STROP`, `Dojazd_výťahov`, `Spadova vrstva`...)
    are mapped to a real storey by the NP prefix of the name, otherwise by the nearest
    elevation. Returns (list of real storeys, map storey.id() -> real storey).
    If the model has no recognizable real storeys, it keeps all of them (fallback).
    """
    storeys = list(model.by_type("IfcBuildingStorey"))

    def has_space(st: Any) -> bool:
        return any(c.is_a("IfcSpace") for c in (ue.get_decomposition(st) or []))

    np_key = _np_key

    real: list[Any] = []
    by_np: dict[str, Any] = {}
    for st in storeys:
        name = attr(st, "Name") or ""
        if _NP_EXACT.match(name) or has_space(st):
            real.append(st)
            key = np_key(name)
            if key and key not in by_np:
                by_np[key] = st

    if not real:  # unknown model - do not risk it, keep all storeys
        return storeys, {st.id(): st for st in storeys}

    real_elev = [(_to_float(attr(st, "Elevation")) or 0.0, st) for st in real]

    def nearest(elev: Optional[float]) -> Any:
        e = elev if elev is not None else 0.0
        return min(real_elev, key=lambda t: abs(t[0] - e))[1]

    real_ids = {st.id() for st in real}
    mapping: dict[int, Any] = {}
    for st in storeys:
        if st.id() in real_ids:
            mapping[st.id()] = st
            continue
        key = np_key(attr(st, "Name"))
        mapping[st.id()] = by_np[key] if key in by_np else nearest(_to_float(attr(st, "Elevation")))
    return real, mapping


def to_staged(
    model: ifcopenshell.file,
    coding: CodingScheme = scheme_mod.SNIM,
    federate: bool = False,
    project_code: Optional[str] = None,
) -> StagedModel:
    """IFC -> staged model. `federate=True` (D-049) = a discipline model (HVAC) attaches
    to the already loaded spatial structure: its site/building/storey/space are **not** emitted,
    nor their `rel_aggregates`; elements get no edge to a storey (the HVAC storey is mapped to the AIM storey by
    the view `ifc_storey_map` from the revision copy, D-183 K3 step 4).
    """
    staged = StagedModel()
    refs = _RefAllocator(coding)
    if project_code is not None:
        # D-189: IfcProject.Name must be the project code; the IfcProject of every file maps onto the
        # project node, whose object_ref is the code (reserved first, so no other entity takes it).
        ifc_project = project_mod.check_file(model, project_code)
        refs._by_id[ifc_project.id()] = project_code
        refs._used.add(project_code)
        staged.project_code = project_code
        staged.project_guid = attr(ifc_project, "GlobalId")
    systems_seen: dict[str, ClassificationSystem] = {}
    refs_seen: set[tuple[str, str]] = set()
    ref_names: dict[tuple[str, str], Optional[str]] = {}

    emitted: dict[int, str] = {}                 # entity.id() -> object_ref of all emitted entities

    def add_object(entity: Any, object_type: str, ref: str, **extra: Any) -> str:
        emitted[entity.id()] = ref
        guid = attr(entity, "GlobalId")
        staged.objects.append(
            ObjectRow(
                object_ref=ref,
                object_type=object_type,
                name=attr(entity, "Name"),
                ifc_guid=guid,
                ifc_type=entity.is_a(),
                predefined_type=_predefined_type(entity),
                user_defined_type=attr(entity, "ObjectType") or attr(entity, "ElementType"),
                properties=_properties(entity),
                **extra,
            )
        )
        # Active GUID = the history record with valid_until NULL.
        if guid:
            staged.guid_history.append(
                GuidHistory(object_ref=ref, ifc_guid=guid, source="IFC import")
            )
        _collect_classifications(entity, ref, staged, systems_seen, refs_seen)
        return ref

    # 1) Spatial hierarchy (D-013) with storey consolidation (D-035).
    #    Auxiliary Revit levels (`1NP_SH_ZD`, `*_STROP`, ...) are NOT emitted as separate
    #    "floor" nodes - assets/spaces from them are remapped to the real storey.
    real_floors, storey_to_floor = _resolve_floors(model)

    spatial_refs: dict[int, str] = {}            # entity.id() -> object_ref (emitted nodes)
    if not federate:
        for ifc_class, otype in (("IfcSite", "site"), ("IfcBuilding", "building")):
            for ent in model.by_type(ifc_class):
                spatial_refs[ent.id()] = add_object(ent, otype, refs.generic_ref(ent))
        for st in real_floors:
            spatial_refs[st.id()] = add_object(
                st, "floor", refs.generic_ref(st), elevation=_to_float(attr(st, "Elevation"))
            )
        for sp in model.by_type("IfcSpace"):
            # IfcSpace.Name = room number (-> objects.name), LongName = function description
            # (Server room, WC...) -> extension `spaces.long_name` (D-040). The generic Revit
            # placeholder "Space" (an unnamed room) is treated as empty.
            long_name = attr(sp, "LongName")
            if isinstance(long_name, str) and long_name.strip().lower() == "space":
                long_name = None
            spatial_refs[sp.id()] = add_object(
                sp, "space", refs.generic_ref(sp), long_name=long_name
            )

    def _spatial_ref(host: Any) -> Optional[str]:
        """Object_ref of the spatial parent - remap the storey to the real one (D-035).

        Federate (D-049): the HVAC spatial roots are not emitted -> None (the HVAC storey is mapped by the view
        `ifc_storey_map`, D-183 K3 step 4)."""
        if host is None:
            return None
        if host.is_a("IfcBuildingStorey"):
            if federate:
                return None   # the discipline model's storey is mapped by the view ifc_storey_map (D-183 K3 step 4)
            target = storey_to_floor.get(host.id(), host)
            return spatial_refs.get(target.id())
        return spatial_refs.get(host.id())

    # Spatial decomposition (D-048, rel_aggregates): building->site, floor->building, space->storey.
    # In federate mode it is NOT emitted - HVAC elements are placed into the existing structure (D-049).
    if not federate:
        for ent in model.by_type("IfcBuilding"):
            parent_ref = _spatial_ref(ue.get_aggregate(ent))
            if parent_ref is not None:
                staged.edges.append(Edge("aggregates", spatial_refs[ent.id()], parent_ref))
        for st in real_floors:
            parent_ref = _spatial_ref(ue.get_aggregate(st))
            if parent_ref is not None:
                staged.edges.append(Edge("aggregates", spatial_refs[st.id()], parent_ref))
        for sp in model.by_type("IfcSpace"):
            parent_ref = _spatial_ref(ue.get_aggregate(sp) or ue.get_container(sp))
            if parent_ref is not None:
                staged.edges.append(Edge("aggregates", spatial_refs[sp.id()], parent_ref))

    # 2) Elements (asset, scope from the D-034 policy): instance `object_ref` from the scheme
    #    + collecting type codes. Type entities (IfcDoorType...) have no psets of their own ->
    #    the type SNIM code is derived from the occurrence and stored per type entity.
    asset_type_links: list[tuple[str, int]] = []     # (asset_ref, type_entity_id)
    type_entities: dict[int, Any] = {}               # type_entity_id -> entity (only referenced ones)
    type_code_by_id: dict[int, str] = {}             # type_entity_id -> SNIM type code
    for el in model.by_type("IfcElement"):
        if not _is_asset(el, coding):
            continue
        ref, type_code = refs.allocate_asset(el)
        add_object(el, "asset", ref)
        # Spatial containment: group-only MEP elements (pipes/fittings, D-049) do NOT
        # get it - they are only members of a system (they do not flood the tree); the others normally.
        loc_ref = _spatial_ref(ue.get_container(el))
        if loc_ref is not None and not coding.scope.is_group_only(el.is_a):
            staged.edges.append(Edge("contained", ref, loc_ref))
        el_type = ue.get_type(el)
        if el_type is not None:
            asset_type_links.append((ref, el_type.id()))
            type_entities.setdefault(el_type.id(), el_type)
            if type_code and el_type.id() not in type_code_by_id:
                type_code_by_id[el_type.id()] = type_code

    # 3) Types (asset_type) - ONLY types referenced by an asset (D-034: no IfcSpaceType
    #    and no types of dropped sub-components). The type code is shared: several Revit types
    #    with the same SNIM code -> one `asset_type` (dedup), the occurrences point to it.
    type_refs: dict[int, str] = {}
    code_to_type_ref: dict[str, str] = {}
    for tid, t in type_entities.items():
        code = type_code_by_id.get(tid)
        if code is not None:
            existing = code_to_type_ref.get(code)
            if existing is not None:                       # merge into the already emitted code
                type_refs[tid] = existing
                refs._by_id[tid] = existing
                # Merge recorded as data (D-183 K3 step 3): the GUID of the merged type -> the same asset_type,
                # so that `rel_defines_by_type` from the revision copy finds it without guessing by object_ref.
                alias_guid = attr(t, "GlobalId")
                if alias_guid:
                    staged.guid_aliases.append(
                        GuidAlias(object_ref=existing, ifc_guid=alias_guid, source="IFC import")
                    )
                continue
            ref = refs.reserve_type_code(t, code)
            code_to_type_ref[code] = ref
            type_refs[tid] = add_object(t, "asset_type", ref)
        else:
            type_refs[tid] = add_object(t, "asset_type", refs.generic_ref(t))

    # 4) defined_by_type (occurrence -> type) through the (possibly merged) type refs.
    for asset_ref, type_id in asset_type_links:
        if type_id in type_refs:
            staged.edges.append(Edge("defined_by_type", asset_ref, type_refs[type_id]))

    # 4.5) Distribution systems (D-047) + membership. IfcDistributionSystem -> object_type
    #      'system' (predefined_type z IfcDistributionSystemEnum); IfcRelAssignsToGroup
    #      (RelatingGroup = the system) -> edge assigns_to_group (member -> system). A member is
    #      only an element already emitted as an asset (refs._by_id) - no dangling edges.
    system_refs: dict[int, str] = {}
    for sysent in model.by_type("IfcDistributionSystem"):
        system_refs[sysent.id()] = add_object(sysent, "system", refs.generic_ref(sysent))

    # 4.6) Project, zones and groups (D-088): IfcProject, IfcZone, IfcSpatialZone and pure
    #      IfcGroup (assemblies). Only the main model - HVAC carries its own IfcProject of the same
    #      project and has no zones (federate does not emit them).
    group_refs: dict[int, str] = {}
    if not federate:
        for ifc_class, otype in (("IfcProject", "project"), ("IfcZone", "zone"),
                                 ("IfcSpatialZone", "spatial_zone"), ("IfcGroup", "group")):
            for ent in model.by_type(ifc_class):
                if ifc_class == "IfcGroup" and ent.is_a() != "IfcGroup":
                    continue  # subtypes (IfcZone, IfcSystem...) have their own object_type
                group_refs[ent.id()] = add_object(ent, otype, refs.generic_ref(ent))
        _collect_group_structure(model, staged, emitted, group_refs, _spatial_ref)
    elif staged.project_code is not None and staged.project_guid:
        # D-189: the discipline model's IfcProject is the same project; its GlobalId is an alias of the node.
        staged.guid_aliases.append(GuidAlias(
            object_ref=staged.project_code, ifc_guid=staged.project_guid,
            reason=project_mod.ALIAS_REASON, source="IFC import",
        ))

    _collect_space_boundaries(model, staged, emitted)

    # Membership in a system, zone and group (IfcRelAssignsToGroup): only emitted members.
    for rel in model.by_type("IfcRelAssignsToGroup"):
        group = attr(rel, "RelatingGroup")
        if group is None:
            continue
        target_ref = system_refs.get(group.id()) or group_refs.get(group.id())
        if target_ref is None:
            continue
        for member in attr(rel, "RelatedObjects") or []:
            member_ref = emitted.get(member.id())
            if member_ref is not None:
                staged.edges.append(Edge("assigns_to_group", member_ref, target_ref))

    # 5) Documents + actors (best-effort, the structure is here - tune on the model, E2).
    _collect_documents(model, refs, staged)
    _collect_document_classifications(model, refs, staged, systems_seen, refs_seen, ref_names)
    _collect_actors(model, refs, staged)
    _drop_unemitted_links(staged, refs.cov)

    # Type coverage: how many shared SNIM codes vs. how many IFC types carried them.
    refs.cov.types_total = len(type_code_by_id)
    refs.cov.types_snim = len(code_to_type_ref)
    refs.cov.types_merged = len(type_code_by_id) - len(code_to_type_ref)
    staged.coverage = refs.cov

    # Deduplicate systems/refs into the staged lists.
    staged.systems = list(systems_seen.values())
    staged.refs = [
        ClassificationRef(system_name=s, identification=i, name=ref_names.get((s, i)), location=None)
        for (s, i) in refs_seen
    ]
    if staged.project_code is not None:
        project_mod.qualify_refs(staged, staged.project_code)   # `<code>:` outside OCB (D-190)
    return staged


def _predefined_type(entity: Any) -> Optional[str]:
    pt = attr(entity, "PredefinedType")
    if pt is None:
        return None
    return str(pt)


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _collect_classifications(
    entity: Any,
    obj_ref: str,
    staged: StagedModel,
    systems_seen: dict[str, ClassificationSystem],
    refs_seen: set[tuple[str, str]],
) -> None:
    """IfcRelAssociatesClassification -> system + reference + rel_associates_classification."""
    for assoc in attr(entity, "HasAssociations") or []:
        if not assoc.is_a("IfcRelAssociatesClassification"):
            continue
        cref = attr(assoc, "RelatingClassification")
        if cref is None or not cref.is_a("IfcClassificationReference"):
            continue
        key = _classification_ref(cref, systems_seen, refs_seen)
        if key is not None:
            staged.class_links.append(ClassLink(from_ref=obj_ref, system_name=key[0], identification=key[1]))


def _classification_ref(
    cref: Any,
    systems_seen: dict[str, ClassificationSystem],
    refs_seen: set[tuple[str, str]],
) -> Optional[tuple[str, str]]:
    """IfcClassificationReference -> (system, code); registers the system and the reference."""
    identification = attr(cref, "Identification") or attr(cref, "ItemReference")
    if not identification:
        return None
    source = attr(cref, "ReferencedSource")
    sys_name = (attr(source, "Name") if source else None) or "Neznámy systém"
    if sys_name not in systems_seen:
        systems_seen[sys_name] = ClassificationSystem(
            name=sys_name,
            source=attr(source, "Source") if source else None,
            edition=attr(source, "Edition") if source else None,
            location=attr(source, "Location") if source else None,
        )
    refs_seen.add((sys_name, str(identification)))
    return sys_name, str(identification)


def _collect_document_classifications(
    model: ifcopenshell.file,
    refs: _RefAllocator,
    staged: StagedModel,
    systems_seen: dict[str, ClassificationSystem],
    refs_seen: set[tuple[str, str]],
    ref_names: dict[tuple[str, str], Optional[str]],
) -> None:
    """Document classification (D-104, e.g. the ISO 19650 information type): IfcDocumentInformation
    is not an IfcRoot, IfcRelAssociatesClassification cannot reach it, hence an
    IfcExternalReferenceRelationship from the reference to the documents. The document must already be
    assigned in `_collect_documents`; the reference also carries a name (e.g. "Výkres")."""
    for rel in model.by_type("IfcExternalReferenceRelationship"):
        cref = attr(rel, "RelatingReference")
        if cref is None or not cref.is_a("IfcClassificationReference"):
            continue
        docs = [o for o in attr(rel, "RelatedResourceObjects") or [] if o.is_a("IfcDocumentInformation")]
        if not docs:
            continue
        key = _classification_ref(cref, systems_seen, refs_seen)
        if key is None:
            continue
        ref_names.setdefault(key, attr(cref, "Name"))
        for doc in docs:
            staged.class_links.append(ClassLink(
                from_ref=refs.ref(doc), system_name=key[0], identification=key[1],
                edge_type="document_classification",
            ))


def _collect_documents(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """Documentation from the file (D-104): every IfcDocumentInformation as a `document` (also
    folder parts without a file), the tree from IfcDocumentInformationRelationship as
    `document_part` (part -> parent), IfcDocumentReference as `document_reference`
    (a part of a document, e.g. a page) and IfcRelAssociatesDocument as `has_document`.

    The document's `object_ref` = `Identification` (CDE name, D-036), the reference's =
    `<document Identification>#<reference Identification>`. `Location` stays from the file;
    load translates it to the URL in the bucket (`documents.resolve_locations`)."""
    doc_refs: dict[int, str] = {}
    for info in model.by_type("IfcDocumentInformation"):
        ref = refs.named_ref(info, attr(info, "Identification") or attr(info, "Name") or "IfcDocumentInformation")
        doc_refs[info.id()] = ref
        status = attr(info, "Status")
        staged.objects.append(
            ObjectRow(
                object_ref=ref,
                object_type="document",
                name=attr(info, "Name"),
                ifc_type="IfcDocumentInformation",
                document=DocumentExt(
                    identification=attr(info, "Identification"),
                    description=attr(info, "Description"),
                    location=attr(info, "Location"),
                    purpose=attr(info, "Purpose"),
                    revision=attr(info, "Revision"),
                    document_owner=_actor_label(attr(info, "DocumentOwner")),
                    status=str(status) if status else None,
                    valid_from=attr(info, "ValidFrom"),
                    valid_until=attr(info, "ValidUntil"),
                    creation_time=attr(info, "CreationTime"),
                    last_revision_time=attr(info, "LastRevisionTime"),
                    electronic_format=attr(info, "ElectronicFormat"),
                ),
            )
        )

    for rel in model.by_type("IfcDocumentInformationRelationship"):
        parent = attr(rel, "RelatingDocument")
        if parent is None or parent.id() not in doc_refs:
            continue
        for child in attr(rel, "RelatedDocuments") or []:
            if child.id() in doc_refs:
                staged.edges.append(Edge("document_part", doc_refs[child.id()], doc_refs[parent.id()],
                                         role=attr(rel, "RelationshipType")))

    for dref in model.by_type("IfcDocumentReference"):
        target = attr(dref, "ReferencedDocument")
        target_ref = doc_refs.get(target.id()) if target is not None else None
        own = attr(dref, "Identification") or attr(dref, "Name") or attr(dref, "Location")
        base = f"{target_ref}#{own}" if target_ref and own else (own or target_ref or "IfcDocumentReference")
        ref = refs.named_ref(dref, base)
        doc_refs[dref.id()] = ref
        staged.objects.append(
            ObjectRow(
                object_ref=ref,
                object_type="document_reference",
                # ASR carries the page description in Description, Name is empty
                name=attr(dref, "Name") or attr(dref, "Description") or own,
                ifc_type="IfcDocumentReference",
                document=DocumentExt(
                    identification=attr(dref, "Identification"),
                    description=attr(dref, "Description"),
                    location=attr(dref, "Location"),
                    referenced_document_ref=target_ref,
                ),
            )
        )

    for assoc in model.by_type("IfcRelAssociatesDocument"):
        info = attr(assoc, "RelatingDocument")
        if info is None or info.id() not in doc_refs:
            continue
        doc_ref = doc_refs[info.id()]
        for obj in attr(assoc, "RelatedObjects") or []:
            obj_guid = attr(obj, "GlobalId")
            if obj_guid:
                obj_ref = refs.ref(obj)
                staged.link_classes.setdefault(obj_ref, obj.is_a())
                staged.edges.append(Edge("has_document", obj_ref, doc_ref, role="document"))


def _actor_label(actor: Any) -> Optional[str]:
    """IfcPerson / IfcOrganization / IfcPersonAndOrganization -> readable name (document owner)."""
    if actor is None:
        return None
    if actor.is_a("IfcPersonAndOrganization"):
        person = _actor_label(attr(actor, "ThePerson"))
        org = _actor_label(attr(actor, "TheOrganization"))
        return f"{person} ({org})" if person and org else person or org
    if actor.is_a("IfcPerson"):
        return " ".join(x for x in (attr(actor, "GivenName"), attr(actor, "FamilyName")) if x) or None
    return attr(actor, "Name")


def _collect_group_structure(
    model: ifcopenshell.file,
    staged: StagedModel,
    emitted: dict[int, str],
    group_refs: dict[int, str],
    spatial_ref: Any,
) -> None:
    """Links of the project, spatial zones and groups from the file (D-088).

    - `aggregates`: site -> project, part of a spatial zone -> zone, subgroup -> group
      (the decomposition of the building and below stays in step 1);
    - `contained`: a spatial zone on a storey (IfcRelContainedInSpatialStructure);
    - `referenced`: IfcRelReferencedInSpatialStructure from the file (a space in a spatial
      zone, a zone and an element on a storey, a door in a space). The storey is remapped as with
      containment (D-035); a link only between emitted objects."""
    for rel in model.by_type("IfcRelAggregates"):
        parent = attr(rel, "RelatingObject")
        if parent is None or parent.id() not in group_refs:
            continue
        for child in attr(rel, "RelatedObjects") or []:
            child_ref = emitted.get(child.id())
            if child_ref is not None:
                staged.edges.append(Edge("aggregates", child_ref, group_refs[parent.id()]))

    def structure_ref(structure: Any) -> Optional[str]:
        if structure is None:
            return None
        return group_refs.get(structure.id()) or spatial_ref(structure)

    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        to_ref = structure_ref(attr(rel, "RelatingStructure"))
        for el in attr(rel, "RelatedElements") or []:
            if to_ref is not None and el.is_a("IfcSpatialZone") and el.id() in group_refs:
                staged.edges.append(Edge("contained", group_refs[el.id()], to_ref))

    seen: set[tuple[str, str]] = set()
    for rel in model.by_type("IfcRelReferencedInSpatialStructure"):
        to_ref = structure_ref(attr(rel, "RelatingStructure"))
        if to_ref is None:
            continue
        for el in attr(rel, "RelatedElements") or []:
            from_ref = emitted.get(el.id())
            if from_ref is not None and from_ref != to_ref and (from_ref, to_ref) not in seen:
                seen.add((from_ref, to_ref))
                staged.edges.append(Edge("referenced", from_ref, to_ref))


_BOUNDARY_ROLE_RANK = {"physical": 0, "virtual": 1, "notdefined": 2}


def _collect_space_boundaries(
    model: ifcopenshell.file, staged: StagedModel, emitted: dict[int, str]
) -> None:
    """IfcRelSpaceBoundary (also 1st/2nd level) -> edge `space_boundary` element -> space (D-156).

    Doors can be linked to a room only by a space boundary (and lie on a storey in the structure). One
    pair (element, space) often has several boundaries in IFC (each face, both
    levels) -> one edge; `role` = PhysicalOrVirtualBoundary in lower case, with
    several, physical wins. Only between emitted objects (without the element or the space
    in the graph the edge is dropped, no dangling edges)."""
    best: dict[tuple[str, str], str] = {}
    for rel in model.by_type("IfcRelSpaceBoundary"):
        space, element = attr(rel, "RelatingSpace"), attr(rel, "RelatedBuildingElement")
        if space is None or element is None:
            continue
        space_ref, element_ref = emitted.get(space.id()), emitted.get(element.id())
        if space_ref is None or element_ref is None or space_ref == element_ref:
            continue
        kind = attr(rel, "PhysicalOrVirtualBoundary")
        role = str(kind).lower() if kind else "notdefined"
        key = (element_ref, space_ref)
        if key not in best or _BOUNDARY_ROLE_RANK.get(role, 3) < _BOUNDARY_ROLE_RANK.get(best[key], 3):
            best[key] = role
    for (element_ref, space_ref), role in best.items():
        staged.edges.append(Edge("space_boundary", element_ref, space_ref, role=role))


def _drop_unemitted_links(staged: StagedModel, cov: CoverageReport) -> None:
    """Links of documents and actors only to emitted objects - no dangling edges.

    The model carries documents also on entities the ETL does not (yet) emit: IfcZone,
    IfcSpatialZone, IfcGroup of assemblies, IfcProject (D-086). An edge to a nonexistent
    `object_ref` would fail the whole load (`_resolve_cross_file_refs`), so it is omitted
    and counted into coverage by IFC class."""
    emitted = {o.object_ref for o in staged.objects}
    kept: list[Edge] = []
    for e in staged.edges:
        other = e.from_ref if e.edge_type == "has_document" else (
            e.to_ref if e.edge_type == "responsible_for" else None
        )
        if other is None or other in emitted:
            kept.append(e)
            continue
        cls = staged.link_classes.get(other, "?")
        cov.unlinked[cls] = cov.unlinked.get(cls, 0) + 1
    staged.edges = kept


def _collect_actors(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """IfcRelAssignsToActor -> person/organization + rel_assigns_to_actor. TODO(model)."""
    for rel in model.by_type("IfcRelAssignsToActor"):
        actor = attr(rel, "RelatingActor")
        if actor is None:
            continue
        the_actor = attr(actor, "TheActor")
        actor_ref = _actor_object(the_actor, refs, staged)
        if actor_ref is None:
            continue
        role = attr(rel, "ActingRole")
        role_name = str(attr(role, "Role")) if role else None
        for obj in attr(rel, "RelatedObjects") or []:
            if attr(obj, "GlobalId"):
                obj_ref = refs.ref(obj)
                staged.link_classes.setdefault(obj_ref, obj.is_a())
                staged.edges.append(
                    Edge("responsible_for", actor_ref, obj_ref, role=role_name or "responsible")
                )


def _actor_object(the_actor: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    """IfcPerson / IfcOrganization / IfcPersonAndOrganization -> object(s) + rel_member_of."""
    if the_actor is None:
        return None
    if the_actor.is_a("IfcPersonAndOrganization"):
        person_ref = _person_object(attr(the_actor, "ThePerson"), refs, staged)
        org_ref = _org_object(attr(the_actor, "TheOrganization"), refs, staged)
        if person_ref and org_ref:
            staged.edges.append(Edge("member_of", person_ref, org_ref))
        return person_ref or org_ref
    if the_actor.is_a("IfcPerson"):
        return _person_object(the_actor, refs, staged)
    if the_actor.is_a("IfcOrganization"):
        return _org_object(the_actor, refs, staged)
    return None


def _person_object(person: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    if person is None:
        return None
    ref = refs.ref(person)
    given, family = attr(person, "GivenName"), attr(person, "FamilyName")
    name = " ".join(x for x in (given, family) if x) or None
    staged.objects.append(
        ObjectRow(
            object_ref=ref,
            object_type="person",
            name=name,
            person=PersonExt(given_name=given, family_name=family),
        )
    )
    return ref


def _org_object(org: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    if org is None:
        return None
    ref = refs.ref(org)
    staged.objects.append(
        ObjectRow(object_ref=ref, object_type="organization", name=attr(org, "Name"))
    )
    return ref
