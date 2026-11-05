"""Intermediate (staged) data model - output of `transform.py`, input of `load.py`.

Mirrors SCHEMA.md: the central `objects` + thin extensions + `rel_*` edges +
classification reference data + GUID history. Nodes are addressed by `object_ref`
(the conflict key on upsert, D-031); edges and reference data go through these refs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class DocumentExt:
    """Extension `documents`: IfcDocumentInformation, or IfcDocumentReference (D-104) with
    `referenced_document_ref` pointing to the document whose part (e.g. a page) it marks."""

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
    # `supabase` (file in the `documents` bucket) | `unresolved`; filled in by load (documents.py)
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
    """A row of `objects` + an optional 1:1 extension by `object_type`."""

    object_ref: str                       # UNIQUE - conflict key
    object_type: str                      # 'site','building',...,'asset_type','person',...
    name: Optional[str] = None
    ifc_guid: Optional[str] = None
    ifc_type: Optional[str] = None
    predefined_type: Optional[str] = None
    user_defined_type: Optional[str] = None
    properties: dict[str, Any] = field(default_factory=dict)
    # extensions (at most one per type):
    elevation: Optional[float] = None     # floor
    long_name: Optional[str] = None       # space (IfcSpace.LongName - function description)
    document: Optional[DocumentExt] = None
    person: Optional[PersonExt] = None


@dataclass
class Edge:
    """An object->object edge, IFC-canonical (D-048): edge_type in aggregates/contained/
    defined_by_type/member_of/has_document/responsible_for/assigns_to_group/document_part.
    D-051: `edge_type` -> `rel_type` is mapped by `manifest.EDGE_TYPE_TO_REL_TYPE`;
    it is written to the generic `relationships` (db.py). `role` is nullable."""

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
    system_name: str                      # FK to the system (by name)
    identification: str                   # e.g. 'Pr_70_65_04'
    name: Optional[str] = None
    location: Optional[str] = None


@dataclass
class ClassLink:
    """Object -> classification reference: `rel_associates_classification` (D-023), for a
    document `rel_external_reference_relationship` (`edge_type`, D-104)."""

    from_ref: str
    system_name: str
    identification: str
    edge_type: str = "has_classification"
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    source: str = "etl"


@dataclass
class GuidHistory:
    object_ref: str
    ifc_guid: str
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None     # NULL = active (= objects.ifc_guid)
    source: Optional[str] = None


@dataclass
class GuidAlias:
    """Another GlobalId of the same AIM node, not its history (D-183 K3 step 3): an IFC type merged into
    an `asset_type` with the same type code (D-033). Table `ifc_guid_aliases`, not `ifc_guid_history`
    (there a node has at most one active GUID, `uniq_active_guid`, D-010)."""

    object_ref: str
    ifc_guid: str
    reason: str = "type_code"
    source: Optional[str] = None


@dataclass
class CoverageReport:
    """Coverage of `object_ref` by the coding scheme (D-033) - output of `--dry-run`.

    It is not IDS/conformance (that is parked, E6) - only how many elements got
    a valid SNIM code vs. a fallback to `ifc_guid`, and where the code is missing.
    """

    # occurrence (asset) level
    assets_total: int = 0                                   # elements in SNIM-applicable classes
    assets_snim: int = 0                                    # full instance SNIM code
    assets_fallback: dict[str, int] = field(default_factory=dict)   # reason -> count
    # asset_type level
    types_total: int = 0
    types_snim: int = 0
    types_merged: int = 0                                   # IfcTypeObject merged into a shared code
    # diagnostics
    by_category: dict[str, int] = field(default_factory=dict)        # TSP/label -> number of asset codes
    fallback_classes: dict[str, int] = field(default_factory=dict)   # IFC class -> number of fallbacks
    undefined_tsp: dict[str, int] = field(default_factory=dict)      # the code is there, the category is not in the scheme
    collisions: list[str] = field(default_factory=list)             # duplicate SNIM codes
    # document/actor links to an entity the ETL does not emit (IfcZone, IfcGroup, IfcProject...)
    unlinked: dict[str, int] = field(default_factory=dict)          # IFC class -> number of links


@dataclass
class StagedModel:
    objects: list[ObjectRow] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    class_links: list[ClassLink] = field(default_factory=list)
    systems: list[ClassificationSystem] = field(default_factory=list)
    refs: list[ClassificationRef] = field(default_factory=list)
    guid_history: list[GuidHistory] = field(default_factory=list)
    guid_aliases: list[GuidAlias] = field(default_factory=list)
    coverage: Optional["CoverageReport"] = None
    # object_ref -> IFC class of the entities that document/actor links point to (diagnostics)
    link_classes: dict[str, str] = field(default_factory=dict)
    # Project of the file (D-189): code = IfcProject.Name = object_ref of the project node, and the
    # GlobalId of this file's IfcProject (an alias of the node when it is not the node's own GUID).
    project_code: Optional[str] = None
    project_guid: Optional[str] = None

    def summary(self) -> str:
        return (
            f"objects={len(self.objects)} edges={len(self.edges)} "
            f"class_links={len(self.class_links)} systems={len(self.systems)} "
            f"refs={len(self.refs)} guid_history={len(self.guid_history)} "
            f"guid_aliases={len(self.guid_aliases)}"
        )
