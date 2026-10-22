# SCHEMA.md — AIM Platform (v0.4 — IMPLEMENTOVANÁ)

> Scope: **priestorová hierarchia · assets · dokumenty · zodpovednosti · type–occurrence · aktori (B)**
> Model: centrálna `objects` + tenké typové prípony + čisté FK hrany.
> Konvencie: `AGENTS.md` + `DECISIONS.md` (D-009–D-025).
>
> **Stav:** §2 implementovaná ako iniciálna migrácia
> `supabase/migrations/20260616120000_init_aim_schema.sql` (D-025).
> Odchýlky implementácie vs. text §2 → viď §8.

---

## 1. Prehľad

```
objects  ──┐  (jeden uzlový priestor, Master UUID = kotva)
           ├─ floors    (elevation)
           ├─ documents (IfcDocumentInformation polia; aj IfcDocumentReference, D-104)
           └─ persons   (meno, kontakt)   ── organization = objects riadok

HRANY (objects → objects, čisté FK) — IFC-kanonické (D-048):
  rel_aggregates                      Site→Building→Floor→Space  (IfcRelAggregates)
  rel_contained_in_spatial_structure  asset → priestor/podlažie  (IfcRelContainedInSpatialStructure)
  rel_defines_by_type                 occurrence → type          (IfcRelDefinesByType)
  rel_member_of                       person → organization      (IfcPersonAndOrganization)
  rel_associates_document             objekt → dokument          (IfcRelAssociatesDocument)
  rel_document_information_relationship  časť → nadradený dokument (IfcDocumentInformationRelationship, D-104)
  rel_assigns_to_actor                person|organization → objekt  (role, platnosť = handover)
  rel_assigns_to_group                element → system           (IfcRelAssignsToGroup, D-047)

KLASIFIKÁCIA (referenčné dáta):
  classification_systems ◄─ classification_references
  rel_associates_classification  objekt(type aj occurrence) → reference
  rel_external_reference_relationship  dokument → reference (typ informácie ISO 19650, D-104)
```

---

## 2. SQL DDL

### 2.0 Pomocné

```sql
create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Hĺbkový merge psetov: occurrence (b) prepíše type (a) na úrovni skalárov
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

### 2.1 Centrálna tabuľka uzlov

```sql
create table objects (
  id                uuid primary key default gen_random_uuid(),   -- Master UUID (D-010/1)
  object_type       text not null,     -- 'site','building','floor','space','asset','asset_type',
                                        -- 'document','person','organization','system' (D-047),
                                        -- 'capture','capture_media' (D-073),
                                        -- 'project','zone','spatial_zone','group' (D-088),
                                        -- 'document_reference' (IfcDocumentReference, D-104)
  object_ref        text unique,       -- ľudsky čitateľná identita / QR (D-010/2)
  name              text,              -- IFC Name (atribút)
  ifc_guid          text,              -- IFC GlobalId — len atribút, nullable (D-010/3)
  ifc_type          text,              -- IFC entita: IfcPump, IfcPumpType, IfcSpace…
  predefined_type   text,              -- IFC PredefinedType enum; dedí sa type→occ
  user_defined_type text,              -- IFC ObjectType(occ)/ElementType(type) pri USERDEFINED
  properties        jsonb not null default '{}',   -- property sety + rezervované _kľúče (§4)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on objects (object_type);
create index on objects (ifc_guid);
create index on objects (predefined_type);
```

**Dodatok (D-059, migrácia 20260712120000):** `objects` má navyše STORED generated
stĺpec `search_text` = `f_object_search_text(name, object_ref, ifc_type,
predefined_type, user_defined_type, properties)` — normalizovaný (unaccent + lower)
flattening identity a všetkých psetov (rezervované `_kľúče` vynechané) pre fulltext.
Indexy a RPC → §2.9.

**Dodatok (D-088, migrácia 20261018130000):** `objects.valid_until timestamptz` = kedy objekt
zanikol (už ho nevydáva žiadny model federácie; NULL = platný). Riadok ostáva (D-010). Views
`v_actors`, `v_asset_classifications`, `v_asset_effective`, `v_floors`, `v_property_dictionary`,
`v_spaces` a RPC `search_everything`, `aggregate_objects`, `search_documents` filtrujú
`valid_until is null`; zoznamy a vyhľadávanie v appke tiež (AGENTS). Index
`idx_objects_retired` (len zaniknuté).

### 2.2 Typové prípony (1:1 k `objects`)

```sql
create table floors (
  id        uuid primary key references objects(id) on delete cascade,
  elevation numeric
);

create table documents (        -- IfcDocumentInformation (D-014); .Name žije v objects.name
  id              uuid primary key references objects(id) on delete cascade,
  identification  text, description text, location text, purpose text, revision text,
  document_owner  text,         -- dočasné; neskôr rel_assigns_to_actor(role='owner')
  status          text,
  valid_from      timestamptz,  -- platnosť revízie (≠ platnosť väzby)
  valid_until     timestamptz
);
-- + storage_type (D-032, migrácia 20260620120000): supabase | external | unresolved
-- + D-104 (migrácia 20261019160000), IFC atribúty doslovne:
--   creation_time timestamptz, last_revision_time timestamptz, electronic_format text,
--   referenced_document_id uuid → objects (IfcDocumentReference.ReferencedDocument;
--   len pri object_type='document_reference', riadok nesie Location/Identification/
--   Description odkazu, objects.name = Name, inak Description)

create table persons (          -- IfcPerson (D-024); objects.name = zobrazované meno
  id          uuid primary key references objects(id) on delete cascade,
  given_name  text,
  family_name text,
  email       text,
  phone       text
);
-- organization = obyčajný objects riadok (name = názov firmy)
-- štruktúrované adresy + org-hierarchia = C (plánované, §7)
```

**Dodatok (D-073, migrácia 20260716120000) — Reality Capture prípony.** Model „ako
dokumenty": capture point = `objects` riadok `object_type='capture'` (ukotvenie 2D/3D
v rezervovanom `properties._capture`, §4), jednotlivá snímka/verzia = `objects` riadok
`object_type='capture_media'` (analóg `documents`). Verzovanie lokácie v čase = viac
`capture_media` na capture point, append-only (`valid_until IS NULL` = aktuálna).

```sql
create table captures (        -- capture point (registrácia lokácie)
  id   uuid primary key references objects(id) on delete cascade,
  kind text not null           -- 'photo' | 'pano360'
);

create table capture_media (   -- jedna snímka/verzia (analóg IfcDocumentInformation)
  id               uuid primary key references objects(id) on delete cascade,
  location         text,       -- verejná URL originálu (Supabase Storage bucket `captures`)
  preview_location text,       -- zmenšený náhľad (360 downscale pod GPU limit / foto preview)
  thumb_location   text,       -- thumbnail (galéria / pin)
  storage_type     text not null default 'supabase',   -- ako documents.storage_type (D-032)
  media_type       text, width int, height int,
  captured_at      timestamptz,                          -- dátum snímania → poradie verzií
  valid_from       timestamptz not null default now(),
  valid_until      timestamptz                           -- NULL = aktuálna (append-only)
);
```

### 2.3 Klasifikácia (D-011, D-019 — referenčné dáta)

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
  identification  text not null,              -- 'Pr_60_50_10' (produkt) / 'Ss_…' (systém)
  name            text, location text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (system_id, identification)
);
```

### 2.4 História IFC GUIDov (D-010)

```sql
create table ifc_guid_history (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,          -- NULL = aktuálny
  source      text,
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid on ifc_guid_history (object_id) where valid_until is null;
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
-- … analogicky rel_contained_in_spatial_structure / rel_defines_by_type /
--   rel_associates_classification / rel_assigns_to_group (bez role) a
--   rel_associates_document / rel_assigns_to_actor / rel_member_of (s role).
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

### 2.7 Pohľady (Viewer / LLM)

**Dodatok D-080 (migrácia 20261016130000):** `v_space_elements` = obsah priestoru —
`rel_contained_in_spatial_structure` do `space` (relation `contained`, natívne zo súboru)
∪ `rel_referenced_in_spatial_structure` do `space` (relation `referenced`, odvodené
geometriou, `role` inside|partial). Stĺpce: space_id/ref/name/long_name, element_id/ref/name,
element_ifc_type, element_predefined_type, relation, role, source. Len aktívne hrany.

**Dodatok D-156 (migrácia 20261022180000):** `rel_space_boundary` (`IfcRelSpaceBoundary`, prvok -> priestor,
`role` physical|virtual|notdefined, jedna hrana na pár, plní ETL) a tretia vetva `v_space_elements` s
`relation = 'boundary'`, len keď pre ten pár nie je aktívny `contained` ani `referenced`.

```sql
-- Effective asset: dedičnosť type→occurrence (occurrence prepíše)
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

-- Effective klasifikácia: UNION vlastných + zdedených z type (D-023)
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
-- v_documents, v_assets, v_spaces… analogicky

-- Slovník psetov z reálnych dát (D-058) — grounding pre LLM: ktoré psety × property
-- existujú (štandardné AJ custom), typ hodnoty, počty, vzorky, min/max numeriky.
-- Rezervované _kľúče (D-022) vynechané. Presné DDL: migrácia 20260711120000.
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

### 2.8 Triggery `updated_at`

```sql
create trigger trg_objects_updated before update on objects
  for each row execute function set_updated_at();
-- + classification_systems, classification_references
```

### 2.9 Fulltext vyhľadávanie (D-059, migrácia 20260712120000)

Parita s človekom skenujúcim panel vlastností — kľúčové slovo sa nájde kdekoľvek
v obsahu uzla vrátane custom psetov. Presné DDL v migrácii.

```sql
create extension if not exists unaccent;   -- + pg_trgm
create function f_unaccent(text) …          -- IMMUTABLE wrapper (indexovateľné)
create function f_object_search_text(…) …   -- IMMUTABLE flattening uzla (bez _kľúčov)
-- objects.search_text = generated stored stĺpec (viď §2.1 dodatok)
create index idx_objects_search_tsv  on objects using gin (to_tsvector('simple', search_text));
create index idx_objects_search_trgm on objects using gin (search_text gin_trgm_ops);

-- RPC pre LLM tool (parametrizované, row-cap 50):
-- search_everything(q, object_types[], max_rows) → id, object_type, object_ref, name,
--   ifc_type, predefined_type, score, match_kind (fulltext|fuzzy), headline,
--   matched_properties (dôkaz: pset/property/hodnota so zásahom)
```

### 2.10 Agregácie nad psetmi (D-060, migrácia 20260713120000)

PostgREST filter nad JSONB cestou porovnáva gt/lt ako **text** a agregovať nevie —
súčty/priemery/číselné porovnania hodnôt psetov robí RPC `aggregate_objects`
(read-only, `stable`, `set search_path`; interné whitelisty relation/agg/op/stĺpcov,
identifikátory `format('%I')`, literály `format('%L')` — presné DDL v migrácii).

```sql
-- aggregate_objects(relation objects|v_asset_effective, agg count|sum|avg|min|max,
--   prop_path text[],                -- numerická hodnota psetu (guarded cast,
--                                    --  nenumerické → skipped_non_numeric)
--   group_by | group_by_path,        -- stĺpec z whitelistu / pset cesta ako kľúč
--   filters jsonb,                   -- AND; {column|path, op, value};
--                                    --  gt/gte/lt/lte nad path = NUMERICKY
--   ids uuid[],                      -- reťazenie (napr. z locate_objects)
--   max_groups ≤ 50, return_rows)    -- rows režim: top 50 riadkov s hodnotou
```

### 2.11a Obsah dokumentov (D-063, migrácia 20260715120000)

Extrahovaný text PDF strán (`etl/pdf_text.py`, PyMuPDF) — fulltext nad obsahom
dokumentov. OCR mimo scope; vektorové výkresy majú riedky text (očakávané).

```sql
create table document_pages (
  document_id uuid not null references objects(id) on delete cascade,
  page        int  not null check (page >= 1),
  text        text not null,
  primary key (document_id, page)
);
create index idx_document_pages_tsv on document_pages
  using gin (to_tsvector('simple', lower(f_unaccent(text))));

-- RPC pre LLM tool: search_documents(q, max_rows, doc_id) → document_id, document_ref,
--   document_name, page, rank, snippet (ts_headline); slová dopytu ako prefixy (D-123)

-- D-123 (migrácia 20261020160000): riadky textu strany s polohou
alter table document_pages add column blocks jsonb;  -- [{t, x, y, w, h}] v % strany, vľavo hore

-- D-133 (migrácia 20261021120000): hrubé čiary výkresu pre kalibráciu podkladu
alter table document_pages add column lines jsonb;   -- {size: [W, H], segs: [[x1, y1, x2, y2, w]]} v bodoch strany, vľavo dole;
                                                     -- čiary od 0,99 pt, len vektorové výkresy, inak null
```

Plní `python -m etl.pdf_text --from-db` (živé dokumenty, PDF zo storage, D-123) alebo
manifestový beh. Dokumenty z IFC (D-104) sú len v `--from-db`.

### 2.11 Statický IFC slovník psetov (D-061, migrácia 20260714120000)

Referenčné dáta (vzor `relationship_types`): definície štandardných psetov z bSDD/psd
šablón IFC4X3, generované `python -m etl.pset_manifest --sql` — LEN triedy projektu.
Význam/typ/enum properties (grounding LLM); skutočný výskyt v dátach → `v_property_dictionary` (§2.7).

```sql
create table ifc_property_definitions (
  pset                text not null,      -- 'Pset_DoorCommon'
  property            text not null,      -- 'FireRating'
  data_type           text,               -- PrimaryMeasureType (IfcLabel, IfcAreaMeasure…)
  template_type       text,               -- P_SINGLEVALUE | P_ENUMERATEDVALUE | Q_*…
  enum_values         text[] not null default array[]::text[],
  description         text,               -- orezané na 200 znakov
  applicable_classes  text[] not null,    -- triedy projektu
  primary key (pset, property)
);
```

---


### 2.12 Práva rolí (D-079, migrácia 20261016120000)

RLS je vypnuté (D-025) a všetko čítanie ide cez `service_role` (D-026). Rolám `anon` a
`authenticated` sú v schéme `public` **odobraté všetky práva** (tabuľky, views, sekvencie,
funkcie) aj v default privileges pre objekty vytvorené rolou `postgres`. Dôvod: anon kľúč
je v prehliadači kvôli Realtime Broadcast (živý kanál, D-079) a bez odobratia by cez
PostgREST otváral celú DB. `service_role` má explicitný `grant all` / `grant execute`.
Nová tabuľka alebo RPC teda **nie je** dostupná anon kľúču — ak to raz treba (auth + RLS),
grant je vedomý krok v migrácii.


### 2.13 Výsledky kontroly voči IDS (D-081, migrácia 20261017120000)

**Deklarovaná extenzia** (IFC na výsledok kontroly koncept nemá; BCF je výmenný formát
nálezov, nie úložisko). `ids_runs` = jeden beh `etl.ids_check` (IDS title/version, SHA-256
súboru, pôvod v knižnici požiadaviek, model federácie, počty). `ids_results` = špecifikácia ×
prvok: `spec_identifier` (= ID poznámky v knižnici, napr. `IU-O-space`), `status`
`pass|fail`, `reasons text[]` (texty ifctesteru), `object_id` cez aktívny GUID (null = prvok
nie je v DB), `ifc_guid` null = výsledok celej povinnej špecifikácie bez vyhovujúceho prvku.
Pohľady: `v_ids_latest` (posledný beh každej dvojice IDS × model, s object_ref/menom),
`v_ids_summary` (po špecifikáciách: elements, passed, failed, example_reason).

### 2.14 Revízie IFC modelov a úlohy úprav (D-086, migrácia 20261018120000)

**Deklarovaná extenzia** (IFC verzie súboru nenesie; BCF nesie tému úlohy, nie úložisko).
`model_revisions` = jedna zverejnená verzia IFC súboru modelu federácie (`model` = kľúč
`ifc/<model>.ifc`, `revision` = vNNN, `parent_revision` = základ, `sha256`/`size_bytes`
nekomprimovaného súboru, `archive_path` = nemenná kópia `ifc/archive/<model>/vNNN.ifc.gz`,
`recipe_ref` = recept v repe OCB, `guard` = výsledok technickej poistky). Práve jedna
`is_current` na model (`uniq_current_model_revision`). Zapisuje len `etl/model_publish.py`
pod advisory lockom modelu (compare-and-swap voči základu úlohy). `model_tasks` = úloha
úpravy v tvare BCF témy (`title`, `description`, `components` = IFC GlobalId výberu,
`viewpoint`, `status` `open|in_progress|resolved|conflict|failed`, `base_revision`,
`result_revision`, `run_url`, `comments`). Práva anon/authenticated nemajú (2.12).

**BCF témy (D-099, migrácia 20261019120000):** `model_tasks` nesie všetky BCF témy nad
modelmi federácie (kolízia, pripomienka, úprava modelu), nielen úlohy úprav. Pribudli polia
podľa BCF API 2.1 topic: `number` (identity, BCF `index`, "téma #N"), `topic_type`
(predvolene `Issue`), `priority`, `assigned_to` (`claude` = téma pre Claude, spustí session),
`due_date`, `labels text[]`, `stage`, `modified_by`, `session_url` (Claude session, ktorá tému
rieši). `model` môže byť NULL (téma nad celou federáciou). `status` pribudol o `closed`
(uzavretá bez revízie). `viewpoint` = pohľad z viewera (`camera` v IFC svete, `section`,
`mode`, `storey_guid`, počet a orezanie výberu), `components` = IFC GlobalId prvkov témy
(BCF selection; výber z viewera alebo zadané prvky). `comments`
= BCF komentáre `[{guid, author, date, comment}]`; pripája ich funkcia
`model_task_add_comment(task, author, comment)` atomicky (vráti komentár, NULL = téma nie je). Právo na funkciu má len `service_role` (migrácia 20261019120100, 2.12).
Mapovanie na BCF: `id` = topic guid, `status` = topic_status (lowercase, `in_progress` =
"In Progress"), `author` = creation_author, `created_at`/`updated_at` = creation/modified_date.

**Zdroj ETL podľa modelu (D-086):** load s `--model ASR` zapisuje hrany so zdrojom
`etl:ASR` a GUID históriu so zdrojom `IFC import:ASR`; čo beh nevydal, uzavrie
(`valid_until`). Staré zdroje `etl` / `IFC import` (pred D-086) uzavrie jednorazovo
`model_publish close-legacy` po prvom loade všetkých modelov. Objekt bez aktívneho GUID
dostane `objects.valid_until` (D-088), riadok ostáva (D-010).

### 2.15 Register pravidiel odvodení (D-089, migrácia 20261018140000)

`derivation_rules` = pravidlo odvodeného vzťahu (`id`, `name`, `kind` `geometry|via_space`,
`rel_type`, `source` = zdroj hrán v `relationships`, `source_classes`, `target_classes`, `roles`,
`enabled`, `mode` `auto|manual`). `derivation_runs` = jeden beh pravidla (`status`
`ok|dry_run|disabled|error`, `trigger`, `models` = revízie z `model_revisions`, `written`,
`closed`, `unresolved`, `details`). Pravidlá na štarte: `element_in_space`
(`derive:spatial_reference`, D-080), `element_in_spatial_zone` (`derive:element_in_spatial_zone`)
a `element_in_zone` (bez hrán: IFC na prvok v IfcZone vzťah nemá). Pohľad **`v_zone_elements`**
= prvok v IfcZone cez priestory (prvok v priestore natívne alebo referenciou, priestor člen zóny
priamo alebo cez vnorenú zónu); prázdny, keď je `element_in_zone` vypnuté.

**`v_object_documents`** (D-104 krok 2, migrácia 20261020090000) = dokumenty objektu cez vzťahy:
`object_id`, `object_type`, `object_ref`, `document_id` (pri odkaze na časť jeho dokument),
`reference_id`, `page`, `via` (`direct|type|zone|group|system|spatial_zone`), `via_id` (nositeľ
dokumentu), `via_nearest_id` (najbližší nositeľ k objektu), `via_space_id`, `depth`, `path`, `role`,
`source`. Ide od nositeľov (`rel_associates_document`) nadol cez `rel_assigns_to_group`,
`rel_aggregates` (skupina, priestorová zóna), `rel_defines_by_type`, `rel_referenced_in_spatial_structure`
(priestorová zóna) a `v_zone_elements`, a prvok (asset) aj z podlažia a miestnosti, v ktorých je
(`rel_contained_in_spatial_structure`, `rel_referenced_in_spatial_structure`; dodatok migrácia
20261020120000). Miestnosť ani priestorová zóna od podlažia nededia; projekt, budova a pozemok sa
nededia; väzby E4 (`pdf_link (E4)`) vynecháva. `via` je aj `floor` a `space`.

### 2.16 Log volaní MCP konektora (D-100, migrácia 20261019140000)

`mcp_call_log` = jedno volanie toolu konektora: `tool`, `action` (`args.action`, ak ju tool má),
`ms` (celé volanie na serveri), `ok`, `cold` (prvé volanie inštancie funkcie), `phases` (jsonb, ms
po fázach `exec`, `broadcast`, `lens`, `readback`, `engine_load`), `region` (`VERCEL_REGION`).
Argumenty sa neukladajú. Zapisuje `/api/mcp/<token>` po odoslaní odpovede; slúži na p50/p95
latencie (`eval/MCP-EVAL.md`).

### 2.17 Uložené pohľady viewera (D-122, migrácia 20261020170000)

**Deklarovaná extenzia** (IFC pohľady nenesie; BCF viewpoint patrí téme). `saved_views` = pohľad
viewera spoločný pre stavbu: `name` (jedinečné bez ohľadu na veľkosť písmen medzi `kind = 'saved'`),
`description`, `viewpoint` (tvar ako `model_tasks.viewpoint`: `camera` v IFC svete s `projection` a
`ortho_size`, `section` s osou hosta a `coordinate`, `mode`, `storey_guid`, `storey_label`, počty
výberu, skrytých a izolovaných), `selection`, `hidden` (IFC GlobalId, strop 600), `isolated`
(GlobalId, NULL = bez izolácie), `model_revisions` (`{model: revízia}` v čase uloženia, D-086),
`author`, `created_at`, `updated_at`, `last_used_at`. Od D-132 (bez migrácie, len tvar jsonb) nesie `viewpoint`
aj `view_type` (3d | plan | section | detail), `locked` (kamera zamknutá kolmo), `section.box` (rezný box
`{min, max}` v IFC svete namiesto roviny) a `underlay` (`{document_id, page}`, kalibrácia ostáva v `_georef`
dokumentu). Jediný riadok `kind = 'last'` = "Posledný
pohľad", prepíše ho každé uloženie a obnova (`uniq_saved_views_last`). Zapisuje MCP konektor
(`saved_view`, `set_view_mode(saved_view)`). Práva anon/authenticated nemá (2.12).

## 4. Konvencia `properties` (D-022)

`properties` JSONB obsahuje **property sety**, vnorené podľa názvu. IFC **atribúty**
sem NEPATRIA (sú stĺpce).

| Vrstva | Kde | Rozlíšenie |
|---|---|---|
| 1 — IFC atribúty | stĺpce na `objects` | pevný zoznam zo schémy |
| 2 — štandardné psety | `properties[<názov>]` | názov `Pset_` / `Qto_` |
| 3 — custom psety | `properties[<názov>]` | čokoľvek iné (bez `Pset_`/`Qto_`) |

**Rezervované `_kľúče`:** názvy začínajúce `_` nie sú psety, ale meta/zachytené dáta.
Psety nikdy nezačínajú `_`. Aktuálne používané (deklarované extenzie, D-046):
`_contact`, `_org` (capture-don't-structure — §7), `_drawing_links` (klikateľné
regióny výkresov, D-042, zapisuje `etl/pdf_link.py`), `_georef` (georeferencia
PDF podkladu na podlažie, D-072, zapisuje `PATCH /api/underlay`), `_capture`
(ukotvenie reality-capture bodu — `plan`{documentId,page,u,v} + `world`{x,y,z} +
`yaw`, versioned; D-073, zapisuje `POST /api/captures`, len na `object_type='capture'`),
`_model` (model federácie, ktorý dokument vydal; ETL ukončí dokumenty modelu, ktoré už
nevydáva, D-104) a `_ifc_location` (pôvodná `Location` zo súboru, keď `documents.location`
ukazuje na súbor v buckete `documents`, D-104) - oba len na `document`/`document_reference`.

---

## 5. Mapovanie názvov ↔ IFC (D-009, D-012)

Schéma je IFC-aligned, nie priama implementácia (Postgres lowercasuje identifikátory;
CamelCase by vyžadoval úvodzovky a škodil LLM text-to-SQL). IFC väzba cez
`ifc_type`/`ifc_guid` a export.

| Náš objekt / hrana | IFC |
|---|---|
| `objects` (occurrence) | IfcObject (IfcProduct…) |
| `object_type='asset_type'` | IfcTypeObject / IfcElementType |
| `object_type='person'` / `'organization'` | IfcPerson / IfcOrganization |
| `object_type='system'` | IfcDistributionSystem (predefined_type = IfcDistributionSystemEnum), D-047 |
| `rel_aggregates` | IfcRelAggregates (IfcRelDecomposes) |
| `rel_contained_in_spatial_structure` | IfcRelContainedInSpatialStructure (IfcRelConnects) |
| `rel_defines_by_type` | IfcRelDefinesByType (IfcRelDefines) |
| `rel_member_of` | IfcPersonAndOrganization (**resource, nie IfcRel** — D-048) |
| `rel_associates_document` | IfcRelAssociatesDocument (IfcRelAssociates) |
| `rel_document_information_relationship` | IfcDocumentInformationRelationship (**resource, nie IfcRel**, D-104); `role` = RelationshipType |
| `rel_associates_classification` | IfcRelAssociatesClassification (IfcRelAssociates) |
| `rel_external_reference_relationship` | IfcExternalReferenceRelationship (**resource, nie IfcRel**, D-104): klasifikácia dokumentu; `to_id` → `classification_references` |
| `rel_assigns_to_actor` | IfcRelAssignsToActor + IfcActorRole (IfcRelAssigns) |
| `rel_assigns_to_group` | IfcRelAssignsToGroup (IfcRelAssigns) — systémy, D-047 |
| `classification_systems` / `_references` | IfcClassification / IfcClassificationReference |
| `documents` (prípona) | IfcDocumentInformation (atribútovo 1:1, viď nižšie) |
| `object_type='document_reference'` (prípona `documents`) | IfcDocumentReference: časť dokumentu, napr. strana (D-104) |
| `object_type='capture'` (prípona `captures`) | ~IfcAnnotation (reality-capture bod); ukotvenie v `_capture`, D-073 |
| `object_type='capture_media'` (prípona `capture_media`) | ~IfcDocumentInformation (snímka/verzia), D-073 |
| `aim_rel_capture_located` | **aim_** (IFC nemá koncept; ~IfcRelContainedInSpatialStructure) → ICDD linkset, D-073 |
| `aim_rel_capture_media` | **aim_** (IFC nemá koncept; ~IfcRelAggregates) → ICDD linkset, D-073 |

**IFC-kanonická vrstva vzťahov (D-048):** hrany sú pomenované podľa `IfcRelationship`
podtypov a majú **granularitu akú rozlišuje IFC** (preto `rel_located_in` rozseknuté na
`rel_aggregates` + `rel_contained_in_spatial_structure`). Fyzicky sú to **binárne hrany +
naše meta stĺpce**, NIE objektifikované N-árne IFC entity — preberáme identitu/granularitu,
nie serializačnú štruktúru (index nad IFC sémantikou, nie STEP v Postgrese).

**Atribútové zarovnanie `documents` ↔ `IfcDocumentInformation` (IFC4.3, D-046):**
`identification`, `description`, `location`, `purpose`, `revision`, `document_owner`,
`status`, `valid_from`, `valid_until` = priamo IFC atribúty (snake_case). Chýbajúce
(`intended_use`, `scope`, `editors`, `creation_time`, `last_revision_time`,
`electronic_format`, `confidentiality`) sa pridajú aditívne, keď budú treba. `status`
hodnoty zarovnať na `IfcDocumentStatusEnum` (DRAFT/FINAL/REVISION/NOTDEFINED).
Verzie/hierarchia dokumentov v budúcnosti podľa `IsPointer`/`IsPointedTo`;
odkaz na časť dokumentu podľa `HasDocumentReferences`.

**IFC-first naming (D-046):** nový atribút/hrana/enum až po kontrole IFC4.3
ekvivalentu — ak existuje, prevziať názov aj enum doslovne.

**Deklarované extenzie nad IFC4.3 (D-046) — úplný zoznam:**
- metadáta na hrane: `valid_from`/`valid_until`/`source`/dôverové vrstvy na `rel_*`
  (IFC vzťahy nenesú platnosť ani provenance väzby),
- `ifc_guid_history` + Master UUID (identita naprieč verziami súborov),
- väzby naprieč IFC súbormi (federácia — natívne až IFC5),
- revízie súborov modelu a BCF témy vrátane úloh úprav (`model_revisions`, `model_tasks`, D-086, D-099).
Pri exporte ich IFC nenesie → ICDD linksety (D-015), do budúcna IFCX layer komponenty.

---

## 6. Návrhové rozhodnutia (zhrnutie)

- **R1** Centrálna `objects` + typové prípony + typované FK hrany (D-018).
- **R2** Klasifikácia dvojúrovňová, referenčné dáta (D-019).
- **R3** `object_ref` ≠ klasifikačný kód (D-010/2).
- **R4** Zodpovednosti od v1 cez aktorov + `rel_assigns_to_actor` (D-020, spresnené D-024).
- **R5** Štíhle uzly; stĺpec sa povýši migráciou až keď treba.
- **R6** Type–occurrence: `rel_defines_by_type`, dedičnosť s prepisom (D-021).
- **R7** `properties` = tri vrstvy, rozlíšené prefixom názvu (D-022).
- **R8** Klasifikácia na type aj occurrence; efektívna = union faset (D-023).
- **R9** Aktori: teraz **B** (person + organization + `rel_member_of`), **C** plánované
  ako aditívne rozšírenie (D-024).

---

## 7. Plánované (C — aditívne) a trvalo mimo scope

**Aktori sú teraz B (D-024).** Nasledovné je **plánované ako C** — pridá sa aditívne,
bez refaktoru čohokoľvek z B, keď to projekt/import bude potrebovať:
- **Org↔org hierarchia** — hrana `rel_part_of_org` (IfcOrganizationRelationship, oddelenia/dcéry)
- **Štruktúrované adresy** — tabuľky pre IfcPostalAddress / IfcTelecomAddress
- **Intrinsic roly** osoby/firmy ako entita (IfcPerson.Roles / IfcOrganization.Roles)

Dovtedy **capture-don't-structure**: ETL uloží surové adresy/org-väzby do
rezervovaných kľúčov (`_contact`, `_org`) v `properties`, nech sa dáta zo zdroja
nestratia. Povýšenie na štruktúru (C) je neskôr čistá migrácia.

**Plánované aditívne — dokumenty (D-032):**
- **`documents.storage_type`** `text` (`supabase | external | unresolved`) — ako narábať
  s `location`. Pridá sa **novou migráciou** (existujúca sa needituje).
- Voliteľne neskôr **`rel_supersedes`** (revízie dokumentov) — zatiaľ implicitne cez
  name + `valid_from`.

**Plánované aditívne — coding scheme (D-033):** `object_ref` sa skladá z projektovej
kódovacej schémy (field-source resolver: pset / atribút / klasifikácia + `extract`/`format`),
nie z IFC `Tag`. Definícia schémy žije v ETL/projektovom configu (`etl/scheme.py`), nie
nutne v DB. Multi-projekt `project` entita + per-projekt schéma = aditívne pri 2. projekte.

**Trvalo mimo scope:** geometria v DB / mesh ukladanie / RepresentationMaps — Postgres sa
geometrie nedotýka ani s príchodom 3D renderingu; IFClite (D-044) je aplikačná klient-side
vrstva, geometria zostáva ephemerálna v prehliadači. `property_set_templates` (bSDD
validácia) — až pri validácii handoveru.

---

## 8. Implementačný stav a odchýlky (migrácia 20260616120000)

§2 je 1:1 prenesená do migrácie `supabase/migrations/20260616120000_init_aim_schema.sql`.
Vedomé rozhodnutia pri implementácii (odsúhlasené, viď D-025):

- **RLS sa NEzapína.** SCHEMA.md ho nešpecifikuje; politiky sú aditívne a doplnia sa
  spolu s auth/frontendom v ďalšom chate. Do tej doby DB nie je vystavená cez verejné API.
- **Views — len 4 explicitne menované** (`v_asset_effective`, `v_asset_classifications`,
  `v_floors`, `v_actors`). `v_documents`/`v_assets`/`v_spaces` („analogicky" v §2.7)
  sa doplnia neskôr podľa potreby Viewera — sú čisto aditívne.
- **Indexy presne podľa §2.6.** `rel_associates_classification` má index len na `from_id`
  (nie `to_id`) — držané podľa schémy, nie opomenutie.
- **`updated_at` triggery** sú na 3 tabuľkách s týmto stĺpcom: `objects`,
  `classification_systems`, `classification_references`. Prípony (floors/documents/
  persons) ani `ifc_guid_history` stĺpec `updated_at` nemajú → bez triggera.
- **Jediný migračný súbor** (nie logické rozdelenie) — initial schema, poradie
  rešpektuje FK závislosti.

**Verifikácia:** Docker nie je dostupný → namiesto `supabase db reset` overené na
čistej lokálnej PostgreSQL 17 cez `psql` (`ON_ERROR_STOP=1`). Otestované: aplikácia
celej migrácie, deep-merge dedičnosť v `v_asset_effective`, partial-unique
`uniq_active_location` (2. aktívna poloha zlyhá, archivovaná + nová prejde),
`updated_at` trigger. Pri prvom `supabase db reset` s Dockerom musí prejsť rovnako.

---
*v0.5 — §2 implementovaná (migrácia 20260616120000). **Meta-model vzťahov B implementovaný
(D-051, sprint F1, migrácia `20260707150000_relationships_metamodel.sql`):** per-vzťah
tabuľky `rel_*` supersedované generickou `relationships` + manifest `relationship_types` +
kanonické views rovnakého názvu + validačný trigger (§2.5/§2.6). Čítacia vrstva a seed bežia
nezmenene navonok; ETL zapisuje base tabuľku. **Nasadené na Supabase prod** (`acwoupricatirhlfkhvk`,
2026-07-07): 4461 hrán, migračná história sync so 8 súbormi v `supabase/migrations/`. Seed
hotový (`supabase/seed.sql`). Viewer S0–S5 nasadený na Verceli. Ďalšie migrácie prídu s F2
(geom containment) alebo aditívnymi features (RLS, actor model C).*
