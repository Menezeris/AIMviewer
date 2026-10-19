"""Medziľahlý (staged) dátový model — výstup `transform.py`, vstup `load.py`.

Zrkadlí SCHEMA.md: centrálne `objects` + tenké prípony + hrany `rel_*` +
klasifikačné referenčné dáta + história GUID. Uzly sa adresujú cez `object_ref`
(konflikt-kľúč pri upserte, D-031); hrany a referenčné dáta cez tieto refy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class DocumentExt:
    """Prípona `documents`: IfcDocumentInformation, alebo IfcDocumentReference (D-104) so
    `referenced_document_ref` na dokument, ktorého časť (napr. stranu) označuje."""

    identification: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    purpose: Optional[str] = None
    revision: Optional[str] = None
    document_owner: Optional[str] = None
    status: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    creation_time: Optional[str] = None
    last_revision_time: Optional[str] = None
    electronic_format: Optional[str] = None
    # `supabase` (súbor v buckete `documents`) | `unresolved`; dopĺňa load (documents.py)
    storage_type: str = "unresolved"
    referenced_document_ref: Optional[str] = None   # IfcDocumentReference.ReferencedDocument


@dataclass
class PersonExt:
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


@dataclass
class ObjectRow:
    """Riadok `objects` + voliteľná 1:1 prípona podľa `object_type`."""

    object_ref: str                       # UNIQUE — konflikt-kľúč
    object_type: str                      # 'site','building',…,'asset_type','person',…
    name: Optional[str] = None
    ifc_guid: Optional[str] = None
    ifc_type: Optional[str] = None
    predefined_type: Optional[str] = None
    user_defined_type: Optional[str] = None
    properties: dict[str, Any] = field(default_factory=dict)
    # prípony (max jedna podľa typu):
    elevation: Optional[float] = None     # floor
    long_name: Optional[str] = None       # space (IfcSpace.LongName — popis funkcie)
    document: Optional[DocumentExt] = None
    person: Optional[PersonExt] = None


@dataclass
class Edge:
    """Hrana objekt→objekt, IFC-kanonická (D-048): edge_type ∈ aggregates/contained/
    defined_by_type/member_of/has_document/responsible_for/assigns_to_group/document_part.
    D-051: `edge_type` → `rel_type` mapuje `manifest.EDGE_TYPE_TO_REL_TYPE`;
    zapisuje sa do generickej `relationships` (db.py). `role` je nullable."""

    edge_type: str
    from_ref: str
    to_ref: str
    role: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    source: str = "etl"


@dataclass
class ClassificationSystem:
    name: str
    source: Optional[str] = None
    edition: Optional[str] = None
    edition_date: Optional[str] = None
    location: Optional[str] = None


@dataclass
class ClassificationRef:
    system_name: str                      # FK na systém (cez názov)
    identification: str                   # napr. 'Pr_70_65_04'
    name: Optional[str] = None
    location: Optional[str] = None


@dataclass
class ClassLink:
    """`rel_associates_classification`: objekt → klasifikačná referencia (D-023)."""

    from_ref: str
    system_name: str
    identification: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    source: str = "etl"


@dataclass
class GuidHistory:
    object_ref: str
    ifc_guid: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None     # NULL = aktívny (= objects.ifc_guid)
    source: Optional[str] = None


@dataclass
class CoverageReport:
    """Pokrytie `object_ref` kódovacou schémou (D-033) — výstup `--dry-run`.

    Nie je to IDS/conformance (to je parkované, E6) — len koľko prvkov dostalo
    platný SNIM kód vs. fallback na `ifc_guid`, a kde kód chýba.
    """

    # occurrence (asset) úroveň
    assets_total: int = 0                                   # prvky v SNIM-aplikovateľných triedach
    assets_snim: int = 0                                    # plný inštančný SNIM kód
    assets_fallback: dict[str, int] = field(default_factory=dict)   # dôvod → počet
    # asset_type úroveň
    types_total: int = 0
    types_snim: int = 0
    types_merged: int = 0                                   # IfcTypeObject zlúčené do zdieľaného kódu
    # diagnostika
    by_category: dict[str, int] = field(default_factory=dict)        # TSP/label → počet asset kódov
    fallback_classes: dict[str, int] = field(default_factory=dict)   # IFC trieda → počet fallbackov
    undefined_tsp: dict[str, int] = field(default_factory=dict)      # kód je, kategória v schéme nie
    collisions: list[str] = field(default_factory=list)             # duplicitné SNIM kódy
    # väzby dokument/aktor na entitu, ktorú ETL neemituje (IfcZone, IfcGroup, IfcProject…)
    unlinked: dict[str, int] = field(default_factory=dict)          # IFC trieda → počet väzieb


@dataclass
class StagedModel:
    objects: list[ObjectRow] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    class_links: list[ClassLink] = field(default_factory=list)
    systems: list[ClassificationSystem] = field(default_factory=list)
    refs: list[ClassificationRef] = field(default_factory=list)
    guid_history: list[GuidHistory] = field(default_factory=list)
    coverage: Optional["CoverageReport"] = None
    # object_ref → IFC trieda entít, na ktoré ukazujú väzby dokumentov/aktorov (diagnostika)
    link_classes: dict[str, str] = field(default_factory=dict)

    def summary(self) -> str:
        return (
            f"objects={len(self.objects)} edges={len(self.edges)} "
            f"class_links={len(self.class_links)} systems={len(self.systems)} "
            f"refs={len(self.refs)} guid_history={len(self.guid_history)}"
        )
