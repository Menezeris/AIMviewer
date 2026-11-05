# SCHEMA.md - AIM Platform (v0.4, IMPLEMENTED)

> Scope: **spatial hierarchy · assets · documents · responsibilities · type-occurrence · actors (B)**
> Model: the central `objects` + thin type extension tables + clean FK edges.
> Conventions: `AGENTS.md` + `DECISIONS.md` (D-009 to D-025).
>
> **State:** §2 implemented as the initial migration
> `supabase/migrations/20260616120000_init_aim_schema.sql` (D-025).
> Deviations of the implementation from the text of §2 -> see §8.

---

## 1. Overview

```
objects  ──┐  (one node space, Master UUID = the anchor)
           ├─ floors    (elevation)
           ├─ documents (IfcDocumentInformation fields; also IfcDocumentReference, D-104)
           └─ persons   (name, contact)   ── organization = an objects row

EDGES (objects -> objects, clean FK), IFC-canonical (D-048):
  rel_aggregates                      Site->Building->Floor->Space  (IfcRelAggregates)
  rel_contained_in_spatial_structure  asset -> space/floor          (IfcRelContainedInSpatialStructure)
  rel_defines_by_type                 occurrence -> type            (IfcRelDefinesByType)
  rel_member_of                       person -> organization        (IfcPersonAndOrganization)
  rel_associates_document             object -> document            (IfcRelAssociatesDocument)
  rel_document_information_relationship  part -> parent document (IfcDocumentInformationRelationship, D-104)
  rel_assigns_to_actor                person|organization -> object  (role, validity = handover)
  rel_assigns_to_group                element -> system             (IfcRelAssignsToGroup, D-047)

CLASSIFICATION (reference data):
  classification_systems ◄─ classification_references
  rel_associates_classification  object (type and occurrence) -> reference
  rel_external_reference_relationship  document -> reference (ISO 19650 information type, D-104)
```

---

## 2. SQL DDL

### 2.0 Helpers

```sql
create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Deep merge of psets: the occurrence (b) overrides the type (a) at the level of scalars
create or replace function jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select case
    when a is null then b
    when b is null then a
    when jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then b
    else (select jsonb_object_agg(k,
            case when (a ? k) and (b ? k) then jsonb_deep_merge(a->k, b->k)
                 when (b ? k) then b->k else a->k end)
          from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) keys)
  end $$;
```

### 2.1 Central node table

```sql
create table objects (
  id                uuid primary key default gen_random_uuid(),   -- Master UUID (D-010/1)
  object_type       text not null,     -- 'site','building','floor','space','asset','asset_type',
                                        -- 'document','person','organization','system' (D-047),
                                        -- 'capture','capture_media' (D-073),
                                        -- 'project','zone','spatial_zone','group' (D-088),
                                        -- 'document_reference' (IfcDocumentReference, D-104)
  object_ref        text unique,       -- human-readable identity / QR (D-010/2)
  name              text,              -- IFC Name (attribute)
  ifc_guid          text,              -- IFC GlobalId, only an attribute, nullable (D-010/3)
  ifc_type          text,              -- IFC entity: IfcPump, IfcPumpType, IfcSpace...
  predefined_type   text,              -- IFC PredefinedType enum; inherited type->occ
  user_defined_type text,              -- IFC ObjectType(occ)/ElementType(type) with USERDEFINED
  properties        jsonb not null default '{}',   -- property sets + reserved _keys (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on objects (object_type);
create index on objects (ifc_guid);
create index on objects (predefined_type);
```

**Addendum (D-059, migration 20260712120000):** `objects` also has a STORED generated
column `search_text` = `f_object_search_text(name, object_ref, ifc_type,
predefined_type, user_defined_type, properties)`: a normalized (unaccent + lower)
flattening of the identity and all psets (reserved `_keys` left out) for full-text search.
Indexes and RPC -> §2.9.

**Addendum (D-088, migration 20261018130000):** `objects.valid_until timestamptz` = when the object
ceased to exist (no model of the federation issues it any more; NULL = valid). The row stays (D-010). The views
`v_actors`, `v_asset_classifications`, `v_asset_effective`, `v_floors`, `v_property_dictionary`,
`v_spaces` and the RPCs `search_everything`, `aggregate_objects`, `search_documents` filter
`valid_until is null`; so do the lists and searches in the app (AGENTS). Index
`idx_objects_retired` (only defunct ones).

### 2.2 Type extension tables (1:1 to `objects`)

```sql
create table floors (
  id        uuid primary key references objects(id) on delete cascade,
  elevation numeric
);

create table documents (        -- IfcDocumentInformation (D-014); .Name lives in objects.name
  id              uuid primary key references objects(id) on delete cascade,
  identification  text, description text, location text, purpose text, revision text,
  document_owner  text,         -- temporary; later rel_assigns_to_actor(role='owner')
  status          text,
  valid_from      timestamptz,  -- validity of the revision (not the validity of the link)
  valid_until     timestamptz
);
-- + storage_type (D-032, migration 20260620120000): supabase | external | unresolved
-- + D-104 (migration 20261019160000), IFC attributes literally:
--   creation_time timestamptz, last_revision_time timestamptz, electronic_format text,
--   referenced_document_id uuid -> objects (IfcDocumentReference.ReferencedDocument;
--   only with object_type='document_reference', the row carries Location/Identification/
--   Description of the reference, objects.name = Name, otherwise Description)
-- + D-158 (migration 20261023140000): file_sha256 text (sha256 of the PDF file, 64 hex; the anchor
--   of the revision and the cache key of the cutout snapshot; filled by etl/pdf_text.py --from-db). AIM extension, IFC
--   has no equivalent (IfcDocumentInformation carries no file hash).

create table persons (          -- IfcPerson (D-024); objects.name = displayed name
  id          uuid primary key references objects(id) on delete cascade,
  given_name  text,
  family_name text,
  email       text,
  phone       text
);
-- organization = a plain objects row (name = company name)
-- structured addresses + organization hierarchy = C (planned, §7)
```

**Addendum (D-073, migration 20260716120000), Reality Capture extension tables.** Model "like
documents": capture point = an `objects` row `object_type='capture'` (2D/3D anchoring
in the reserved `properties._capture`, §4), a single shot or version = an `objects` row
`object_type='capture_media'` (analogous to `documents`). Versioning a location over time = several
`capture_media` per capture point, append-only (`valid_until IS NULL` = current).

```sql
create table captures (        -- capture point (registration of a location)
  id   uuid primary key references objects(id) on delete cascade,
  kind text not null           -- 'photo' | 'pano360'
);

create table capture_media (   -- one shot or version (analogous to IfcDocumentInformation)
  id               uuid primary key references objects(id) on delete cascade,
  location         text,       -- public URL of the original (Supabase Storage bucket `captures`)
  preview_location text,       -- reduced preview (360 downscale under the GPU limit / photo preview)
  thumb_location   text,       -- thumbnail (gallery / pin)
  storage_type     text not null default 'supabase',   -- like documents.storage_type (D-032)
  media_type       text, width int, height int,
  captured_at      timestamptz,                          -- capture date -> order of versions
  valid_from       timestamptz not null default now(),
  valid_until      timestamptz                           -- NULL = current (append-only)
);
```

### 2.3 Classification (D-011, D-019, reference data)

```sql
create table classification_systems (         -- IfcClassification
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- 'Uniclass 2015'
  source       text, edition text, edition_date date, location text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table classification_references (      -- IfcClassificationReference
  id              uuid primary key default gen_random_uuid(),
  system_id       uuid not null references classification_systems(id) on delete restrict,
  identification  text not null,              -- 'Pr_60_50_10' (product) / 'Ss_...' (system)
  name            text, location text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (system_id, identification)
);
```

### 2.4 History of IFC GUIDs (D-010)

```sql
create table ifc_guid_history (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,          -- NULL = current
  source      text,
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid on ifc_guid_history (object_id) where valid_until is null;

-- D-183 K3 step 3 (migration 20261031180000): another GlobalId of the same node, NOT its history. The GUID of an IFC type
-- that the ETL merged into an asset_type with the same type code (D-033, reason = type_code). Written by the graph ETL
-- (source IFC import:<model>, re-ETL closes the ones no longer issued); read through the view ifc_guid_node (§2.19).
create table ifc_guid_aliases (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  reason      text not null default 'type_code',
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,          -- NULL = active
  source      text,
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid_alias on ifc_guid_aliases (ifc_guid) where valid_until is null;
```

### 2.5 Hrany — generický meta-model `relationships` (D-051, implementované vo F1)

Hrany sú **IFC-kanonické** (D-048) a od F1 žijú v **jednej generickej tabuľke
`relationships`** s diskriminátorom `rel_type` (symetricky k `objects.object_type`).
Fyzicky binárne `from→to` + naše meta stĺpce (NIE objektifikované N-árne IFC entity —
sme index nad IFC sémantikou, nie STEP v Postgrese, D-046/D-048). Smer = `subjekt→objekt`.
Vlastný IFC meta-model je trojtabuľkový: `objects` (IfcObjectDefinition) + `relationships`
(IfcRelationship) + `properties` (IfcPropertyDefinition). Migrácia:
`20260707150000_relationships_metamodel.sql` (revízia D-048; per-vzťah tabuľky supersedované).

**Manifest `relationship_types`** = jeden zdroj pravdy o `rel_type` (generovaný a overený
proti IFC schéme cez `ifcopenshell`, `etl/manifest.py`). Poháňa validačný trigger, ETL
routing (`db.py`) aj export. **Kanonické views** rovnakého názvu ako pôvodné `rel_*` slúžia
zároveň ako bezvýpadkový compat layer — **čítacia vrstva (viewer/3D/filter) sa nemení**;
**LLM dotazuje LEN views**, nie base tabuľku. **N-árnosť = binárne `from→to`** (N-árne = N
riadkov; zachováva D-031 idempotenciu). **Partície odložené** (`LIST` podľa `rel_type` nesie
„PK musí obsahovať partičný kľúč" → kolízia s `ON CONFLICT (id)`; dnes index na `rel_type` stačí).

```sql
-- Manifest vzťahov (D-051) — generovaný z IFC schémy (etl/manifest.py)
create table relationship_types (
  rel_type            text primary key,      -- diskriminátor v relationships
  ifc_entity          text,                  -- IFC kotva (IfcRelAggregates…); null = čisto aim_
  ifc_family          text,                  -- rodina (IfcRelDecomposes…); null pre resource
  is_ifc_rel          boolean not null,      -- true → IfcRel*; false → resource (member_of) / aim_
  relating_end        text not null,         -- 'from'|'to' — ktorý koniec je IFC Relating
  from_object_types   text[] not null,       -- povolené object_type subjektu
  to_object_types     text[] not null,       -- povolené object_type objektu (prázdne pri klasifikácii)
  to_is_classification boolean not null default false,  -- výnimka: to_id → classification_references
  namespace           text not null,         -- 'rel' (IFC-kanonické) | 'aim' (rozšírenie D-048)
  export_path         text not null,         -- 'ifcrel' | 'resource' | 'icdd' | 'ifcx'
  unique_active_from  boolean not null default false,   -- unique-active-parent
  description         text,
  check (relating_end in ('from','to')),
  check (namespace in ('rel','aim')),
  check (export_path in ('ifcrel','resource','icdd','ifcx'))
);
-- Dodatok D-080 (migrácia 20261016130000): + rel_referenced_in_spatial_structure
--   (IfcRelReferencedInSpatialStructure, asset → space|floor|building|site, NEexkluzívne,
--   role inside|partial, plní `etl.derive spatial_reference`, source='derive:spatial_reference').
-- Dnešná sada (8 rel_type): rel_aggregates, rel_contained_in_spatial_structure,
-- rel_defines_by_type, rel_associates_document, rel_associates_classification,
-- rel_assigns_to_actor, rel_assigns_to_group, rel_member_of. Presné hodnoty = migrácia.
-- Dodatok D-073 (migrácia 20260716120000): +2 PRVÉ aim_ hrany —
--   aim_rel_capture_located (capture → space|floor, unique-active),
--   aim_rel_capture_media (capture → capture_media, 1:N). namespace='aim',
--   is_ifc_rel=false, export_path='icdd' (ICDD linkset, D-015). Kanonické views
--   rovnakého názvu (aim_rel_capture_located / aim_rel_capture_media).

-- Generická tabuľka hrán. to_id je POLYMORFNÉ (objects ALEBO classification_references)
-- → zámerne bez FK; integrita cez validačný trigger z manifestu. from_id má FK+CASCADE.
create table relationships (
  id          uuid primary key default gen_random_uuid(),
  rel_type    text not null references relationship_types(rel_type),
  from_id     uuid not null references objects(id) on delete cascade,  -- subjekt
  to_id       uuid not null,                                           -- objekt (objects/classification_references)
  role        text,                                                    -- len kde to typ vzťahu nesie
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  source      text
);
create index on relationships (rel_type);
create index on relationships (from_id);
create index on relationships (to_id);
create index on relationships (rel_type, from_id);

-- Kanonické views = ROVNAKÉ názvy ako pôvodné rel_* (bezvýpadkový cutover, D-048).
-- Zrkadlia pôvodné stĺpce; role len tam, kde ho vzťah nesie (assoc_document, assigns_to_actor, member_of).
create view rel_aggregates as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_aggregates';
-- … analogicky rel_defines_by_type /
--   rel_associates_classification / rel_assigns_to_group (bez role) a
--   rel_associates_document / rel_assigns_to_actor / rel_member_of (s role).
-- rel_contained_in_spatial_structure od D-183 K3 (migrácia 20261031120000) číta kópiu revízie, nie
--   `relationships` (rovnaké prvé stĺpce + model, revision, global_id, container_global_id, via_global_id; §2.19).
-- rel_aggregates / rel_defines_by_type / rel_assigns_to_group / rel_associates_document / rel_associates_classification
--   od D-183 K3 krok 2b (migrácia 20261031150000) tiež z kópie revízie + hrany AIM vrstvy (zdroj nie etl*) z `relationships`
--   (rovnaké prvé stĺpce + model, revision, global_id a parent_global_id | type_global_id | group_global_id |
--   document_key | classification_key; §2.19). rel_assigns_to_actor, rel_member_of a ostatné ostávajú nad `relationships`.
-- Od D-183 K3 krok 3 ETL grafu hrany týchto šiestich typov do `relationships` nezapisuje (staré `etl*` ostávajú
--   aktívne a nečítané, kým ich neukončí `supabase/migrations/20261031190000_end_etl_ifc_edges.sql`).
```

### 2.6 Indexy + integrita hrán

```sql
-- unique-active-parent (D-021/D-048) = parciálne unique per rel_type literál
create unique index uniq_active_aggregate on relationships (from_id)
  where rel_type = 'rel_aggregates' and valid_until is null;
create unique index uniq_active_contained on relationships (from_id)
  where rel_type = 'rel_contained_in_spatial_structure' and valid_until is null;
create unique index uniq_active_defines_by_type on relationships (from_id)
  where rel_type = 'rel_defines_by_type' and valid_until is null;

-- E4 auto-linking hot-path (D-041)
create index idx_relationships_e4_from on relationships (from_id)
  where rel_type = 'rel_associates_document' and source = 'pdf_link (E4)';

-- Integrita bez polymorfného FK: BEFORE trigger číta manifest a overí rel_type,
-- povolené object_type oboch strán a to endpoint (objects vs classification_references).
create trigger trg_relationships_validate before insert or update on relationships
  for each row execute function relationships_validate();
```

**IFC end types (D-196, R10, migration `20261105140000_relationship_ifc_types.sql`, applied 5 Nov 16:52 UTC; check
`20261105170000_relationship_ifc_check.sql`, not applied; tests `supabase/tests/relationship_ifc_types.sql`,
`relationship_ifc_check.sql`):** `relationship_types` has `from_ifc_types text[]` and `to_ifc_types
text[]` (the declared IFC type of the From and To end: the Relating* and Related* attribute of the IfcRel class, or
ThePerson / TheOrganization of IfcPersonAndOrganization, a SELECT expanded to its entities) and `ifc_check`
(`off` | `warn` | `enforce`; `warn` for all after `20261105170000`, `enforce` per rel_type by
`supabase/pending/relationship_ifc_enforce.sql` once its active edges pass, `rel_assigns_to_actor` last). Generated by `python -m etl.manifest --sql-ifc-types` from
ifcopenshell `IFC4X3_ADD2`; the block in the migration is checked for drift (`etl/tests/test_manifest_ifc_types.py`).
aim_* types state their own types in the generator; an empty list = no IFC check at that end. A classification end
(`to_is_classification`) is a `classification_references` row = IfcClassificationReference.

| rel_type | From end | To end |
|---|---|---|
| `rel_aggregates` | IfcObjectDefinition | IfcObjectDefinition |
| `rel_contained_in_spatial_structure` | IfcProduct | IfcSpatialElement |
| `rel_referenced_in_spatial_structure` | IfcGroup, IfcProduct | IfcSpatialElement |
| `rel_space_boundary` | IfcElement | IfcSpace, IfcExternalSpatialElement |
| `rel_defines_by_type` | IfcObject | IfcTypeObject |
| `rel_associates_document` | IfcObjectDefinition, IfcPropertyDefinition | IfcDocumentInformation, IfcDocumentReference |
| `rel_associates_classification` | IfcObjectDefinition, IfcPropertyDefinition | IfcClassification, IfcClassificationReference |
| `rel_assigns_to_actor` | IfcActor | IfcObjectDefinition |
| `rel_assigns_to_group` | IfcObjectDefinition | IfcGroup |
| `rel_member_of` | IfcPerson | IfcOrganization |
| `rel_document_information_relationship` | IfcDocumentInformation | IfcDocumentInformation |
| `rel_external_reference_relationship` | IfcResourceObjectSelect members (incl. IfcExternalInformation) | IfcExternalReference |
| `aim_rel_capture_located` | (no check) | IfcSpatialElement |
| `aim_rel_capture_media` | (no check) | (no check) |

- `relationship_ifc_end_ok(ifc_type, allowed)`: true when `allowed` is empty or `ifc_type` is an allowed class or a
  subtype (`entity_is_a`); NULL or an unknown class fails.
- `relationships_validate` (after the object_type and project rules): on insert, and on an update that changes
  `rel_type`, `from_id` or `to_id`, each end must pass; `warn` raises a WARNING and writes the edge, `enforce`
  rejects it (`check_violation`, message ends with `(R10)`). Other updates (closing with `valid_until`, rewrites)
  are not rechecked, so an old edge can always be ended.
- `v_relationship_ifc_violations`: one row per failing edge end (`relationship_id`, `rel_type`, `ifc_check`,
  `active`, `edge_end`, `node_id`, `object_type`, `ifc_type`, `allowed`, `reason` = missing ifc_type | unknown
  ifc_type | not a subtype of an allowed type, `source`, `project_id`). No rights for `anon`/`authenticated`.
- Actors (PLATFORM.md §5.3): the From end of `rel_assigns_to_actor` is an IfcActor node (`object_type = 'actor'`,
  TheActor in `properties._attributes`); `person` and `organization` stay allowed by the object_type rule until R5/R9.
  Unrelated to the reference table `ifc_actor` (OwnerHistory data of the files).
- A node with `object_type = 'document'` has `ifc_type = 'IfcDocumentInformation'` (filled by the migration, set by
  `etl/doc_upload.py`).

### 2.7 Views (Viewer / LLM)

**Addendum D-080 (migration 20261016130000):** `v_space_elements` = the content of a space:
`rel_contained_in_spatial_structure` into a `space` (relation `contained`, native from the file; since D-183 K3 from the revision copy)
∪ `rel_referenced_in_spatial_structure` into a `space` (relation `referenced`, derived from
geometry, `role` inside|partial). Columns: space_id/ref/name/long_name, element_id/ref/name,
element_ifc_type, element_predefined_type, relation, role, source. Only active edges.

**Addendum D-156 (migration 20261022180000):** `rel_space_boundary` (`IfcRelSpaceBoundary`, element -> space,
`role` physical|virtual|notdefined, one edge per pair, filled by the ETL) and a third branch of `v_space_elements` with
`relation = 'boundary'`, only when the pair has no active `contained` or `referenced`.

```sql
-- Effective asset: inheritance type->occurrence (the occurrence overrides)
create view v_asset_effective as
  select occ.id, occ.object_ref, occ.name, occ.ifc_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.predefined_type else occ.predefined_type end   as predefined_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.user_defined_type else occ.user_defined_type end as user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties)              as properties,
    typ.id as type_id, typ.name as type_name
  from objects occ
  left join rel_defines_by_type r on r.from_id = occ.id and r.valid_until is null
  left join objects typ on typ.id = r.to_id
  where occ.object_type = 'asset';

-- Effective classification: UNION of own + inherited from the type (D-023)
create view v_asset_classifications as
  select occ.id as object_id, rc.to_id as classification_ref_id, 'occurrence' as level
  from objects occ
  join rel_associates_classification rc on rc.from_id = occ.id and rc.valid_until is null
  where occ.object_type = 'asset'
  union
  select occ.id, rc.to_id, 'type'
  from objects occ
  join rel_defines_by_type dt on dt.from_id = occ.id and dt.valid_until is null
  join rel_associates_classification rc on rc.from_id = dt.to_id and rc.valid_until is null
  where occ.object_type = 'asset';

create view v_floors as select o.*, f.elevation from objects o join floors f using (id);
create view v_actors as select * from objects where object_type in ('person','organization');
-- v_documents, v_assets, v_spaces... analogously

-- Pset dictionary from real data (D-058), grounding for the LLM: which psets x properties
-- exist (standard AND custom), value type, counts, samples, min/max of numerics.
-- Reserved _keys (D-022) left out. Exact DDL: migration 20260711120000.
create view v_property_dictionary as
select o.object_type, o.ifc_type, p.key as pset, a.key as property,
       jsonb_typeof(a.value) as value_type, count(*)::int as object_count,
       count(distinct a.value)::int as distinct_values,
       (array_agg(distinct left(a.value #>> '{}', 60)))[1:5] as sample_values,
       min(case when jsonb_typeof(a.value) = 'number'
                then (a.value #>> '{}')::numeric end) as min_number,
       max(case when jsonb_typeof(a.value) = 'number'
                then (a.value #>> '{}')::numeric end) as max_number
from objects o
cross join lateral jsonb_each(o.properties) p
cross join lateral jsonb_each(p.value) a
where p.key !~ '^_' and jsonb_typeof(p.value) = 'object'
group by o.object_type, o.ifc_type, p.key, a.key, jsonb_typeof(a.value);
```

### 2.8 Triggers `updated_at`

```sql
create trigger trg_objects_updated before update on objects
  for each row execute function set_updated_at();
-- + classification_systems, classification_references
```

### 2.9 Full-text search (D-059, migration 20260712120000)

Parity with a human scanning the properties panel: a keyword is found anywhere
in the content of a node, custom psets included. Exact DDL in the migration.

```sql
create extension if not exists unaccent;   -- + pg_trgm
create function f_unaccent(text) ...          -- IMMUTABLE wrapper (indexable)
create function f_object_search_text(...) ... -- IMMUTABLE flattening of a node (without _keys)
-- objects.search_text = generated stored column (see the §2.1 addendum)
create index idx_objects_search_tsv  on objects using gin (to_tsvector('simple', search_text));
create index idx_objects_search_trgm on objects using gin (search_text gin_trgm_ops);

-- RPC for the LLM tool (parametrized, row cap 50):
-- search_everything(q, object_types[], max_rows) -> id, object_type, object_ref, name,
--   ifc_type, predefined_type, score, match_kind (fulltext|fuzzy), headline,
--   matched_properties (evidence: pset/property/value with the hit)
```

### 2.10 Aggregations over psets (D-060, migration 20260713120000)

A PostgREST filter on a JSONB path compares gt/lt as **text** and cannot aggregate;
sums, averages and numeric comparisons of pset values are done by the RPC `aggregate_objects`
(read-only, `stable`, `set search_path`; internal whitelists of relation/agg/op/columns,
identifiers `format('%I')`, literals `format('%L')`; exact DDL in the migration).

```sql
-- aggregate_objects(relation objects|v_asset_effective, agg count|sum|avg|min|max,
--   prop_path text[],                -- numeric value of a pset (guarded cast,
--                                    --  non-numeric -> skipped_non_numeric)
--   group_by | group_by_path,        -- a column from the whitelist / a pset path as the key
--   filters jsonb,                   -- AND; {column|path, op, value};
--                                    --  gt/gte/lt/lte over a path = NUMERIC
--   ids uuid[],                      -- chaining (e.g. from locate_objects)
--   max_groups <= 50, return_rows)   -- rows mode: top 50 rows with the value
```

### 2.11a Document content (D-063, migration 20260715120000)

Extracted text of PDF pages (`etl/pdf_text.py`, PyMuPDF): full-text search over the content
of documents. Vector drawings have sparse text (expected). A page without a text layer
(image, curves) is read by OCR (D-169): its lines in `blocks` also have `src: "ocr"` and `conf` (0 to 1).

```sql
create table document_pages (
  document_id uuid not null references objects(id) on delete cascade,
  page        int  not null check (page >= 1),
  text        text not null,
  primary key (document_id, page)
);
create index idx_document_pages_tsv on document_pages
  using gin (to_tsvector('simple', lower(f_unaccent(text))));

-- RPC for the LLM tool: search_documents(q, max_rows, doc_id) -> document_id, document_ref,
--   document_name, page, rank, snippet (ts_headline); query words as prefixes (D-123)

-- D-123 (migration 20261020160000): text lines of the page with position
alter table document_pages add column blocks jsonb;  -- [{t, x, y, w, h}] in % of the page, top left
                                                     -- D-169: a line from OCR also has src = 'ocr', conf 0..1 (no migration)

-- D-133 (migration 20261021120000): thick lines of the drawing for calibrating the underlay
alter table document_pages add column lines jsonb;   -- {size: [W, H], segs: [[x1, y1, x2, y2, w]]} in points of the page, bottom left;
                                                     -- lines from 0.99 pt, only vector drawings, otherwise null

-- D-158 (migration 20261023140000): size of the displayed page (with rotation) for the RFC 8118 viewrect
alter table document_pages add column page_size jsonb; -- [width, height] in PDF points
```

Filled by `python -m etl.pdf_text --from-db` (live documents, PDF from storage, D-123) or
a manifest run. Documents from IFC (D-104) are only in `--from-db`.

### 2.11 Static IFC pset dictionary (D-061, migration 20260714120000)

Reference data (pattern `relationship_types`): definitions of standard psets from the bSDD/psd
templates of IFC4X3, generated by `python -m etl.pset_manifest --sql`, ONLY the classes of the project.
Meaning, type and enum of properties (grounding for the LLM); the real occurrence in the data -> `v_property_dictionary` (§2.7).

```sql
create table ifc_property_definitions (
  pset                text not null,      -- 'Pset_DoorCommon'
  property            text not null,      -- 'FireRating'
  data_type           text,               -- PrimaryMeasureType (IfcLabel, IfcAreaMeasure...)
  template_type       text,               -- P_SINGLEVALUE | P_ENUMERATEDVALUE | Q_*...
  enum_values         text[] not null default array[]::text[],
  description         text,               -- cut to 200 characters
  applicable_classes  text[] not null,    -- classes of the project
  primary key (pset, property)
);
```

---


### 2.12 Role privileges (D-079, migration 20261016120000)

RLS is off (D-025) and all reads go through `service_role` (D-026). The roles `anon` and
`authenticated` have **all privileges revoked** in the schema `public` (tables, views, sequences,
functions), also in the default privileges for objects created by the role `postgres`. Reason: the anon key
is in the browser for Realtime Broadcast (live channel, D-079) and without the revoke it would open the whole DB through
PostgREST. `service_role` has an explicit `grant all` / `grant execute`.
A new table or RPC is therefore **not** available to the anon key; if it is ever needed (auth + RLS),
the grant is a deliberate step in a migration.
The role `platform_app` (D-188, §2.22) has no grant on the `public` tables; it writes only into its own schemas `platform` and `platform_pgboss`.


### 2.13 Results of checks against IDS (D-081, migration 20261017120000)

**Declared extension** (IFC has no concept for the result of a check; BCF is an exchange format for
findings, not a store). `ids_runs` = one run of `etl.ids_check` (IDS title/version, SHA-256
of the file, origin in the requirements library, model of the federation, counts). `ids_results` = specification x
element: `spec_identifier` (= ID of the note in the library, e.g. `IU-O-space`), `status`
`pass|fail`, `reasons text[]` (ifctester texts), `object_id` through the active GUID (null = the element
is not in the DB), `ifc_guid` null = the result of a whole required specification without a matching element.
Views: `v_ids_latest` (the last run of every pair IDS x model, with object_ref/name),
`v_ids_summary` (per specification: elements, passed, failed, example_reason).

**D-162 (migration `20261023180000_ids_documents.sql`, test `supabase/tests/ids_documents.sql`):** IDS as
documents with versions, from the chat and from the viewer. Additive; IDS are not in `objects` (D-104):
- `ids_documents` = one IDS: `code` (unique, `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`), `title`, `origin`
  `library|chat`, `library_source` (repo@commit:path; exactly when `origin = library`),
  `derived_from` (FK to `ids_document_versions`, `on delete set null`; only for `chat`, a copy of a library
  snapshot), `status` `draft|active|archived` (default `active`), `created_by`, `created_at`, `updated_at`.
  The origin does not change after creation (trigger).
- `ids_document_versions` = an immutable version: `document_id` (FK, `on delete cascade`), `version` int >= 1
  (unique with `document_id`), `xml` text (the carrier; Studio JSON is not stored), `sha256`, `ids_version`
  (`ids:info/version`), `audit` jsonb (summary of the audit and lint at write time), `author`, `source`
  `chat|viewer|import`, `note`, `created_at`. Trigger: no UPDATE; into a `library` IDS only `import` writes,
  into a `chat` IDS never `import`.
- `ids_runs` + `ids_version_id` (FK, `on delete set null`, null for old runs), `engine`
  `ifctester|ifc-lite` (old runs `ifctester`), `trigger` `etl|chat|viewer` (old `etl`), `binding` bool
  default false (today no run is binding, D-086).
- `v_ids_latest`: the last run of every pair IDS x model; the IDS key is the document (versions of one IDS are
  not mixed with another IDS of the same name), for runs without `ids_version_id` as before `ids_title`.
  New columns at the end: `ids_code`, `ids_doc_version` (version number of the document; `ids_runs.ids_version`
  stays the text from `ids:info`), `engine`, `binding`. `v_ids_summary` has the same extra columns.
- `query_view` whitelist + `ids_documents` (not the versions with XML; XML is read by `ids_document`). Privileges like the other
  new tables: `anon`/`authenticated` nothing, `service_role` everything.

**D-182 (migration `supabase/migrations/20261102120000_ids_library_assign.sql`, NOT APPLIED; test
`supabase/tests/ids_library_assign.sql`):** the requirements library in AIM by deliberate assignment. Additive:
- `ids_document_versions` + `library_repo`, `library_path`, `library_commit`, `library_code` (code of the file at the time
  of assignment). Check `ids_document_versions_library_ref_check`: with `source = 'import'` the repo, path and commit are
  required (`not valid`, old rows are not checked). `author` = who assigned, `created_at` = when. Since releases of the
  library in the DB (D-182 addendum V30) they are written by the release: `library_repo = db:library/<library code>`,
  `library_commit = <release>@<manifest sha256>` (not a git SHA), `library_path` = path of the ER note.
- `ids_document_models` = a manual link of an IDS to a model of the federation: `document_id` (FK, cascade),
  `information_container_id` (FK `information_containers`, only `container_type = 'IFC'`, trigger), `library_container`
  (optional text, e.g. `IU-C-arch-model`), `created_by`, `valid_from`, `valid_until`, `ended_by` (required when
  ending). A unique active pair (partial index); a link can only be ended, an ended one does not change, nothing is deleted.
- `ids_runs` + `engine_version` (version of the tool, for a run from the viewer `@ifc-lite/ids` in the fork), `created_by`.
  A run from the viewer: `trigger = 'viewer'`, `engine = 'ifc-lite'`, `model_revisions` = the revision loaded in the viewer.
- `v_ids_latest`, `v_ids_summary` + at the end `ids_stale` (the IDS has a newer version in AIM than the run; null for runs without
  an IDS version) and `engine_version`. Privileges: `ids_document_models` only `service_role`.

**Requirements library in the DB, read only (D-186; the schema `library` is owned by assetin-library, the truth until the move is in
`assetin-library/docs/SCHEMA.md`):** `library.hlava` = the last revision of every file of the library (`kniznica`, `cesta`,
`note_id`, `typ`, `rev`, `text`, `sha256` hex, `autor`, `vytvorena`, `zdroj`). The schema is not exposed in PostgREST;
anon / authenticated have no access to it. The host reads through RPCs in `public` (migration
`supabase/migrations/20261102200000_library_hlava_read.sql`, APPLIED 2 Nov; test `supabase/tests/library_hlava_read.sql`):
`library_hlava_zoznam(p_kniznica text default null)` (without the text, + `dlzka`) and `library_hlava_subor(p_kniznica, p_cesta)`
(with the text); `stable`, `security invoker`, `search_path = ''`, EXECUTE only `service_role`.
Writing from the editor (D-186 step 3; migration `supabase/pending/20261102210000_library_zapis.sql`, NOT APPLIED; test
`supabase/tests/library_zapis.sql`): `library_texty(p_kniznica)` (the head with the text for the loader on save) and
`library_zapis(p_kniznica, p_autor, p_sprava, p_zdroj, p_schema_verzia, p_zapisy, p_projekcie, p_engine)` =
`library.zapis_revizie` (all or nothing, `ocakavana` sha256, conflict AS409 with the paths in `detail`) and in the same
transaction an upsert of `library.projekcia` for the written files (the projection is computed by the TS engine); EXECUTE only `service_role`.

### 2.14 Revisions of IFC models and edit tasks (D-086, migration 20261018120000)

**Declared extension** (IFC does not carry file versions; BCF carries the topic of a task, not a store).
`model_revisions` = one published version of the IFC file of a model of the federation (`model` = the key
`ifc/<model>.ifc`, `revision` = vNNN, `parent_revision` = the base, `sha256`/`size_bytes`
of the uncompressed file, `archive_path` = the immutable copy `ifc/archive/<model>/vNNN.ifc.gz`,
`recipe_ref` = the recipe in the OCB repo, `guard` = the result of the technical safeguard). Exactly one
`is_current` per model (`uniq_current_model_revision`). Written only by `etl/model_publish.py`
under the model's advisory lock (compare-and-swap against the base of the task). `model_tasks` = an edit
task in the form of a BCF topic (`title`, `description`, `components` = IFC GlobalId of the selection,
`viewpoint`, `status` `open|in_progress|resolved|conflict|failed`, `base_revision`,
`result_revision`, `run_url`, `comments`). anon/authenticated have no privileges (2.12).

**BCF topics (D-099, migration 20261019120000):** `model_tasks` carries all BCF topics over the
models of the federation (clash, feedback, model edit), not only edit tasks. Fields were added
by the BCF API 2.1 topic: `number` (identity, BCF `index`, "topic #N"), `topic_type`
(default `Issue`), `priority`, `assigned_to` (`claude` = a topic for Claude, starts a session),
`due_date`, `labels text[]`, `stage`, `modified_by`, `session_url` (the Claude session that handles
the topic). `model` can be NULL (a topic over the whole federation). `status` gained `closed`
(closed without a revision). `viewpoint` = the view from the viewer (`camera` in the IFC world, `section`,
`mode`, `storey_guid`, count and truncation of the selection), `components` = IFC GlobalId of the topic's elements
(BCF selection; selection from the viewer or given elements). `comments`
= BCF comments `[{guid, author, date, comment}]`; they are appended by the function
`model_task_add_comment(task, author, comment)` atomically (returns the comment, NULL = no such topic). Only `service_role` may execute the function (migration 20261019120100, 2.12). Import of `.bcfzip` (D-158 step 8) writes `created_at`/`updated_at` directly and a comment with its original date through `model_task_import_comment(task, author, comment, date, guid)` (changes neither `updated_at` nor `modified_by`; prepared migration `supabase/migrations/20261101150000_bcf_import_comment_date.sql`, applied 1 Nov; the code also works without it).
Mapping to BCF: `id` = topic guid, `status` = topic_status (lowercase, `in_progress` =
"In Progress"), `author` = creation_author, `created_at`/`updated_at` = creation/modified_date.

**Topic links to documents (D-158, migration 20261022190000):** `model_task_documents` = BCF
DocumentReference, 0..n per topic (`task_id` -> `model_tasks`, `on delete cascade`). `document_id` ->
`objects` (document; `on delete set null`), a snapshot from the time of creation `document_ref` (code or
object_ref), `document_name`, `document_revision`; `page` (from 1, NULL = the whole document), `region` jsonb
`{x, y, width, height}` in % of the page, top left, like `open_drawing region` (NULL = the whole page), `markup`
jsonb array of shapes `{type: cloud|arrow|text|pin, points[{x, y}], text?}` in % of the page, top left, at most 20, text up to 200 characters (D-158 step 7; NULL = no markup, no new migration), `url` (a foreign link from a BCF import), `description`, `author`,
`created_at`. At least one of `document_id`, `document_ref`, `url`. Indexes `(task_id, created_at)`,
`(document_id, page)`. The IFC elements of a topic stay in `model_tasks.components`. BCF API url =
`<origin>/drawing/<id>?page=N&region=x_y_w_h#page=N` (+ `&viewrect=l,t,w,h` in points when
`document_pages.page_size` is known). anon/authenticated have no privileges (2.12).
Steps 3 and 4 (migration 20261023140000): `document_sha256` = sha256 of the document file at the time the link
was created (from `documents.file_sha256`); the snapshot of the cutout is cached in the bucket `documents` under
`snapshots/<sha256>/<page>-<x_y_w_h|full>.png` (render on request, not a table).
Step 6 (migration 20261101120000, not applied): `anchor_pages`, `anchor_page_size` = number of pages and size of the
page of the revision the link was made on (the position is uncertain when they changed), `reviewed_revision`,
`reviewed_sha256`, `reviewed_by`, `reviewed_at` = confirmation of the check after a new revision of the document. The flag
"check after revision" is not stored; it is derived on read (D-158 step 6).

**Manual links of drawing labels (D-160, migration 20261023130000):** `drawing_link_overrides` = a manual
assignment (`assign`) or cancellation (`suppress`) of a label's link; it takes precedence over the D-130 matching.
Key: `document_id` -> `objects` (document; `on delete set null`, snapshot `document_ref`), `page`,
`text` (normalized: without diacritics, lower case, one space) and an optional `bbox` jsonb
`{x, y, width, height}` in % of the page (NULL = all occurrences of the text on the page). `target_id` -> `objects`
(`on delete set null`, snapshots `target_ref`, `target_guid`; `assign` requires `target_ref`).
`document_revision` and `document_sha256` (NULL for now, anchor of D-158 step 4), `author`, `created_at`,
`valid_until` (cancelling a manual correction ends it, the history stays). Unique on the live row
`(document_id, page, text, coalesce(bbox::text, ''))`. anon/authenticated have no privileges (2.12).

**ETL source per model (D-086):** a load with `--model ASR` writes edges with the source
`etl:ASR` and the GUID history with the source `IFC import:ASR`; what the run did not issue, it closes
(`valid_until`). The old sources `etl` / `IFC import` (before D-086) are closed once by
`model_publish close-legacy` after the first load of all models. An object without an active GUID
gets `objects.valid_until` (D-088), the row stays (D-010).

### 2.15 Register of derivation rules (D-089, migration 20261018140000)

`derivation_rules` = a rule of a derived relationship (`id`, `name`, `kind` `geometry|via_space`,
`rel_type`, `source` = the source of edges in `relationships`, `source_classes`, `target_classes`, `roles`,
`enabled`, `mode` `auto|manual`). `derivation_runs` = one run of a rule (`status`
`ok|dry_run|disabled|error`, `trigger`, `models` = revisions from `model_revisions`, `written`,
`closed`, `unresolved`, `details`). Rules at the start: `element_in_space`
(`derive:spatial_reference`, D-080), `element_in_spatial_zone` (`derive:element_in_spatial_zone`)
and `element_in_zone` (no edges: IFC has no relationship for an element in an IfcZone). The view **`v_zone_elements`**
= an element in an IfcZone through spaces (the element in a space natively or by reference, the space a member of the zone
directly or through a nested zone); empty when `element_in_zone` is disabled.

**`v_object_documents`** (D-104 step 2, migration 20261020090000) = documents of an object through relationships:
`object_id`, `object_type`, `object_ref`, `document_id` (for a reference to a part, its document),
`reference_id`, `page`, `via` (`direct|type|zone|group|system|spatial_zone`), `via_id` (the carrier of the
document), `via_nearest_id` (the carrier nearest to the object), `via_space_id`, `depth`, `path`, `role`,
`source`. It goes from the carriers (`rel_associates_document`) down through `rel_assigns_to_group`,
`rel_aggregates` (group, spatial zone), `rel_defines_by_type`, `rel_referenced_in_spatial_structure`
(spatial zone) and `v_zone_elements`, and an element (asset) also from the floor and the room it is in
(`rel_contained_in_spatial_structure`, `rel_referenced_in_spatial_structure`; addendum migration
20261020120000). A room or a spatial zone does not inherit from the floor; the project, building and site do not
pass anything down; E4 links (`pdf_link (E4)`) are left out. `via` is also `floor` and `space`.

### 2.16 Call log of the MCP connector (D-100, migration 20261019140000)

`mcp_call_log` = one call of a connector tool: `tool`, `action` (`args.action`, if the tool has it),
`ms` (the whole call on the server), `ok`, `cold` (first call of a function instance), `phases` (jsonb, ms
per phase `exec`, `broadcast`, `lens`, `readback`, `engine_load`), `region` (`VERCEL_REGION`).
Arguments are not stored. Written by `/api/mcp/<token>` after the response is sent; it serves p50/p95
latency (`eval/MCP-EVAL.md`). `client` (D-159, migration 20261023120000, nullable) = client and conversation:
`clientInfo.name#<sid>` from `Mcp-Session-Id`, `(work)` = a work session on the test channel, without
the header `ua:<User-Agent>`.

### 2.17 Saved views of the viewer (D-122, migration 20261020170000)

**Declared extension** (IFC does not carry views; a BCF viewpoint belongs to a topic). `saved_views` = a viewer
view shared for the building: `name` (unique regardless of letter case among `kind = 'saved'`),
`description`, `viewpoint` (shape like `model_tasks.viewpoint`: `camera` in the IFC world with `projection` and
`ortho_size`, `section` with the host's axis and `coordinate`, `mode`, `storey_guid`, `storey_label`, counts of
the selection, hidden and isolated), `selection`, `hidden` (IFC GlobalId, cap 600), `isolated`
(GlobalId, NULL = no isolation), `model_revisions` (`{model: revision}` at the time of saving, D-086),
`author`, `created_at`, `updated_at`, `last_used_at`. Since D-132 (no migration, only the jsonb shape) `viewpoint` also carries
`view_type` (3d | plan | section | detail), `locked` (camera locked perpendicular), `section.box` (section box
`{min, max}` in the IFC world instead of a plane) and `underlay` (`{document_id, page}`, the calibration stays in the document's
`_georef`). A single row `kind = 'last'` = Last view ("Posledný
pohľad"), overwritten by every save and restore (`uniq_saved_views_last`). Written by the MCP connector
(`saved_view`, `set_view_mode(saved_view)`). anon/authenticated have no privileges (2.12).
Since D-161 (no migration) a row is a durable copy of a view from the upstream Presentation panel (`BasketView`): the row's `id`
is `BasketView.id` (UUID) and `name` is the column; `viewpoint` carries the whole `ViewWire` object of the fork's bridge protocol
(`lib/viewer-views.ts`): `order` (order in the strip), `transition_ms`, `source` (`selection` | `visible` |
`hierarchy` | `manual`), `camera` (`position`, `target`, `up` as arrays [x, y, z] in the IFC world, m, Z up, `fov`,
`projection`, `ortho_size`), `section` (`planes[]` with `axis`, `coordinate`, `position_percent`, `flipped`, `enabled`,
`show_gizmo`, `show_cap`, `show_outlines`, `box?` and `active`), `basket` (`{scope: all, hidden_guids[]}` = the whole
visible model without the hidden ones, or `{scope: guids, guids[], truncated?}`, at most 5000 GlobalId) and `objects`.
The columns `selection`, `hidden`, `isolated` stay empty. A row with `viewpoint.basket` is a view from Presentation;
rows from D-122/D-132 (camera as {x,y,z}, `mode`, `view_type`, `locked`, `underlay`) are not sent to the viewer and the chat
restores them with a fallback (section, camera, isolation on the normal 3D). For Last view (`kind = 'last'`) `viewpoint.id` is
the original view. The viewer (Presentation panel) also writes, through the route `/api/saved-views` behind the env gate
`VIEWS_WRITE_ENABLED` (author `viewer`, a name collision = suffix " 2", " 3"...).

### 2.18 Clash detection tests and runs (D-164, migration `20261023200000_clash.sql`, test `supabase/tests/clash.sql`)

**Declared extension** (IFC does not carry clashes; BCF is an exchange format for findings, not a store). Clashes are not
`objects`. The tables are written only by the host (`service_role`); `anon`/`authenticated` have nothing.
- `clash_tests` = a test: `code` (unique, `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`; it is also the rule id in `clash_key`), `name`,
  `description`, `origin` `default|chat|viewer` (`default` = a fixed test from the host's code, `VZT-NOSNE`, `VZT-ASR`; the host
  aligns it with the code at the first save of a run), `rules` jsonb (a non-empty array; today one rule
  `{id, a: {type, model?, storey?}, b?: {...}}`, `type` is a class selector of upstream `@ifc-lite/clash`), `settings` jsonb
  (`{mode: hard|clearance, clearance_mm?, tolerance_mm?}`), `created_by`, `created_at`, `updated_at`.
- `clash_runs` = a run: `test_id` (FK `on delete cascade`, null = an ad hoc run), `test_code`, `rules_snapshot` jsonb
  (`{spec}`: the rule and settings at the time of the run, also with an overridden floor), `models` jsonb (`{model: {etag, size, loaded_at}}`
  revisions, D-086), `engine` (`@ifc-lite/clash@2.4.4 (ts)`), `trigger` `chat|viewer`, `completeness` jsonb (`truncated`: cap
  of pairs; `coverage_omitted`), `summary` jsonb (`total`, `by_status`, `by_severity`, `by_storey`, `by_type_pair`, `sets`),
  `coverage` jsonb (`{a: [model:GUID...], b: [...] | null}`: the elements the run checked; without them a comparison cannot say "resolved",
  at most 30 000 per side, otherwise null), `created_by`, `created_at`; index (`test_id`, `created_at desc`).
- `clash_results` = a clash of a run (`id` bigint): `run_id` (FK `on delete cascade`), `clash_key` (= upstream `clashReviewKey`:
  `<rule> <model:GUID> <model:GUID>` regardless of the order of the pair), `rule`, `status` `hard|clearance` (`touch` is
  not stored), `severity` `critical|major|minor|info`, `distance` (m, negative = depth of penetration), `a_guid`/`a_model`/`a_ifc_type`/
  `a_name` and the same for `b_*`, `storey`, `center` jsonb (`[x, y, z]` in the IFC world, m, Z up), `point` and `bounds` jsonb as the
  engine gave them (Y up; for restoring a run and clustering); cap of 100 000 rows per run (above it the host refuses and advises narrowing);
  indexes (`run_id`), (`clash_key`).
- `clash_reviews` = the state of a clash across runs: PK (`test_id` FK `on delete cascade`, `clash_key`), `status`
  `open|resolved|accepted` (default `open`), `comment`, `bcf_topic_id` (FK `model_tasks`, `on delete set null`),
  `updated_by`, `updated_at`. A row is created when a state is set or a BCF topic is attached; a clash without a row is `open`.
- `v_clash_latest` = clashes of the last run of every test (ad hoc runs are not here) with the state (`review_status`,
  `review_comment`, `bcf_topic_id`, `bcf_topic_number`), the elements from the AIM graph (`a_object_ref`, `b_object_ref` through the active
  `ifc_guid_history`) and the element's system (`a_system`, `b_system`: the first by name from `rel_assigns_to_group`, without duplicating
  rows). `v_clash_summary` = the same run per rule, floor and state (`clashes`, `hard`, `clearance`, `critical`, `major`,
  `minor`, `info`). Both and `clash_tests` are in the `query_view` whitelist. Privileges: `anon`/`authenticated` nothing, `service_role` everything.

### 2.19 Containers, revisions and the complete copy of a revision (D-183; K1 and K2 implemented)

**Source of truth (D-183):** the content of a model comes from the revision container (the file in the archive, sha256); the DB carries (1) the record
of the container and the revision, (2) a complete copy of the information of every revision without geometry and (3) the AIM layer.
- **Container and revision (K1, migration `20261030120000_information_containers.sql`, test `supabase/tests/information_containers.sql`):**
  - `ifc_application` (`IfcApplication`: `application_developer`, `version`, `application_full_name`,
    `application_identifier`; unique identifier + version) and `ifc_actor` (`IfcPersonAndOrganization`: `person_name`,
    `organization_name`, optionally `person_id` / `organization_id` -> `objects`, `roles`; unique name + organization;
    `ifc_actor_for(name, org)` finds or creates it).
  - `information_containers` = a container across revisions by `IfcDocumentInformation`: `identification` (unique; model =
    `ASR`, document = its `Identification`, on a clash `object_ref`), `name`, `description`, `purpose`, `intended_use`, `scope`,
    `confidentiality`, `electronic_format`, `document_owner_id` -> `ifc_actor` (= OwningUser), `container_type`
    `IFC|PDF|DWG|OTHER`, `model` (unique, exactly for IFC), `document_id` (unique -> `objects`, `on delete set null`; only
    `object_type = 'document'`, not a part of a document).
  - `container_revisions` = one `Revision`: `revision` (text, today a number), `revision_no` (order in the main line; model =
    vNNN, document 1, 2...), `parent_revision_no`, `model_revision_id` (unique -> `model_revisions`, `on delete cascade`),
    `sha256` (64 hex, uncompressed content), `size_bytes`, `location` (archive / bucket), `electronic_format`, `creation_time`
    (the first revision of the container), `last_revision_time` (this revision), `editors_id` -> `ifc_actor` (= LastModifyingUser),
    `owning_application_id`, `last_modifying_application_id` -> `ifc_application`, `change_action`
    (`ADDED|MODIFIED|DELETED|NOCHANGE|NOTDEFINED`; ADDED the first, MODIFIED the next), `state` (`IfcStateEnum`), `status`
    (`IfcDocumentStatusEnum`, default DRAFT = WIP), `approval` jsonb (`IfcApproval`, ISO 19650; NULL for now), `file_header`
    jsonb (the STEP header, filled by K2), `recipe_ref`, `task_id`, `commit_sha` (from `recipe_ref` after `@`); unique
    (`container_id`, `revision_no`).
  - Filled by a trigger; neither the host nor the ETL changes: an `insert` into `model_revisions` (`etl.model_publish`) creates the revision of the model's
    container in the same transaction; a new `documents.file_sha256` creates a revision of the document's container (the same content does nothing).
  - Guards: a new revision must be higher than the last one and follow it (`parent_revision_no` = the last; main line only);
    `sha256`, size and order of a revision do not change (also in `model_revisions`); only the last revision of a container can be deleted
    (also through `on delete cascade` from `model_revisions`).
  - `v_container_revisions` = revisions with IFC terms (`owning_user`, `last_modifying_user`, `owning_application`,
    `last_modifying_application`, `change_action`, `status`, `is_latest`...).
  - Backfilled: all `model_revisions` and documents with `file_sha256` (a container also for a document without sha256).
- **Input signature (K1):** `ids_runs.model_revisions` and `clash_runs.model_revisions` jsonb `{model: revision}` (default
  `{}` = unknown). The engine carries the revision of the archive it loaded the model from (`engineRevision`, `revision` in `models`); an IDS run
  writes it, a clash run without it gets it filled by a trigger from `models` (`engine_model_revisions`: `revision` from the engine, otherwise an unambiguous match
  of `size` with `model_revisions.size_bytes`; the old runs were backfilled the same way). The item `_georef` (v2 `calibrations[]` and v1)
  gets `model_revisions` and `document_sha256` from a trigger on write: the same calibration (page, `affine`, `region`) carries over
  the old stamp, a new one gets the current revisions; backfilled with the revisions valid at the time `calibrated_at` (`model_revisions_at(t)`).
  `v_ids_latest`, `v_ids_summary`, `v_clash_latest`, `v_clash_summary` have at the end `based_on` (the signature, NULL = unknown) and
  `stale` (`revisions_stale`: true = differs from the current revisions, NULL = unknown). Privileges: `anon`/`authenticated` nothing.
- **Complete copy of a revision (K2, migration `20261030130000_ifc_revision_copy.sql`, test `supabase/tests/ifc_revision_copy.sql`):**
  written only by `python -m etl.revision_copy` (etl/README), full copies without geometry; the AIM graph does not change.
  - `ifc_rev_imports` (PK `model`, `revision`; FK to `model_revisions`, `on delete cascade`) = a run of the copy: `sha256`
    (verified archive), `status` `done|failed`, `hash_version`, `schema_identifier`, `counts` (`file` and `db`: objects per
    class, relationship pairs per class, pset attachments per class, `ifc_root` and `ifc_root_accounted`), `warnings`,
    `error`, `engine`, `started_at`, `finished_at`.
  - `ifc_rev_objects` (PK `model`, `revision`, `global_id`) = every IfcRoot except relationships and sets: `ifc_class`, `attributes`
    jsonb (schema attributes; an IfcRoot value = `{"ref": GlobalId}`, other entities nested with `_class`, without geometry,
    placement and OwnerHistory), `file_owner_history` jsonb (ChangeAction, OwningUser, OwningApplication... for information only),
    `content_hash`. Index (`model`, `revision`, `ifc_class`).
  - `ifc_rev_relationships` (PK `model`, `revision`, `rel_class`, `relating`, `related`) = a pair from an IfcRel* (without
    IfcRelDefinesByProperties): `relating` = the carrier (Relating*), `related` = the other side (Related*), a GlobalId or
    a natural key `Class:Identification|Name` (otherwise `Class:#hash`), `relating_class`, `related_class`, `attributes`
    jsonb (sorted variants of the other attributes), `multiplicity`, `rel_global_ids` (for information only), `content_hash`.
    Indexes (`model`, `revision`, `related`) and (`model`, `revision`, `relating`, `rel_class`).
  - `ifc_rev_property_sets` (PK `model`, `revision`, `global_id`, `pset_name`) = a set on an occurrence or a type: `pset_class`
    (IfcPropertySet, IfcElementQuantity, predefined), `properties` jsonb `{name: value}` (numbers to 12 significant
    digits; a unit with the value as `{value, unit}`), `pset_global_ids` (for information only), `content_hash`.
  - `ifc_rev_resolve(model, revision)` (NULL = current; only `done`, otherwise an error with the command), `ifc_rev_storey_elements(model,
    revision, storey, system?)` (IfcRelContainedInSpatialStructure by name or GlobalId of the storey, optionally a member of
    a system `ilike`), `ifc_rev_compare(model, from, to)` = `global_id`, `ifc_class`, `change_action`
    (ADDED|DELETED|MODIFIED, NOCHANGE only with the note `changed via type`), `aspects` jsonb (`attributes`, `psets`
    `Pset.Property`, `relations` `+|-|~Class:carrier` attributed to the Related side). Placement is not in the DB (`etl.revision_compare
    --placement`). The functions are called only by `service_role`; the tables give `anon`/`authenticated` nothing.
- **K3 step 2 (migration `20261031120000_rel_contained_from_revision_copy.sql`):** the view
  `rel_contained_in_spatial_structure` = `IfcRelContainedInSpatialStructure` from `ifc_rev_relationships` for every model
  from the current revision with a `done` copy (otherwise the newest lower `done`). Columns: `id` (`md5(model|revision|relating|related)::uuid`),
  `from_id` (the element, an AIM node through the active `ifc_guid_history` and the live `objects`), `to_id` (the container; a storey of a model without
  its own node, e.g. VZT, through `ifc_np_key(Name)` = the floor number on the AIM `floor`), `valid_from` (`ifc_rev_imports.finished_at`),
  `valid_until` (always null), `source` (`ifc:VZT v11`), `model`, `revision`, `global_id` (the element from the file), `container_global_id`,
  `via_global_id` (the whole from which a part of an assembly with an `asset` node inherits the container one level up, e.g. a railing in
  a staircase). A side without an AIM node has `from_id`/`to_id` null. The view does not read edges of this `rel_type` in `relationships`.
  Function `ifc_np_key(text)` (immutable, `2NP`, `2.NP`, `2. NP`, `1NP_VZT` -> `2NP`/`1NP`), index
  `idx_ifc_guid_history_active_guid` (`ifc_guid` with `valid_until is null`).
- **K3 step 2b (migration `20261031150000_rel_views_from_revision_copy.sql`):** the views `rel_aggregates`
  (IfcRelAggregates), `rel_defines_by_type` (IfcRelDefinesByType), `rel_assigns_to_group` (IfcRelAssignsToGroup),
  `rel_associates_document` (IfcRelAssociatesDocument, `role` = `document`), `rel_associates_classification`
  (IfcRelAssociatesClassification) = pairs of the class from `ifc_rev_relationships` of the revision from `ifc_rev_current` ∪ rows of
  `relationships` of the same `rel_type` where `rel_is_aim_layer(source)` (the source is neither `etl` nor `etl:*`, e.g. `pdf_link (E4)`,
  `doc_upload (D-036)`; with the original columns, the new ones null). A row from the file: `id` (`md5(model|revision|rel_class|relating|related)::uuid`),
  `from_id` = Related, `to_id` = Relating (AIM nodes through `ifc_guid_node`; null without a node), `valid_from` (`finished_at`), `valid_until`
  null, `source` (`ifc:ASR v79`), `model`, `revision`, `global_id` (Related) and the Relating key from the file: `parent_global_id`,
  `type_global_id`, `group_global_id`, `document_key` (`IfcDocumentInformation:<Identification>` / `IfcDocumentReference:<Identification>`),
  `classification_key` (`IfcClassificationReference:<Identification>`, `IfcClassification:<Name>`). Mapping of a Relating without a GUID:
  a document through the single match of `documents.identification` on a `document`/`document_reference` node of the key's class, a classification through the single
  match of `classification_references.identification`; a type without its own node (merged by the ETL, D-033) since step 3 through a GUID alias
  (`ifc_guid_aliases` in `ifc_guid_node`; the original bridge by the occurrence's `object_ref` was removed). The VZT storey is not mapped in
  `rel_aggregates`. Helper views `ifc_rev_current` (model, revision, finished_at: the current `done`, otherwise the newest lower `done`) and
  `ifc_guid_node` (ifc_guid, object_id, object_type, object_ref, `alias_reason`: the active `ifc_guid_history`, otherwise the active
  `ifc_guid_aliases` with `alias_reason` = `type_code`), function `rel_is_aim_layer(text)` (immutable); only `service_role`.
- **K3 step 3 (migration `20261031180000_ifc_guid_aliases.sql`):** the table `ifc_guid_aliases` (§2.4) with a backfill
  from the bridge over the copy of the current revision (only unambiguous type GUIDs; production 31 Oct: 8 ASR GUIDs -> 7 `asset_type`, 35
  occurrences), `ifc_guid_node` with the alias, `rel_defines_by_type` without the bridge. The graph ETL stopped writing edges of six types
  from the copy (`etl/manifest.py` `FROM_REVISION_COPY`); ending them is a separate migration `20261031190000` (applied 31 Oct, Samuel: end them;
  on Samuel's word).
- **K3 step 4 (migration `20261031210000_ifc_storey_map.sql`):** the view `ifc_storey_map` (R6) = every `IfcBuildingStorey` from the copy
  of the current `done` revision of every model (`ifc_rev_current`) -> an AIM floor. Columns: `model`, `revision`, `global_id`, `name`,
  `elevation` (from the copy), `to_id`, `floor_ref`, `floor_name` (the AIM floor or null), `match_rule` (`guid` = own node through
  `ifc_guid_node`, `name_number` = the single AIM floor with the same number from the name `ifc_np_key`; null = unmatched), `reason`
  (when unmatched: `no_number_in_name` | `no_floor_for_number` | `ambiguous_floors`), `floor_elevation`
  (`Pset_BuildingStoreyCommon.ElevationOfFFLRelative` of the AIM floor) and `elevation_check` (`match` | `mismatch` | `unknown`, tolerance 1;
  only a check, it does not change the matching). `rel_contained_in_spatial_structure` takes a storey without its own node from it (instead of the CTE
  `floor_by_np`). Only `service_role`.

### 2.20 ICDD import (D-181, migration `20261101140000_icdd_imports.sql`, PREPARED, not applied; test `supabase/tests/icdd_imports.sql`)

The ICDD export has no table of its own: the plan is assembled at every export from `model_revisions`, `v_container_revisions`, `documents`,
`rel_associates_document`, `rel_referenced_in_spatial_structure` (`source derive:*`), `ifc_rev_objects` (GlobalId -> model),
`ifc_storey_map` and `derivation_runs` (`lib/icdd/plan-fetch.ts`). Import (D-181 addendum "import"):
- `icdd_imports` = a run of a container import: `version_id` (`ct:versionID`), `container_sha256` (64 hex, the whole `.icdd`), `file_name`,
  `status` `checked|applied|rejected|failed` (`applied` exactly with `applied_at`), `same_as_aim` (export-only layers without a difference),
  `payloads` `{filename: sha256}`, `counts` (links, changes, findings per code), `diff` (`RoundtripDiff` of the export-only layers),
  `issues` (errors of the ISO 21597 check), `findings` (findings of the import `{code, level, key, detail}`), `changes` (preview of the write
  `{op: add|close, ...}`), `model_revisions` `{model: revision}` of AIM at the import, `aim_state_sha256` (64 hex, the AIM state at the preview),
  `written_ids` / `closed_ids` (`relationships.id`), `message`, `imported_by`, `created_at`, `applied_at`. Indexes (`version_id`,
  `created_at desc`) and (`container_sha256`, `created_at desc`). No FK. Privileges: `anon`/`authenticated` nothing.
- `icdd_apply_import(p_import uuid, p_aim_state text, p_changes jsonb) returns icdd_imports` (security definer, only service_role):
  in one transaction it closes (`valid_until`) the live links of the AIM layer `rel_associates_document` (`rel_is_aim_layer`) and inserts new ones with
  `source = 'icdd:<version_id>'`, `role = 'document'`; the import must be `checked` with the same `aim_state_sha256`; a duplicate live link
  and an unknown operation = an exception.

### 2.21 Verification of quantities (D-185, migration `20261101200000_verification_results.sql`, PREPARED, not applied; test `supabase/tests/verification_results.sql`)

Written only by the host (`ifc_measure verify=true save=true`, `lib/verify/store.ts`, service_role); the rules and the texts of the methods are in the register
`lib/verify/quantity-methods.ts`, not in the DB. Nothing is written into IFC.
- `verification_runs` = a verification run: `id`, `created_at`, `scope` (`IfcSpace`), `registry_version`, `engine`, `model_revisions`
  jsonb `{model: revision}` (input signature, D-183 point 11; an object), `counts` jsonb `{green, yellow, red, grey}`, `author`. Index
  (`created_at desc`).
- `verification_results` = the result of a recipe on an element: `run_id` (FK, `on delete cascade`), `model`, `revision`, `global_id`,
  `element_name`, `target` (`Qto_SpaceBaseQuantities.Height`), `recipe` (with its version), `status` `green|yellow|red|grey`, `file_value`,
  `computed_value` (m, m2, m3), `method`, `definition`, `spec_ref`, `tolerance`, `formula`, `note`, `distinct_heights` jsonb (array),
  `anchors` jsonb (array `{global_id, role, z_m?}`). Indexes (`run_id`), (`model`, `global_id`, `recipe`).
- `v_verification_latest` = the last result of a recipe on an element with `checked_at`, `registry_version`, `engine`, `based_on` (the signature,
  NULL = unknown) and `stale` (`revisions_stale`). Privileges: `anon`/`authenticated` nothing.
- **D-185 UI (migration `20261102230000_verification_inputs.sql`, applied 2 Nov; test `supabase/tests/verification_inputs.sql`):**
  `verification_results.inputs` jsonb (object `{expression?, cells: [{key, label, value, unit, global_id?}], file_meta?: {method_of_measurement?,
  formula?}}`) and `explanation` text (how the recipe is computed, from the register); `v_verification_latest` has them at the end. Old rows NULL (the viewer
  shows the formula as text); a DB without the migration gets a run without them (`lib/verify/store.ts`).

### 2.22 Schema `platform` for the Assetin platform (D-188, migration `20261104220000_platform_schema.sql`, applied 4 Nov; test `supabase/tests/platform_schema.sql`)

The schema `platform` is owned by the AIMforked repo (fork of Archives, Drizzle); AIMviewer neither migrates nor reads it. This migration only prepares the place:
- the extension `vector` in `public`, the text search configuration `public.simple_unaccent` (full-text search of the fork);
- the role `platform_app` (login, `connection limit 20`, `search_path = platform, public`, password outside git), owner of the schemas `platform`
  and `platform_pgboss` (pg-boss queues); `usage` on `public`, `create` on the database; no privileges on the tables of `public` and `library`;
- the content of `platform` (31 Archives tables, `progress_notifications`, the journal `__drizzle_migrations`) is created by the fork's migrations.

### 2.23 Projects (D-189, migrations `20261104233000_multi_project.sql`, applied 5 Nov, `20261105115915_library_release_project.sql` and `20261105120000_multi_project_cleanup.sql`, all applied 5 Nov; test `supabase/tests/multi_project.sql`)

A project is the `objects` node with `object_type = 'project'` (IfcProject); its `id` is the project id
(`platform.projects.id`) and its `object_ref` is the project code (`IfcProject.Name`). OCB =
`9e2dfcba-437b-43d3-a925-0dd29f195b38`. IFC defines IfcProject per exchange, so the IfcProject of every other
file of the project is an `ifc_guid_aliases` row of the node.

- **`project_id uuid` references `objects(id)`** on `objects` (NULL only for `person` and `organization`, a project
  node has `project_id = id`; check `objects_project_scope`, trigger `trg_objects_project_scope`), `relationships`
  (derived by `relationships_validate` from the endpoints, NULL for edges between global nodes, edges across
  projects are rejected), and NOT NULL on `information_containers`, `model_revisions`, `model_tasks`, `saved_views`,
  `clash_tests`, `clash_runs`, `ids_documents`, `ids_runs`, `derivation_runs`, `verification_runs`, `icdd_imports`,
  `drawing_link_overrides`, `ifc_guid_aliases`; nullable on `mcp_call_log`. No column has a default project: a
  writer that does not name the project gets an error. Other tables take the project of their parent row. Global: persons, `ifc_actor`, `ifc_application`, classification, `relationship_types`,
  `ifc_property_definitions`, `derivation_rules`, schema `library`.
- **Model identity:** the model is its container (`information_containers.id`); the code (`ASR`) is a label unique
  within a project (`uniq_information_containers_project_model`). `model_revisions.container_id` (set by the writer;
  `trg_model_revisions_container` rejects a missing one or a container of another model or project), unique
  `(container_id, revision)` and current per container. The revision copy is keyed by `model_revision_id`: PK of `ifc_rev_imports` is `model_revision_id`,
  PKs of `ifc_rev_objects` / `_property_sets` / `_relationships` start with it; `model` and `revision` stay as
  labels. The writer sets `model_revision_id`; nothing looks it up from `(model, revision)`.
- **Per-project keys:** `clash_tests (project_id, code)`, `ids_documents (project_id, code)`, `model_tasks
  (project_id, number)`, `saved_views (project_id, lower(name))` for `saved` and `(project_id)` for `last`,
  `information_containers (project_id, identification)`, `ifc_guid_aliases (project_id, ifc_guid)` active.
  `objects.object_ref` stays unique across the platform; index `objects (project_id, ifc_guid)`.
- **BCF topic numbers** (`model_tasks.number`, BCF `topic.index`) count per project from 1: `bcf_topic_counters
  (project_id, last_number)` (RLS on, only `service_role`), taken by `trg_model_tasks_number` on insert under the
  row lock of `on conflict do update`. A number cannot be set by the writer, and number and project of a topic do
  not change. OCB kept its numbers and continues after the last value of the former global identity.
- **Views:** every `v_*`, `rel_*`, `aim_rel_*`, `ifc_guid_node`, `ifc_rev_current` (also `container_id`,
  `model_revision_id`) and `ifc_storey_map` (also `model_revision_id`) has `project_id` as the last column; GUIDs
  resolve within the project of the revision.
- **Functions:** `project_model_revisions_at(p_project, t)`, `project_revisions_stale(p_project, based_on)`,
  `project_engine_model_revisions(p_project, models)`, `ifc_rev_revision_id(p_project, model, revision)`,
  `container_for_model(p_project, model)`, `georef_stamp(..., p_project)`. RPCs `search_everything`,
  `search_documents`, `aggregate_objects`, `ifc_rev_resolve`, `ifc_rev_storey_elements`, `ifc_rev_compare` have a
  trailing `p_project uuid`. It is `DEFAULT NULL` only because the parameters before it have defaults; NULL raises
  "p_project is required" (`project_required(p_project, caller)`). Library release: `library_vydaj(..., p_project)`
  and `library.publikuj_ids(p_vydanie, p_polozky, p_project)` write the IDS into the catalog of that project.
- **History:** until the cleanup migration `20261105120000` the app and ETL of before 5 Nov kept working through a
  DEFAULT OCB on the columns and on `p_project`, the old global keys (`information_containers (model)` and
  `(identification)`, `model_revisions (model, revision)` and current `(model)`, `ifc_rev_imports (model, revision)`,
  `clash_tests (code)`, `ids_documents (code)`, `uniq_model_tasks_number`, `uniq_saved_views_name`,
  `uniq_saved_views_last`, `uniq_active_guid_alias`), the OCB wrappers `model_revisions_at`, `revisions_stale`,
  `engine_model_revisions`, `container_for_model(model)`, `georef_stamp(_item)` without the project, the triggers
  that filled `container_id` and `model_revision_id` from `(model, revision)`, and one global identity for BCF
  numbers. The cleanup migration removed all of it.

### 2.24 Entity manifest `entity_types` (D-195, migration `20261105130000_entity_types.sql`, not applied; test `supabase/tests/entity_types.sql`)

Every entity of IFC 4.3 as data, one row each (876), global (no `project_id`, like `relationship_types`). Generated
by `python -m etl.entity_manifest --write` from ifcopenshell `IFC4X3_ADD2`, whose entities equal the entity files of
the pinned schema submodule `vendor/ifc4.3` (`424cadb`); the migration is checked in and CI (`ifc-manifest`) plus
`etl/tests/test_entity_manifest.py` regenerate it and fail on drift. No text from the schema docs is stored
(CC BY-ND 4.0); the docs file is `vendor/ifc4.3/docs/schemas/<schema_layer>/<schema_package>/Entities/<ifc_class>.md`.

| Column | Meaning |
|---|---|
| `ifc_class` PK | IFC entity name, e.g. `IfcDoor` |
| `supertype` | direct supertype (FK to `ifc_class`), NULL at roots |
| `ancestors text[]` | supertypes, root first, without the class (`IfcTask`: IfcRoot, IfcObjectDefinition, IfcObject, IfcProcess) |
| `is_abstract` | ABSTRACT in EXPRESS (133) |
| `is_root` | IfcRoot subtype (484) |
| `is_node` | stored as a node in `objects` (422): every IfcObjectDefinition subtype plus the resource entities with identity of R1 (IfcApproval, IfcDocumentInformation, IfcDocumentReference, IfcMetric, IfcObjective, IfcOrganization, IfcPerson; not IfcRoot, exported as resource entities) |
| `schema_layer`, `schema_package` | e.g. `shared`, `IfcSharedBldgElements` |
| `attributes jsonb` | own explicit attributes in schema order: `{name, type, kind (entity, enum, select, type, simple), optional, aggregate?, enum?}`; inherited ones are on the supertypes |
| `schema_version`, `source_commit`, `source` | `IFC4X3_ADD2`, submodule commit, `ifcopenshell` |

Functions (read-only, `stable`, no rights for `anon`/`authenticated`): `entity_is_a(child, ancestor)` = the class
is the ancestor or its subtype (R9 categories, R10 relationship validation); `entity_attributes_unknown_keys(ifc_class,
attributes)` = keys of `properties._attributes` the class with its supertypes does not declare (keys starting with
`_` skipped). `object_type` is not tied to the manifest (R9: the node type is `ifc_type`).

### 2.25 Transaction log `audit.log` (D-196, R2/R12, migrations `20261105160000_audit_log.sql` and `20261105160100_postgrest_pre_request.sql`, not applied; test `supabase/tests/audit_log.sql`)

One append-only table for every write to the AIM graph tables in `public`. A declared extension (plan 7.3 point 6):
IFC has only IfcOwnerHistory, which is derived from it.

| Column | Meaning |
|---|---|
| `id` bigint identity, `at` timestamptz | PK `(id, at)`; `at` = `clock_timestamp()` |
| `txid` | transaction id, groups the rows of one write |
| `person_id` uuid | IfcPerson node of the writer (`app.person_id`), NULL when unknown (until step 5) |
| `db_role` | role that ran the statement (`service_role`, `postgres`, `platform_app`) |
| `source` | `app.source`, else the connection's `application_name` (`app`, `app:<route>`, `etl:<scope>:<run>`, `api:<role>`) |
| `table_name`, `row_id` | `public.objects`, the primary key (composite keys `/`-joined) |
| `project_id` | the row's `project_id`, or that of its `objects` row for 1:1 suffixes; NULL for global tables |
| `op` | `INSERT`, `UPDATE`, `DELETE`, `RUN` (one summary row per ETL load, `table_name = 'etl'`) |
| `before`, `after` | full rows as jsonb |

- **Partitions:** by month (`audit.log_YYYY_MM`, 24 from Nov 2026) and `audit.log_default`;
  `audit.ensure_partitions(months, from)` adds months. Indexes on `at`, `(table_name, row_id, at)`, `(project_id, at)`.
- **Append-only:** owned by `audit_owner` (NOLOGIN; `postgres` is not a member after the migration). No role holds
  insert, update, delete or truncate. Rows come only from `audit.write()` and `audit.write_run()` (SECURITY DEFINER);
  `audit.reject_change` rejects update, delete and truncate (on the parent and every partition), also for the owner.
  `platform_app` (the fork) has usage on `audit` and execute on `audit.log_row()` and `audit.write(...)` only (migration
  `20261105180000_audit_platform_app_grants.sql`, not applied), so the fork's triggers on `platform` can log.
  `postgres` and `service_role` may read it; `anon` and `authenticated` cannot use the schema.
- **Triggers:** `audit_log_ins_del` (after insert or delete) and `audit_log_upd` (after update, `when old.* is
  distinct from new.*`) run `audit.log_row(<pk columns>[, '@objects'])` on 25 tables: `objects`, `documents`, `spaces`,
  `floors`, `persons`, `captures`, `capture_media`, `relationships`, `classification_systems`,
  `classification_references`, `information_containers`, `container_revisions`, `model_revisions`, `model_tasks`,
  `model_task_documents`, `saved_views`, `ids_documents`, `ids_document_versions`, `ids_document_models`,
  `clash_tests`, `clash_reviews`, `drawing_link_overrides`, `ifc_guid_aliases`, `relationship_types`,
  `entity_types`. An update that changes only `updated_at` is not logged (the ETL's no-op rewrites). Not logged:
  `ifc_rev_*`, run results (`clash_results`, `ids_results`, `verification_results`, `document_pages`, run tables),
  `mcp_call_log`, `ifc_guid_history`, `bcf_topic_counters`. Platform tables: AIMforked PR (D-188).
- **Who writes:** PostgREST runs `public.aim_pre_request()` before every request (`pgrst.db_pre_request` on role
  `authenticator`, migration `20261105160100`): for the `service_role` key it copies the headers `x-aim-person-id`
  (UUID only) and `x-aim-source` into `app.person_id` / `app.source`; for any other role it sets
  `app.source = 'api:<role>'` and no person. It never fails a request. The app's server client sends the headers
  (`lib/audit/context.ts`); the ETL tags every connection with `PGAPPNAME` and the main load sets both settings
  (`etl/audit.py`, person from `AIM_PERSON_ID`).
- **IfcOwnerHistory:** `public.ifc_owner_history(table, row_id)` and the view `public.v_ifc_owner_history` (per
  logged row): `creation_date` (first insert), `owning_user`, `owning_application`, `change_action`
  (IfcChangeActionEnum ADDED, MODIFIED, DELETED from the last write), `last_modified_date`, `last_modifying_user`,
  `last_modifying_application`, `project_id`. No rights for `anon`/`authenticated`.

## 4. The `properties` convention (D-022)

`properties` JSONB contains **property sets**, nested by name. IFC **attributes**
do NOT belong here (they are columns).

| Layer | Where | Distinction |
|---|---|---|
| 1, IFC attributes | columns on `objects`; the others in `properties._attributes` (D-195) | from the schema (`entity_types.attributes`) |
| 2, standard psets | `properties[<name>]` | name `Pset_` / `Qto_` |
| 3, custom psets | `properties[<name>]` | anything else (without `Pset_`/`Qto_`) |

**Reserved `_keys`:** names starting with `_` are not psets but meta or captured data.
Psets never start with `_`. Currently used (declared extensions, D-046):
`_contact`, `_org` (capture-don't-structure, §7), `_drawing_links` (clickable
regions of drawings, D-042, written by `etl/pdf_link.py`), `_georef` (georeference of a
PDF underlay to a floor, D-072, written by `PATCH /api/underlay`; v2 `{version, calibrations[], history?[]}`, an item can carry `region` `[x, y, w, h]` in % of the page, top left, for a sheet with several drawings (D-180), `history` = at most 10 previous calibrations `{page, calibration, replaced_at, replaced_by: mcp|panel, reason}` before the position is overwritten, newest first, D-168), `_capture`
(anchoring of a reality-capture point: `plan`{documentId,page,u,v} + `world`{x,y,z} +
`yaw`, versioned; D-073, written by `POST /api/captures`, only on `object_type='capture'`),
`_model` (the model of the federation that issued the document; the ETL ends documents of a model that it no longer
issues, D-104) and `_ifc_location` (the original `Location` from the file, when `documents.location`
points to a file in the bucket `documents`, D-104); both only on `document`/`document_reference`. `_ref` (D-190) = the plain ref
(SNIM code, room number) of a node of a project other than OCB whose `object_ref` is `<project code>:<ref>`; written by the ETL.

**`_attributes` (D-195, declared extension, plan round 8 and 7.3 point 2):** IFC attributes of the node's class
(`ifc_type`, with its supertypes in `entity_types`) that have no column, keyed by the IFC attribute name, e.g.
`{"_attributes": {"Status": "Planned", "IsMilestone": false, "TaskTime": {"_class": "IfcTaskTime",
"ScheduleStart": "2026-11-05T08:00:00"}}}`. Values follow the canonical form of `ifc_rev_objects.attributes`
(`etl/revision_copy.py`): an entity reference to an IfcRoot as `{"ref": <GlobalId>}`, a value entity without
identity nested as an object with `_class` and its own attributes (IfcTaskTime, IfcTaskTimeRecurring with
IfcRecurrencePattern, IfcEventTime, IfcCostValue, IfcPostalAddress, IfcTelecomAddress). Not here: attributes that
have a column (`GlobalId` = `ifc_guid`, `Name`, `Description`, `ObjectType`, `PredefinedType`...), IfcOwnerHistory
(derived at export, 7.3 point 5), relationships (`relationships`), IfcActorRole (on the edge). A value that is
searched gets a column instead (round 8). `entity_attributes_unknown_keys(ifc_class, jsonb)` lists keys the class
does not declare; it is a report, nothing is rejected.

---

## 5. Mapping of names <-> IFC (D-009, D-012)

The schema is IFC-aligned, not a direct implementation (Postgres lowercases identifiers;
CamelCase would need quotes and would hurt LLM text-to-SQL). The IFC link is through
`ifc_type`/`ifc_guid` and the export.

| Our object / edge | IFC |
|---|---|
| `objects` (occurrence) | IfcObject (IfcProduct...) |
| `object_type='asset_type'` | IfcTypeObject / IfcElementType |
| `object_type='person'` / `'organization'` | IfcPerson / IfcOrganization |
| `object_type='system'` | IfcDistributionSystem (predefined_type = IfcDistributionSystemEnum), D-047 |
| `rel_aggregates` | IfcRelAggregates (IfcRelDecomposes) |
| `rel_contained_in_spatial_structure` | IfcRelContainedInSpatialStructure (IfcRelConnects) |
| `rel_defines_by_type` | IfcRelDefinesByType (IfcRelDefines) |
| `rel_member_of` | IfcPersonAndOrganization (**a resource, not an IfcRel**, D-048) |
| `rel_associates_document` | IfcRelAssociatesDocument (IfcRelAssociates) |
| `rel_document_information_relationship` | IfcDocumentInformationRelationship (**a resource, not an IfcRel**, D-104); `role` = RelationshipType |
| `rel_associates_classification` | IfcRelAssociatesClassification (IfcRelAssociates) |
| `rel_external_reference_relationship` | IfcExternalReferenceRelationship (**a resource, not an IfcRel**, D-104): classification of a document; `to_id` -> `classification_references` |
| `rel_assigns_to_actor` | IfcRelAssignsToActor + IfcActorRole (IfcRelAssigns) |
| `rel_assigns_to_group` | IfcRelAssignsToGroup (IfcRelAssigns), systems, D-047 |
| `classification_systems` / `_references` | IfcClassification / IfcClassificationReference |
| `documents` (extension table) | IfcDocumentInformation (attributes 1:1, see below) |
| `object_type='document_reference'` (extension table `documents`) | IfcDocumentReference: a part of a document, e.g. a page (D-104) |
| `information_containers` / `container_revisions` | IfcDocumentInformation (container / one `Revision`) + from IfcOwnerHistory `OwningApplication`, `LastModifyingApplication`, `ChangeAction`, `State`; ISO 19650 status = IfcApproval (D-183, §2.19) |
| `ifc_actor` / `ifc_application` | IfcPersonAndOrganization / IfcApplication (D-183) |
| `object_type='capture'` (extension table `captures`) | ~IfcAnnotation (reality-capture point); anchoring in `_capture`, D-073 |
| `object_type='capture_media'` (extension table `capture_media`) | ~IfcDocumentInformation (shot/version), D-073 |
| `aim_rel_capture_located` | **aim_** (IFC has no concept; ~IfcRelContainedInSpatialStructure) -> ICDD linkset, D-073 |
| `aim_rel_capture_media` | **aim_** (IFC has no concept; ~IfcRelAggregates) -> ICDD linkset, D-073 |

**IFC-canonical relationship layer (D-048):** edges are named after the `IfcRelationship`
subtypes and have **the granularity IFC distinguishes** (that is why `rel_located_in` was split into
`rel_aggregates` + `rel_contained_in_spatial_structure`). Physically they are **binary edges +
our meta columns**, NOT objectified N-ary IFC entities; we take the identity and granularity,
not the serialization structure (an index over IFC semantics, not STEP in Postgres).

**Attribute alignment `documents` <-> `IfcDocumentInformation` (IFC4.3, D-046):**
`identification`, `description`, `location`, `purpose`, `revision`, `document_owner`,
`status`, `valid_from`, `valid_until` = IFC attributes directly (snake_case). The missing ones
(`intended_use`, `scope`, `editors`, `creation_time`, `last_revision_time`,
`electronic_format`, `confidentiality`) are added additively when needed. Align the `status`
values to `IfcDocumentStatusEnum` (DRAFT/FINAL/REVISION/NOTDEFINED).
Versions and hierarchy of documents in the future by `IsPointer`/`IsPointedTo`;
a reference to a part of a document by `HasDocumentReferences`.

**IFC-first naming (D-046):** a new attribute, edge or enum only after checking the IFC4.3
equivalent; if one exists, take the name and the enum literally.

**Declared extensions over IFC4.3 (D-046), the full list:**
- metadata on the edge: `valid_from`/`valid_until`/`source`/trust layers on `rel_*`
  (IFC relationships carry neither validity nor provenance of the link),
- `ifc_guid_history` + Master UUID (identity across versions of files),
- links across IFC files (federation; native only in IFC5),
- revisions of model files and BCF topics including edit tasks (`model_revisions`, `model_tasks`, D-086, D-099),
  topic links to documents and their revision (`model_task_documents`, `documents.file_sha256`,
  `document_pages.page_size`, D-158; BCF DocumentReference and IFC carry neither a file hash nor a page size).
At export IFC does not carry them -> ICDD linksets (D-015), in the future IFCX layer components.
ICDD export (D-181): only the AIM layer goes into linksets (a relationship in the IFC file stays in it): `els:IsElaboratedBy` (document and page
to an element from `pdf_link` / `doc_upload`), `els:IsIdenticalTo` (floors across models; an IFC document by `Identification` <-> PDF) and the declared extension `aim:IsReferencedInSpatialStructure` (subclass of `ls:DirectedBinaryLink`,
derived element -> IfcSpace / IfcSpatialZone) with the edge metadata `aim:source`, `aim:role`, `aim:derivationRule`,
`aim:basedOnRevision`, `aim:ifcRelationship` (the IFC relationship whose semantics the link carries), `aim:relationshipId` (`relationships.id`),
and on `ct:Linkset` the information tag `aim:exchange` (`export-only` | `import`, D-181 addendum "import"); the namespace `aim:` is a placeholder from `ICDD_AIM_NAMESPACE` (default `urn:x-aim:icdd#`).

---

## 6. Design decisions (summary)

- **R1** Central `objects` + type extension tables + typed FK edges (D-018).
- **R2** Classification in two levels, reference data (D-019).
- **R3** `object_ref` is not a classification code (D-010/2).
- **R4** Responsibilities from v1 through actors + `rel_assigns_to_actor` (D-020, refined in D-024).
- **R5** Lean nodes; a column is promoted by a migration only when needed.
- **R6** Type-occurrence: `rel_defines_by_type`, inheritance with override (D-021).
- **R7** `properties` = three layers, distinguished by the name prefix (D-022).
- **R8** Classification on the type and the occurrence; effective = union of facets (D-023).
- **R9** Actors: now **B** (person + organization + `rel_member_of`), **C** planned
  as an additive extension (D-024).

---

## 7. Planned (C, additive) and permanently out of scope

**Actors are now B (D-024).** The following is **planned as C**; it is added additively,
without refactoring anything from B, when the project or an import needs it:
- **Organization<->organization hierarchy**: the edge `rel_part_of_org` (IfcOrganizationRelationship, departments, subsidiaries)
- **Structured addresses**: tables for IfcPostalAddress / IfcTelecomAddress
- **Intrinsic roles** of a person or company as an entity (IfcPerson.Roles / IfcOrganization.Roles)

Until then **capture-don't-structure**: the ETL stores raw addresses and organization links into the
reserved keys (`_contact`, `_org`) in `properties`, so that the data from the source are not
lost. Promotion to structure (C) is later a clean migration.

**Planned additive, documents (D-032):**
- **`documents.storage_type`** `text` (`supabase | external | unresolved`): how to handle
  `location`. Added by **a new migration** (the existing one is not edited).
- Optionally later **`rel_supersedes`** (revisions of documents); for now implicitly through
  name + `valid_from`.

**Planned additive, coding scheme (D-033):** `object_ref` is assembled from the project's
coding scheme (field-source resolver: pset / attribute / classification + `extract`/`format`),
not from the IFC `Tag`. The scheme definition lives in the ETL / project config (`etl/scheme.py`), not
necessarily in the DB. A multi-project `project` entity + a per-project scheme = additive with the 2nd project.

**Permanently out of scope:** geometry in the DB / storing meshes / RepresentationMaps; Postgres does not
touch geometry even with the arrival of 3D rendering; IFClite (D-044) is an application client-side
layer, geometry stays ephemeral in the browser. `property_set_templates` (bSDD
validation): only with handover validation.

---

## 8. Implementation state and deviations (migration 20260616120000)

§2 is carried 1:1 into the migration `supabase/migrations/20260616120000_init_aim_schema.sql`.
Deliberate decisions in the implementation (agreed, see D-025):

- **RLS is NOT turned on.** SCHEMA.md does not specify it; policies are additive and are added
  together with auth and the frontend in the next chat. Until then the DB is not exposed through the public API.
- **Views: only the 4 explicitly named** (`v_asset_effective`, `v_asset_classifications`,
  `v_floors`, `v_actors`). `v_documents`/`v_assets`/`v_spaces` ("analogously" in §2.7)
  are added later as the Viewer needs them; they are purely additive.
- **Indexes exactly by §2.6.** `rel_associates_classification` has an index only on `from_id`
  (not `to_id`); kept by the schema, not an omission.
- **`updated_at` triggers** are on the 3 tables with this column: `objects`,
  `classification_systems`, `classification_references`. The extension tables (floors/documents/
  persons) and `ifc_guid_history` have no `updated_at` column -> no trigger.
- **A single migration file** (not a logical split): initial schema, the order
  respects the FK dependencies.

**Verification:** Docker is not available -> instead of `supabase db reset` verified on
a clean local PostgreSQL 17 through `psql` (`ON_ERROR_STOP=1`). Tested: applying
the whole migration, the deep-merge inheritance in `v_asset_effective`, the partial unique
`uniq_active_location` (a 2nd active location fails, an archived + a new one passes),
the `updated_at` trigger. At the first `supabase db reset` with Docker it must pass the same way.

---
*v0.5: §2 implemented (migration 20260616120000). **Relationship meta-model B implemented
(D-051, sprint F1, migration `20260707150000_relationships_metamodel.sql`):** the per-relationship
tables `rel_*` superseded by the generic `relationships` + the manifest `relationship_types` +
canonical views of the same name + a validation trigger (§2.5/§2.6). The read layer and the seed run
unchanged from the outside; the ETL writes the base table. **Deployed on Supabase prod** (`acwoupricatirhlfkhvk`,
2026-07-07): 4461 edges, migration history in sync with the 8 files in `supabase/migrations/`. Seed
done (`supabase/seed.sql`). Viewer S0-S5 deployed on Vercel. Further migrations come with F2
(geometric containment) or additive features (RLS, actor model C).*
