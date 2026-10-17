"""Mapovanie IFC → staged model (D-031), podľa SCHEMA.md + CLAUDE konvencií.

Pokrýva štandardné IFC vzory, ktoré schéma modeluje:
  • priestorová hierarchia  Site→Building→Storey→Space  (IfcRelAggregates /
    IfcRelContainedInSpatialStructure)            → objects + rel_aggregates / rel_contained_in_spatial_structure
  • elementy (occurrence) + ich typy               → objects(asset/asset_type)
    + rel_defines_by_type (IfcRelDefinesByType)
  • property sety (Pset_/Qto_ = štandard, inak custom) → properties JSONB
  • klasifikácie na type aj occurrence              → classification_* + rel_associates_classification
  • dokumenty, aktori (B)                            → documents/persons + rel_*

POZN. (doladiť na model diplomky — D-031 prereq): zdroj `object_ref`
(Tag/Name/GlobalId), ktoré elementy sú „asset", a konkrétne názvy psetov/klasifikácií
sú model-špecifické. Miesta sú označené `TODO(model)`.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import ifcopenshell
import ifcopenshell.util.element as ue

from . import scheme as scheme_mod
from .extract import attr
from .model import (
    ClassLink,
    ClassificationRef,
    ClassificationSystem,
    CoverageReport,
    DocumentExt,
    Edge,
    GuidHistory,
    ObjectRow,
    PersonExt,
    StagedModel,
)
from .scheme import INSTANCE, TYPE, CodingScheme, FieldContext

def _safe_psets(entity: Any, inherit: bool) -> dict[str, dict[str, Any]]:
    """`get_psets` bez `id` kľúčov, odolné voči starším ifcopenshell bez `should_inherit`."""
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
    """(systém, identification) páry pre `classification` field source (D-033)."""
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
    """`object_ref` zo kódovacej schémy (D-033) — nahrádza provizórny Tag/Name/GUID
    z D-031. Inštancia (`asset`) = inštančný SNIM kód; typ (`asset_type`) = typový kód
    odvodený z occurrence (typové entity nemajú vlastné psety). Fallback na `ifc_guid`
    **len keď kód v zdroji chýba** alebo nie je unikátny (kolízia). Pre ne-SNIM uzly
    (priestor, dokumenty, aktori) generický Name → GlobalId (Tag sa zámerne NEpoužíva).
    """

    def __init__(self, coding: CodingScheme) -> None:
        self.scheme = coding
        self._applicable = coding.applicable_classes()
        self._by_id: dict[int, str] = {}     # entity.id() → ref (stabilné per entitu)
        self._used: set[str] = set()         # všetky pridelené refy (unikátnosť)
        self.cov = CoverageReport()

    # — kontext pre resolver (drží scheme.py nezávislý od ifcopenshell) —
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
        """Name → GlobalId (+ suffix pri kolízii). Pre priestor/dokumenty/aktorov."""
        cached = self._by_id.get(entity.id())
        if cached is not None:
            return cached
        base = attr(entity, "Name") or attr(entity, "GlobalId") or entity.is_a()
        ref = self._unique(str(base))
        self._by_id[entity.id()] = ref
        return ref

    def ref(self, entity: Any) -> str:
        """Ref už pridelený (asset/typ), inak generický — pre väzby dok./aktorov."""
        return self._by_id.get(entity.id()) or self.generic_ref(entity)

    def allocate_asset(self, entity: Any) -> tuple[str, Optional[str]]:
        """Pridelí inštančný `object_ref` a vráti (ref, typový_kód|None).

        Aktualizuje coverage. Typový kód sa odvodí z type-úrovňových polí occurrence
        (aj keď inštančný kód padne na fallback — typ ostáva zakódovaný)."""
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
            if cls not in cat.applies_to:                    # mini-IDS: kód na nečakanej triede
                key = f"{tsp}@{cls}"                          # neblokuje tvorbu kódu, len zaznač
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
        """Zarezervuje typový SNIM kód ako ref typovej entity (idempotentne)."""
        self._used.add(code)
        self._by_id[type_entity.id()] = code
        return code


def _properties(entity: Any) -> dict[str, Any]:
    """Property sety entity ako vnorený dict (bez ifcopenshell `id` kľúčov).
    Type psety sa NEdedia do occurrence (merge rieši v_asset_effective, D-021)."""
    try:
        psets = ue.get_psets(entity, should_inherit=False)
    except TypeError:  # staršie ifcopenshell bez should_inherit
        psets = ue.get_psets(entity)
    out: dict[str, Any] = {}
    for pset_name, props in (psets or {}).items():
        if not isinstance(props, dict):
            continue
        clean = {k: v for k, v in props.items() if k != "id"}
        if clean:
            out[pset_name] = clean
    return out


# „Reálne" podlažie: 1NP, 2NP… aj zápis štandardu knižnice 1.NP / 2. NP (nie 1NP_SH_ZD).
_NP_EXACT = re.compile(r"^\d+\.?\s?NP$")
# NP-prefix pomocnej úrovne: 1NP_HH_ZD → 1NP, 2.NP_VZT → 2NP.
_NP_PREFIX = re.compile(r"(\d+)\.?\s?NP")


def _np_key(name: Optional[str]) -> Optional[str]:
    """Normalizovaný kľúč podlažia (`2NP`) z názvu v ľubovoľnom zápise (2NP, 2.NP, 2. NP)."""
    m = _NP_PREFIX.search(name or "")
    return f"{m.group(1)}NP" if m else None


def _is_top_level(entity: Any) -> bool:
    """Prvok „visí priamo v priestore" (D-034): nie je vnorený v inom elemente.

    `get_aggregate` = rodič cez `IfcRelAggregates`. None (prvok je len *contained*
    v podlaží) alebo priestorový rodič ⇒ top-level. Element-rodič (curtain wall,
    schody) ⇒ sub-komponent.
    """
    agg = ue.get_aggregate(entity)
    if agg is None:
        return True
    return agg.is_a("IfcSpatialStructureElement") or agg.is_a("IfcSpace")


def _is_asset(entity: Any, coding: CodingScheme) -> bool:
    """Rozsah importu z policy v schéme (D-034) — NIE hardcoded zoznam tried."""
    return coding.scope.is_asset(entity.is_a, _is_top_level(entity))


def _resolve_floors(model: ifcopenshell.file) -> tuple[list[Any], dict[int, Any]]:
    """Konsolidácia podlaží (D-035): zlúči pomocné Revit úrovne do reálnych podlaží.

    Reálne podlažie = názov `^\\d+NP$` **alebo** aggreguje aspoň jeden priestor.
    Pomocné úrovne (`1NP_SH_ZD`, `2NP_HH_STROP`, `Dojazd_výťahov`, `Spadova vrstva`…)
    sa namapujú na reálne podlažie podľa NP-prefixu názvu, inak podľa najbližšej
    elevácie. Vráti (zoznam reálnych podlaží, mapa storey.id() → reálne podlažie).
    Ak model nemá rozpoznateľné reálne podlažia, ponechá všetky (fallback).
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

    if not real:  # neznámy model — neriskuj, ponechaj všetky podlažia
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
    existing_floors: Optional[list[tuple[str, Optional[float], Optional[str]]]] = None,
) -> StagedModel:
    """IFC → staged model. `federate=True` (D-049) = disciplinárny model (VZT) sa napojí
    na už naloženú priestorovú štruktúru: **neemitujú** sa jeho site/building/storey/space
    ani ich `rel_aggregates`; prvky sa zavesia na **existujúce** floor uzly cez normalizovaný
    názov podlažia (`1NP_VZT` → `1NP`), fallback najbližšia elevácia. `existing_floors` =
    `[(object_ref, elevation, name), …]` z DB (dodá `main.py` pri federate loade); pri
    dry-rune je None a ref sa odvodí priamo z `np_key` (zhoduje sa s konvenciou floor refov).
    """
    staged = StagedModel()
    refs = _RefAllocator(coding)
    systems_seen: dict[str, ClassificationSystem] = {}
    refs_seen: set[tuple[str, str]] = set()

    # Federačné mapovanie podlaží (D-049): np-kľúč / elevácia → existujúci floor object_ref.
    floor_by_np: dict[str, str] = {}
    floor_by_elev: list[tuple[float, str]] = []
    for ref, elev, name in existing_floors or []:
        key = _np_key(name) or _np_key(ref)
        if key:
            floor_by_np.setdefault(key, ref)
        if elev is not None:
            floor_by_elev.append((elev, ref))

    def external_floor_ref(storey: Any) -> Optional[str]:
        """Object_ref existujúceho podlažia pre VZT storey (federate). np_key, inak elevácia."""
        key = _np_key(attr(storey, "Name"))
        if key:
            return floor_by_np.get(key, key)  # np_key = konvencia floor refu
        if floor_by_elev:
            e = _to_float(attr(storey, "Elevation")) or 0.0
            return min(floor_by_elev, key=lambda t: abs(t[0] - e))[1]
        return None

    def add_object(entity: Any, object_type: str, ref: str, **extra: Any) -> str:
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
        # Aktívny GUID = záznam histórie s valid_until NULL.
        if guid:
            staged.guid_history.append(
                GuidHistory(object_ref=ref, ifc_guid=guid, source="IFC import")
            )
        _collect_classifications(entity, ref, staged, systems_seen, refs_seen)
        return ref

    # 1) Priestorová hierarchia (D-013) s konsolidáciou podlaží (D-035).
    #    Pomocné Revit úrovne (`1NP_SH_ZD`, `*_STROP`, …) sa NEemitujú ako samostatné
    #    „floor" uzly — assety/priestory z nich sa premapujú na reálne podlažie.
    real_floors, storey_to_floor = _resolve_floors(model)

    spatial_refs: dict[int, str] = {}            # entity.id() → object_ref (emitnuté uzly)
    if not federate:
        for ifc_class, otype in (("IfcSite", "site"), ("IfcBuilding", "building")):
            for ent in model.by_type(ifc_class):
                spatial_refs[ent.id()] = add_object(ent, otype, refs.generic_ref(ent))
        for st in real_floors:
            spatial_refs[st.id()] = add_object(
                st, "floor", refs.generic_ref(st), elevation=_to_float(attr(st, "Elevation"))
            )
        for sp in model.by_type("IfcSpace"):
            # IfcSpace.Name = číslo miestnosti (→ objects.name), LongName = popis funkcie
            # (Serverovňa, WC…) → prípona `spaces.long_name` (D-040). Generický Revit
            # placeholder "Space" (nepomenovaná miestnosť) berieme ako prázdny.
            long_name = attr(sp, "LongName")
            if isinstance(long_name, str) and long_name.strip().lower() == "space":
                long_name = None
            spatial_refs[sp.id()] = add_object(
                sp, "space", refs.generic_ref(sp), long_name=long_name
            )

    def _spatial_ref(host: Any) -> Optional[str]:
        """Object_ref priestorového rodiča — podlažie premapuj na reálne (D-035).

        Federate (D-049): spatial korene VZT sa neemitujú → storey sa mapuje na
        **existujúci** floor ref (`external_floor_ref`); ostatné kontajnery (site/building/
        space VZT) → None (MEP prvky visia na podlaží, VZT nemá priestory)."""
        if host is None:
            return None
        if host.is_a("IfcBuildingStorey"):
            if federate:
                return external_floor_ref(host)
            target = storey_to_floor.get(host.id(), host)
            return spatial_refs.get(target.id())
        return spatial_refs.get(host.id())

    # Spatial dekompozícia (D-048, rel_aggregates): building→site, floor→building, space→podlažie.
    # Vo federate režime sa NEemituje — VZT prvky sa zaraďujú do existujúcej štruktúry (D-049).
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

    # 2) Elementy (asset, rozsah z policy D-034): inštančný `object_ref` zo schémy
    #    + zber typových kódov. Typové entity (IfcDoorType…) nemajú vlastné psety →
    #    typový SNIM kód odvodíme z occurrence a uložíme per type entitu.
    asset_type_links: list[tuple[str, int]] = []     # (asset_ref, type_entity_id)
    type_entities: dict[int, Any] = {}               # type_entity_id → entita (len referencované)
    type_code_by_id: dict[int, str] = {}             # type_entity_id → SNIM typový kód
    for el in model.by_type("IfcElement"):
        if not _is_asset(el, coding):
            continue
        ref, type_code = refs.allocate_asset(el)
        add_object(el, "asset", ref)
        # Priestorové containment: group-only MEP prvky (potrubie/tvarovky, D-049) ho
        # NEdostanú — sú len členmi systému (nezahltia strom); ostatné normálne.
        loc_ref = _spatial_ref(ue.get_container(el))
        if loc_ref is not None and not coding.scope.is_group_only(el.is_a):
            staged.edges.append(Edge("contained", ref, loc_ref))
        el_type = ue.get_type(el)
        if el_type is not None:
            asset_type_links.append((ref, el_type.id()))
            type_entities.setdefault(el_type.id(), el_type)
            if type_code and el_type.id() not in type_code_by_id:
                type_code_by_id[el_type.id()] = type_code

    # 3) Typy (asset_type) — LEN typy referencované assetom (D-034: žiadny IfcSpaceType
    #    ani typy vyradených sub-komponentov). Typový kód je zdieľaný: viac Revit typov
    #    s rovnakým SNIM kódom → jeden `asset_type` (dedup), occurrence naň ukazujú.
    type_refs: dict[int, str] = {}
    code_to_type_ref: dict[str, str] = {}
    for tid, t in type_entities.items():
        code = type_code_by_id.get(tid)
        if code is not None:
            existing = code_to_type_ref.get(code)
            if existing is not None:                       # zlúč do už emitnutého kódu
                type_refs[tid] = existing
                refs._by_id[tid] = existing
                continue
            ref = refs.reserve_type_code(t, code)
            code_to_type_ref[code] = ref
            type_refs[tid] = add_object(t, "asset_type", ref)
        else:
            type_refs[tid] = add_object(t, "asset_type", refs.generic_ref(t))

    # 4) defined_by_type (occurrence → type) cez (prípadne zlúčené) typové refy.
    for asset_ref, type_id in asset_type_links:
        if type_id in type_refs:
            staged.edges.append(Edge("defined_by_type", asset_ref, type_refs[type_id]))

    # 4.5) Distribučné systémy (D-047) + členstvo. IfcDistributionSystem → object_type
    #      'system' (predefined_type z IfcDistributionSystemEnum); IfcRelAssignsToGroup
    #      (RelatingGroup = systém) → hrana assigns_to_group (člen → systém). Členom je
    #      len prvok už emitnutý ako asset (refs._by_id) — žiadne dangling hrany.
    system_refs: dict[int, str] = {}
    for sysent in model.by_type("IfcDistributionSystem"):
        system_refs[sysent.id()] = add_object(sysent, "system", refs.generic_ref(sysent))
    for rel in model.by_type("IfcRelAssignsToGroup"):
        group = attr(rel, "RelatingGroup")
        if group is None or group.id() not in system_refs:
            continue
        sys_ref = system_refs[group.id()]
        for member in attr(rel, "RelatedObjects") or []:
            member_ref = refs._by_id.get(member.id())
            if member_ref is not None:
                staged.edges.append(Edge("assigns_to_group", member_ref, sys_ref))

    # 5) Dokumenty + aktori (best-effort, štruktúra je tu — doladiť na model, E2).
    _collect_documents(model, refs, staged)
    _collect_actors(model, refs, staged)

    # Coverage typov: koľko zdieľaných SNIM kódov vs. koľko IFC typov ich nieslo.
    refs.cov.types_total = len(type_code_by_id)
    refs.cov.types_snim = len(code_to_type_ref)
    refs.cov.types_merged = len(type_code_by_id) - len(code_to_type_ref)
    staged.coverage = refs.cov

    # Deduplikuj systémy/refy do staged zoznamov.
    staged.systems = list(systems_seen.values())
    staged.refs = [
        ClassificationRef(system_name=s, identification=i, name=None, location=None)
        for (s, i) in refs_seen
    ]
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
    """IfcRelAssociatesClassification → systém + referencia + rel_associates_classification."""
    for assoc in attr(entity, "HasAssociations") or []:
        if not assoc.is_a("IfcRelAssociatesClassification"):
            continue
        cref = attr(assoc, "RelatingClassification")
        if cref is None or not cref.is_a("IfcClassificationReference"):
            continue
        identification = attr(cref, "Identification") or attr(cref, "ItemReference")
        if not identification:
            continue
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
        staged.class_links.append(
            ClassLink(from_ref=obj_ref, system_name=sys_name, identification=str(identification))
        )


def _collect_documents(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """IfcRelAssociatesDocument → document objekt + rel_associates_document. TODO(model)."""
    seen: dict[int, str] = {}
    for assoc in model.by_type("IfcRelAssociatesDocument"):
        info = attr(assoc, "RelatingDocument")
        if info is None:
            continue
        if info.id() not in seen:
            ref = refs.ref(info)
            staged.objects.append(
                ObjectRow(
                    object_ref=ref,
                    object_type="document",
                    name=attr(info, "Name"),
                    document=DocumentExt(
                        identification=attr(info, "Identification"),
                        description=attr(info, "Description"),
                        location=attr(info, "Location"),
                        purpose=attr(info, "Purpose"),
                        revision=attr(info, "Revision"),
                        status=str(attr(info, "Status")) if attr(info, "Status") else None,
                    ),
                )
            )
            seen[info.id()] = ref
        doc_ref = seen[info.id()]
        for obj in attr(assoc, "RelatedObjects") or []:
            obj_guid = attr(obj, "GlobalId")
            if obj_guid:
                staged.edges.append(
                    Edge("has_document", refs.ref(obj), doc_ref, role="document")
                )


def _collect_actors(model: ifcopenshell.file, refs: _RefAllocator, staged: StagedModel) -> None:
    """IfcRelAssignsToActor → person/organization + rel_assigns_to_actor. TODO(model)."""
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
                staged.edges.append(
                    Edge("responsible_for", actor_ref, refs.ref(obj), role=role_name or "responsible")
                )


def _actor_object(the_actor: Any, refs: _RefAllocator, staged: StagedModel) -> Optional[str]:
    """IfcPerson / IfcOrganization / IfcPersonAndOrganization → objekt(y) + rel_member_of."""
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
