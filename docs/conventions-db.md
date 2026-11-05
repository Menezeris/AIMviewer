# Database conventions

> Moved out of `AGENTS.md` verbatim (D-197, lean docs). Exact DDL, columns and views are in `SCHEMA.md`.

## Database conventions

### Source of truth (D-183)
- **The truth is the revision container** (IFC, PDF, DWG in the archive, sha256). An accepted container never changes; a file is
  changed only by an OCB recipe in a revision we explicitly requested (BCF topic). Model data are not changed by writing to the DB.
- **DB = a complete copy of the information of every revision, without geometry** (generic rule, `(model, revision)` and
  `content_hash` in every row); it is not changed by hand; for geometry we go to the file. Changes only by comparison on request.
- **AIM layer** = only what is not in the containers (D-129); every stored result carries the revisions it was made from
  (`{model: revision}`), a signature other than the current one = `stale`, never overwritten.
- Container and revision terms follow `IfcDocumentInformation` and `IfcOwnerHistory`, in English (SCHEMA §2.19).

### Nodes, the central table `objects` (D-018)
- All nodes are rows in `objects`, distinguished by `object_type`:
  site, building, floor, space, asset, asset_type, document, person, organization,
  system (IfcDistributionSystem, D-047/D-049), capture, capture_media (Reality Capture,
  D-073), project, zone, spatial_zone, group (IfcProject/IfcZone/IfcSpatialZone/IfcGroup, D-088),
  document_reference (IfcDocumentReference, part of a document, D-104);
  further IFC entities (processes, tasks...) are **additive values** (D-051)
- **A defunct object** (`objects.valid_until` is not NULL, D-088) is seen by neither the app nor the AI: every
  new list, count or search over `objects` filters `valid_until is null`
- `object_type` is validated by the ETL and the app (NOT a CHECK; adding a type is additive)
- **Goal: cover the whole IFC ontology** (entities and relationships). Entities are already generic through
  the open `object_type`; relationships through a generic meta-model (D-051). It is not a rebuild but
  additive filling of values and `rel_type`. IFC = semantics/ontology, not the STEP file (D-046).
- **IFC attributes (D-195, round 8):** the existing columns (`ifc_guid`, `ifc_type`, `predefined_type`, `name`,
  `object_ref UNIQUE`...) stay; a new column only for values that are searched. Every other IFC attribute of a
  node goes into `properties._attributes` by its IFC name; value entities without identity (IfcTaskTime,
  IfcPostalAddress...) nested with a `_class` key. A new IFC entity is a row, not a migration: its class is
  in the manifest `entity_types` (all of IFC 4.3, `is_node`, class tree, `entity_is_a`). Columns -> `SCHEMA.md §2.1`,
  `_attributes` -> §4, manifest -> §2.24.
- Type-specific columns -> a thin 1:1 extension table (`floors`, `documents`, `persons`),
  `id` as FK to `objects(id) ON DELETE CASCADE` (`SCHEMA.md §2.2`)
- `organization` = a plain `objects` row (name = company name), without an extension table

### Property sets, three layers (D-022)
- **Attributes** (from the schema) -> columns, the rest into `properties._attributes` (D-195), never as a pset
- **Standard psets** (buildingSMART) -> `properties[<name>]`, name `Pset_`/`Qto_`
- **Custom psets** -> `properties[<name>]`, any other name (no required prefix)
- **Reserved `_keys`** (`_contact`, `_org`...) = meta or captured data, NOT psets; psets never start with `_`

### Edges, the generic meta-model `relationships` (D-051, implemented in F1; revision of D-048)
> **State (D-051, F1):** the edge layer lives in **one generic `relationships`** table (discriminator
> `rel_type`, symmetric to `objects`) + **canonical views** per type (the same names as the original
> `rel_*` = compatibility without downtime) + **the manifest `relationship_types`** (generated from the IFC schema
> by `ifcopenshell`, `etl/manifest.py`). Reason: IFC's own meta-model = `objects`
> (IfcObjectDefinition) + `relationships` (IfcRelationship, objectified) + `properties`
> (IfcPropertyDefinition); B scales to all of IFC without a migration per relationship. **IFC-canonical
> identity, the direction `subject->object` and the `aim_` namespace stay**; they live in the manifest as data
> (direction, allowed `object_type`, namespace, export path, unique-active-parent). **N-arity =
> binary `from->to`** (N-ary = N rows; keeps D-031 idempotency). **The LLM and the whitelist query
> ONLY the canonical views** (not the base table) -> text-to-SQL ergonomics kept; **writes (ETL, seed)
> go to the base `relationships`** (views are not insertable). **Integrity** = a validation trigger
> from the manifest (not a polymorphic FK); `to_id` is polymorphic (objects / `classification_references`).
> Partitions postponed (conflict "the PK must contain the partition key" x `ON CONFLICT (id)`).
> **Deployed on Supabase prod** (2026-07-07, `acwoupricatirhlfkhvk`). Exact DDL -> `SCHEMA.md §2.5/§2.6`; the `rel_type` list below.
- Every `rel_type` = a concrete IFC `IfcRelationship` subtype, **named after it**,
  with the granularity IFC distinguishes:
  `rel_aggregates` (IfcRelAggregates), `rel_contained_in_spatial_structure`
  (IfcRelContainedInSpatialStructure), `rel_defines_by_type` (IfcRelDefinesByType),
  `rel_associates_document` (IfcRelAssociatesDocument), `rel_associates_classification`
  (IfcRelAssociatesClassification), `rel_assigns_to_actor` (IfcRelAssignsToActor),
  `rel_assigns_to_group` (IfcRelAssignsToGroup, systems, D-047),
  `rel_referenced_in_spatial_structure` (IfcRelReferencedInSpatialStructure, an element also in another
  space, non-exclusive; derived by `python -m etl.derive`, D-080),
  `rel_member_of` (IfcPersonAndOrganization, **a resource, not an IfcRel**; honestly outside the taxonomy),
  `rel_document_information_relationship` (IfcDocumentInformationRelationship, the documentation tree,
  a resource like `rel_member_of`, D-104),
  `rel_external_reference_relationship` (IfcExternalReferenceRelationship, classification of a document,
  e.g. the ISO 19650 information type; a resource, `to_id` -> `classification_references`, D-104)
- **Physically binary `from->to` + our meta columns, NOT objectified N-ary IFC entities**
  (we take the identity and granularity of IFC, not its serialization structure; an index over IFC
  semantics, not STEP in Postgres, D-046/D-048)
- Required columns: `id`, `valid_from`, `valid_until`, `source`
- Direction: `from_id` -> `to_id` (subject -> object); the convention stays uniform; which end
  is the IFC `Relating` one is in the mapping in SCHEMA.md §5
- **Namespace (D-048):** an edge **without a prefix = IFC-canonical** (serialized as `IfcRel*`);
  an edge for which IFC **has no concept** gets the prefix **`aim_`** (`aim_rel_*`, snake_case).
  The prefix also encodes the export: `rel_*` -> `IfcRel`, `aim_*` -> ICDD linkset/IFCX. Reserved for a
  real absence of an IFC concept (NOT a concept realized differently; that is why `rel_member_of`
  stays `rel_`). Today no `aim_*` edge exists; it is a forward convention.
- Exception: `rel_associates_classification.to_id` -> `classification_references`
- Spatial: `rel_aggregates` = decomposition of the structure (Site->Building->Floor->Space);
  `rel_contained_in_spatial_structure` = a physical element (asset) in a space or floor
- The full list of edges, columns and the IFC `Relating`/`Related` mapping -> `SCHEMA.md §2.5` and `§5`

### Type-occurrence (D-021)
- Type = `object_type='asset_type'`, NEVER in the spatial structure
  (`rel_aggregates` / `rel_contained_in_spatial_structure`)
- Link `rel_defines_by_type` (occurrence -> type), 1:N
- Inheritance with override: the type is shared, the occurrence overrides; effective values from `v_asset_effective`

### Actors (D-020, D-024), level B
- `person` (extension table `persons`) and `organization` (an objects row), link `rel_member_of`
- `rel_assigns_to_actor` goes from a person and from an organization
- Two roles: `rel_assigns_to_actor.role` (acting in a responsibility) vs `rel_member_of.role` (role in the company)
- C (organization hierarchy, structured addresses, intrinsic roles) = a planned additive extension

### Object identity (three layers, D-010)
- **Master UUID** (`objects.id`) = the primary identity, never changes
- **object_ref** = a human-readable stable tag (QR), unique; it is NOT a classification code
- **IFC GUID** = only an attribute; history in `ifc_guid_history`

### Classification (D-011, D-019, D-023)
- Never hardcode a specific classification system
- Two levels, reference data: `classification_systems` + `classification_references`
- Link `rel_associates_classification`, allowed on the type and the occurrence
- The effective classification of an occurrence = the **union** of its own and those inherited from the type (not an override)

## Spatial hierarchy
```
Site -> Building -> Floor -> Space -> Asset
```
Every level is a row in `objects` (it differs by `object_type`). Spatial links are IFC-canonical
(D-048): `rel_aggregates` between structures (Site->Building->Floor->Space),
`rel_contained_in_spatial_structure` for a physical element (asset) in a space or floor.

