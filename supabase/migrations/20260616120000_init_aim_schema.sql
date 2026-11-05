-- =============================================================================
-- AIM Platform - initial schema (SCHEMA.md v0.4, §2)
-- =============================================================================
-- Scope: spatial hierarchy · assets · documents · responsibilities ·
--        type-occurrence · actors (level B)
-- Model: central `objects` + thin type extensions + plain FK edges.
-- Conventions: CLAUDE.md + DECISIONS.md (D-009 to D-024).
--
-- Statement order respects FK dependencies:
--   extension → functions → objects → extensions → classification →
--   ifc_guid_history → edges → indexes → views → triggers
--
-- Migrations are ADDITIVE - this file is never deleted or edited;
-- changes arrive as new migrations.
--
-- Implementation notes (deviations from SCHEMA.md §2 are recorded in SCHEMA.md):
--   * RLS is deliberately NOT enabled (to be added additively with auth/frontend).
--   * Only 4 explicitly named views are implemented; v_documents/
--     v_assets/v_spaces ("analogously") will come later as needed.
--   * object_type is TEXT validated in the app/ETL, NOT a CHECK constraint (D-018).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 2.0  Helpers: extensions + functions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Deep merge of psets: occurrence (b) overrides type (a) at the scalar level
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


-- -----------------------------------------------------------------------------
-- 2.1  Central node table (D-018)
-- -----------------------------------------------------------------------------
create table objects (
  id                uuid primary key default gen_random_uuid(),   -- Master UUID (D-010/1)
  object_type       text not null,     -- 'site','building','floor','space','asset','asset_type',
                                        -- 'document','person','organization'
  object_ref        text unique,       -- human-readable identity / QR (D-010/2)
  name              text,              -- IFC Name (attribute)
  ifc_guid          text,              -- IFC GlobalId - attribute only, nullable (D-010/3)
  ifc_type          text,              -- IFC entity: IfcPump, IfcPumpType, IfcSpace...
  predefined_type   text,              -- IFC PredefinedType enum; inherited type→occ
  user_defined_type text,              -- IFC ObjectType(occ)/ElementType(type) pri USERDEFINED
  properties        jsonb not null default '{}',   -- property sets + reserved _keys (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on objects (object_type);
create index on objects (ifc_guid);
create index on objects (predefined_type);


-- -----------------------------------------------------------------------------
-- 2.2  Type extensions (1:1 to `objects`)
-- -----------------------------------------------------------------------------
create table floors (
  id        uuid primary key references objects(id) on delete cascade,
  elevation numeric
);

create table documents (        -- IfcDocumentInformation (D-014); .Name lives in objects.name
  id              uuid primary key references objects(id) on delete cascade,
  identification  text, description text, location text, purpose text, revision text,
  document_owner  text,         -- temporary; later rel_responsible_for(role='owner')
  status          text,
  valid_from      timestamptz,  -- validity of the revision (≠ validity of the link)
  valid_until     timestamptz
);

create table persons (          -- IfcPerson (D-024); objects.name = display name
  id          uuid primary key references objects(id) on delete cascade,
  given_name  text,
  family_name text,
  email       text,
  phone       text
);
-- organization = plain objects row (name = company name)
-- structured addresses + org hierarchy = C (planned, §7)


-- -----------------------------------------------------------------------------
-- 2.3  Classification (D-011, D-019 - reference data)
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 2.4  History of IFC GUIDs (D-010)
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 2.5  Edges (D-009) - from_id → to_id, both FK to objects(id)
--      exception: rel_has_classification.to_id → classification_references(id)
-- -----------------------------------------------------------------------------

-- Spatial link (D-013). IFC: IfcRelAggregates + IfcRelContainedInSpatialStructure
create table rel_located_in (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references objects(id) on delete restrict,
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Type-occurrence (D-021). IFC: IfcRelDefinesByType. 1:N
create table rel_defined_by_type (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,    -- occurrence
  to_id   uuid not null references objects(id) on delete restrict,   -- type
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Person in organization (D-024). IFC: IfcPersonAndOrganization
create table rel_member_of (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,    -- person
  to_id   uuid not null references objects(id) on delete restrict,   -- organization
  role    text,              -- role within the company (IfcPersonAndOrganization.Roles)
  valid_from timestamptz not null default now(),   -- period of employment
  valid_until timestamptz, source text
);

-- Document (D-014)
create table rel_has_document (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references objects(id) on delete restrict,
  role text,                 -- 'manual','certificate','as-built'...
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Classification (D-011, D-023). Target = reference table. Type and occurrence
create table rel_has_classification (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete cascade,
  to_id   uuid not null references classification_references(id) on delete restrict,
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);

-- Responsibilities (D-020). IFC: IfcRelAssignsToActor + IfcActorRole
-- from_id = person OR organization
create table rel_responsible_for (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references objects(id) on delete restrict,   -- actor (person|organization)
  to_id   uuid not null references objects(id) on delete cascade,    -- object
  role text not null,        -- acting role: 'owner','operator','maintainer','manufacturer'...
  valid_from timestamptz not null default now(), valid_until timestamptz, source text
);


-- -----------------------------------------------------------------------------
-- 2.6  Indexes + edge integrity
-- -----------------------------------------------------------------------------
create index on rel_located_in (from_id);          create index on rel_located_in (to_id);
create index on rel_defined_by_type (from_id);     create index on rel_defined_by_type (to_id);
create index on rel_member_of (from_id);           create index on rel_member_of (to_id);
create index on rel_has_document (from_id);         create index on rel_has_document (to_id);
create index on rel_has_classification (from_id);
create index on rel_responsible_for (from_id);      create index on rel_responsible_for (to_id);

create unique index uniq_active_location on rel_located_in     (from_id) where valid_until is null;
create unique index uniq_active_type     on rel_defined_by_type(from_id) where valid_until is null;


-- -----------------------------------------------------------------------------
-- 2.7  Views (Viewer / LLM)
-- -----------------------------------------------------------------------------

-- Effective asset: inheritance type→occurrence (occurrence overrides)
create view v_asset_effective as
  select occ.id, occ.object_ref, occ.name, occ.ifc_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.predefined_type else occ.predefined_type end   as predefined_type,
    case when typ.predefined_type is not null and typ.predefined_type <> 'NOTDEFINED'
         then typ.user_defined_type else occ.user_defined_type end as user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties)              as properties,
    typ.id as type_id, typ.name as type_name
  from objects occ
  left join rel_defined_by_type r on r.from_id = occ.id and r.valid_until is null
  left join objects typ on typ.id = r.to_id
  where occ.object_type = 'asset';

-- Effective classification: UNION of own + inherited from type (D-023)
create view v_asset_classifications as
  select occ.id as object_id, rc.to_id as classification_ref_id, 'occurrence' as level
  from objects occ
  join rel_has_classification rc on rc.from_id = occ.id and rc.valid_until is null
  where occ.object_type = 'asset'
  union
  select occ.id, rc.to_id, 'type'
  from objects occ
  join rel_defined_by_type dt on dt.from_id = occ.id and dt.valid_until is null
  join rel_has_classification rc on rc.from_id = dt.to_id and rc.valid_until is null
  where occ.object_type = 'asset';

create view v_floors as select o.*, f.elevation from objects o join floors f using (id);
create view v_actors as select * from objects where object_type in ('person','organization');
-- v_documents, v_assets, v_spaces... analogously (to be added later as needed)


-- -----------------------------------------------------------------------------
-- 2.8  `updated_at` triggers (tables with an updated_at column)
-- -----------------------------------------------------------------------------
create trigger trg_objects_updated before update on objects
  for each row execute function set_updated_at();
create trigger trg_classification_systems_updated before update on classification_systems
  for each row execute function set_updated_at();
create trigger trg_classification_references_updated before update on classification_references
  for each row execute function set_updated_at();
