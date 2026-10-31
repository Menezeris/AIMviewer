-- D-183 K1: záznam informačného kontajnera a jeho revízií + podpis vstupu (pečiatky revízie).
--
-- Pravda o obsahu je kontajner revízie (IFC, PDF, DWG v archíve, sha256); DB nesie jeho záznam
-- podľa IfcDocumentInformation (jeden riadok = jedna Revision) a z IfcOwnerHistory len pojmy, ktoré
-- IfcDocumentInformation nemá (OwningApplication, LastModifyingApplication, ChangeAction, State).
-- Pojmy IFC po anglicky, stĺpce snake_case (D-183 bod 9). Stav ISO 19650 (IfcApproval) pripravený prázdny.
--
-- Aditívne a bez zmeny hosta ani ETL:
--   * revízia modelu ostáva v `model_revisions` (D-086, zapisuje `etl.model_publish`); trigger z nej
--     založí `container_revisions`, väzba `model_revision_id`;
--   * dokument (PDF) dostane revíziu pri každom novom `documents.file_sha256` (trigger);
--   * `ids_runs` a `clash_runs` nesú `model_revisions` = {model: revízia}, nad ktorými beh naozaj bežal;
--     clash beh bez nej sa doplní z `models` (revízia z motora, inak jednoznačná veľkosť súboru);
--   * položky `_georef` nesú `model_revisions` a `document_sha256` (trigger pri zápise kalibrácie);
--   * `v_ids_latest`, `v_ids_summary`, `v_clash_latest`, `v_clash_summary` dostanú na konci `based_on`
--     a `stale` (null = revízia behu neznáma).
-- Spätné doplnenie: kontajnery a revízie z `model_revisions` a dokumentov, clash behy podľa veľkosti,
-- kalibrácie podľa času `calibrated_at`. Hlavička súboru (`file_header`) a aplikácia (`IfcApplication`)
-- sa doplnia až pri čítaní archívu (K2), trigger súbor nečíta.
-- Práva: nové tabuľky anon/authenticated nedostanú (default privileges, migrácia 20261016120000).

begin;

-- ---------------------------------------------------------------------------
-- Číselníky: IfcApplication, IfcPersonAndOrganization
-- ---------------------------------------------------------------------------
create table ifc_application (
  id                      uuid primary key default gen_random_uuid(),
  application_developer   text,                    -- IfcApplication.ApplicationDeveloper (meno organizácie)
  version                 text not null,           -- IfcApplication.Version
  application_full_name   text not null,           -- IfcApplication.ApplicationFullName
  application_identifier  text not null,           -- IfcApplication.ApplicationIdentifier
  created_at              timestamptz not null default now(),
  unique (application_identifier, version)
);

create table ifc_actor (
  id                 uuid primary key default gen_random_uuid(),
  person_name        text,                         -- IfcPerson (meno, ako ho zdroj uvádza)
  organization_name  text,                         -- IfcOrganization.Name
  person_id          uuid references objects (id) on delete set null,        -- AIM uzol person
  organization_id    uuid references objects (id) on delete set null,        -- AIM uzol organization
  roles              text[] not null default '{}', -- IfcActorRole.Role
  created_at         timestamptz not null default now(),
  check (person_name is not null or organization_name is not null)
);
create unique index uniq_ifc_actor on ifc_actor (coalesce(person_name, ''), coalesce(organization_name, ''));

-- Aktér podľa mena (bez organizácie); založí ho, ak chýba. NULL meno = NULL.
create or replace function ifc_actor_for(p_person text, p_org text default null)
returns uuid language plpgsql as $$
declare a uuid;
begin
  if nullif(btrim(coalesce(p_person, '')), '') is null and nullif(btrim(coalesce(p_org, '')), '') is null then
    return null;
  end if;
  select id into a from ifc_actor
   where coalesce(person_name, '') = coalesce(nullif(btrim(p_person), ''), '')
     and coalesce(organization_name, '') = coalesce(nullif(btrim(p_org), ''), '');
  if a is null then
    insert into ifc_actor (person_name, organization_name)
    values (nullif(btrim(p_person), ''), nullif(btrim(p_org), ''))
    returning id into a;
  end if;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Kontajner (IfcDocumentInformation naprieč revíziami)
-- ---------------------------------------------------------------------------
create table information_containers (
  id                 uuid primary key default gen_random_uuid(),
  identification     text not null unique,         -- IfcDocumentInformation.Identification (ISO 19650 container ID; dnes ASR, D.1.1.09)
  name               text,                         -- .Name
  description        text,                         -- .Description
  purpose            text,                         -- .Purpose
  intended_use       text,                         -- .IntendedUse
  scope              text,                         -- .Scope
  confidentiality    text,                         -- .Confidentiality (IfcDocumentConfidentialityEnum)
  electronic_format  text,                         -- .ElectronicFormat (MIME alebo schéma IFC)
  document_owner_id  uuid references ifc_actor (id),  -- .DocumentOwner (= OwningUser kontajnera)
  container_type     text not null check (container_type in ('IFC', 'PDF', 'DWG', 'OTHER')),
  model              text unique,                  -- model federácie (ifc/<model>.ifc), len IFC
  document_id        uuid unique references objects (id) on delete set null,  -- dokument AIM (D-014)
  created_at         timestamptz not null default now(),
  check ((container_type = 'IFC') = (model is not null))
);

-- ---------------------------------------------------------------------------
-- Revízia kontajnera (jedna IfcDocumentInformation.Revision)
-- ---------------------------------------------------------------------------
create table container_revisions (
  id                             uuid primary key default gen_random_uuid(),
  container_id                   uuid not null references information_containers (id) on delete cascade,
  revision                       text not null,          -- IfcDocumentInformation.Revision (dnes číslo, neskôr P01.80)
  revision_no                    integer not null check (revision_no >= 0),  -- poradie v hlavnej rade (model: vNNN)
  parent_revision_no             integer,                -- predchodca v hlavnej rade; NULL = prvá
  model_revision_id              uuid unique references model_revisions (id) on delete cascade,
  sha256                         text not null check (sha256 ~ '^[0-9a-f]{64}$'),  -- nekomprimovaný obsah, nemenné
  size_bytes                     bigint,
  location                       text,                   -- .Location (archív revízie, bucket dokumentu)
  electronic_format              text,                   -- .ElectronicFormat tejto revízie (IFC: FILE_SCHEMA)
  creation_time                  timestamptz,            -- .CreationTime (= IfcOwnerHistory.CreationDate)
  last_revision_time             timestamptz,            -- .LastRevisionTime (= LastModifiedDate)
  editors_id                     uuid references ifc_actor (id),        -- .Editors (= LastModifyingUser)
  owning_application_id          uuid references ifc_application (id),  -- IfcOwnerHistory.OwningApplication
  last_modifying_application_id  uuid references ifc_application (id),  -- IfcOwnerHistory.LastModifyingApplication
  change_action                  text not null check (change_action in ('ADDED', 'MODIFIED', 'DELETED', 'NOCHANGE', 'NOTDEFINED')),
  state                          text check (state in ('READWRITE', 'READONLY', 'LOCKED', 'READWRITELOCKED', 'READONLYLOCKED')),
  status                         text not null default 'DRAFT'          -- IfcDocumentStatusEnum; DRAFT = WIP (D-183)
                                 check (status in ('DRAFT', 'FINALDRAFT', 'FINAL', 'REVISION', 'NOTDEFINED')),
  approval                       jsonb,                  -- IfcApproval (ISO 19650: Status S0..S4, Level WIP/SHARED/PUBLISHED/ARCHIVED, GivingApproval, TimeOfApproval); zatiaľ NULL
  file_header                    jsonb,                  -- hlavička STEP (FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA) tak, ako je v súbore; K2
  recipe_ref                     text,                   -- recept v OCB (cesta@commit), D-086
  task_id                        uuid references model_tasks (id) on delete set null,
  commit_sha                     text,                   -- commit receptu
  created_at                     timestamptz not null default now(),
  unique (container_id, revision_no)
);
create index idx_container_revisions_container on container_revisions (container_id, revision_no desc);

-- ---------------------------------------------------------------------------
-- Kontajner modelu a dokumentu
-- ---------------------------------------------------------------------------
create or replace function container_for_model(p_model text)
returns uuid language plpgsql as $$
declare c uuid;
begin
  select id into c from information_containers where model = p_model;
  if c is null then
    insert into information_containers (identification, name, container_type, model)
    values (p_model, p_model, 'IFC', p_model)
    returning id into c;
  end if;
  return c;
end $$;

-- Typ kontajnera dokumentu z ElectronicFormat alebo prípony Location.
create or replace function container_type_of(p_format text, p_location text)
returns text language sql immutable as $$
  select case
    when coalesce(p_format, '') ilike '%pdf%' or coalesce(p_location, '') ~* '\.pdf([?#].*)?$' then 'PDF'
    when coalesce(p_format, '') ilike '%dwg%' or coalesce(p_location, '') ~* '\.dwg([?#].*)?$' then 'DWG'
    else 'OTHER'
  end
$$;

create or replace function container_for_document(p_doc uuid)
returns uuid language plpgsql as $$
declare c uuid; d record; ident text;
begin
  select id into c from information_containers where document_id = p_doc;
  if c is not null then return c; end if;
  select o.id, o.object_ref, o.name, dd.identification, dd.description, dd.purpose, dd.electronic_format,
         dd.location, dd.document_owner
    into d
    from objects o join documents dd on dd.id = o.id
   where o.id = p_doc and o.object_type = 'document';
  if not found then return null; end if;
  -- Identification musí byť jedinečná; pri zhode s iným kontajnerom object_ref, potom id.
  ident := coalesce(nullif(btrim(d.identification), ''), d.object_ref, d.id::text);
  if exists (select 1 from information_containers where identification = ident) then
    ident := coalesce(d.object_ref, d.id::text);
    if exists (select 1 from information_containers where identification = ident) then ident := d.id::text; end if;
  end if;
  insert into information_containers
    (identification, name, description, purpose, electronic_format, document_owner_id, container_type, document_id)
  values (ident, d.name, d.description, d.purpose, d.electronic_format, ifc_actor_for(d.document_owner),
          container_type_of(d.electronic_format, d.location), d.id)
  returning id into c;
  return c;
end $$;

-- Revízia modelu -> revízia kontajnera (volá trigger aj spätné doplnenie).
create or replace function container_revision_from_model(m model_revisions)
returns uuid language plpgsql as $$
declare c uuid; r uuid; first_time timestamptz; prior int;
begin
  c := container_for_model(m.model);
  select id into r from container_revisions where model_revision_id = m.id;
  if r is not null then return r; end if;
  select min(creation_time), count(*) into first_time, prior from container_revisions where container_id = c;
  insert into container_revisions
    (container_id, revision, revision_no, parent_revision_no, model_revision_id, sha256, size_bytes, location,
     creation_time, last_revision_time, editors_id, change_action, recipe_ref, task_id, commit_sha, created_at)
  values
    (c, m.revision::text, m.revision, m.parent_revision, m.id, m.sha256, m.size_bytes, m.archive_path,
     coalesce(first_time, m.created_at), m.created_at, ifc_actor_for(m.author),
     case when prior = 0 then 'ADDED' else 'MODIFIED' end,
     m.recipe_ref, m.task_id, nullif(split_part(coalesce(m.recipe_ref, ''), '@', 2), ''), m.created_at)
  returning id into r;
  return r;
end $$;

-- Nový obsah dokumentu (file_sha256) -> nová revízia jeho kontajnera; rovnaký obsah nič nezmení.
create or replace function container_revision_from_document(p_doc uuid)
returns uuid language plpgsql as $$
declare c uuid; r uuid; d record; last record;
begin
  select dd.file_sha256, dd.revision, dd.location, dd.electronic_format, dd.creation_time, dd.last_revision_time
    into d from documents dd join objects o on o.id = dd.id
   where dd.id = p_doc and o.object_type = 'document';
  if not found or d.file_sha256 is null then return null; end if;
  c := container_for_document(p_doc);
  select id, sha256, revision_no into last from container_revisions
   where container_id = c order by revision_no desc limit 1;
  if last.id is not null and last.sha256 = d.file_sha256 then return last.id; end if;
  insert into container_revisions
    (container_id, revision, revision_no, parent_revision_no, sha256, location, electronic_format,
     creation_time, last_revision_time, change_action)
  values
    (c, coalesce(nullif(btrim(d.revision), ''), (coalesce(last.revision_no, 0) + 1)::text),
     coalesce(last.revision_no, 0) + 1, last.revision_no, d.file_sha256, d.location, d.electronic_format,
     d.creation_time, coalesce(d.last_revision_time, now()),
     case when last.id is null then 'ADDED' else 'MODIFIED' end)
  returning id into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Spätné doplnenie (pred strážnymi triggermi: prod dáta sa neodmietnu)
-- ---------------------------------------------------------------------------
do $$
begin
  perform container_revision_from_model(m) from model_revisions m order by m.model, m.revision;
  perform container_revision_from_document(d.id)
     from documents d join objects o on o.id = d.id
    where o.object_type = 'document' and d.file_sha256 is not null;
  -- Kontajner aj pre dokumenty bez sha256 (revízia vznikne pri prvom sha256).
  perform container_for_document(o.id) from objects o join documents d on d.id = o.id where o.object_type = 'document';
end $$;

-- ---------------------------------------------------------------------------
-- Stráže: hlavná rada, nemenná revízia, mazať len poslednú (D-183 bod 10)
-- ---------------------------------------------------------------------------
create or replace function container_revisions_guard()
returns trigger language plpgsql as $$
declare top int;
begin
  if tg_op = 'INSERT' then
    select max(revision_no) into top from container_revisions where container_id = new.container_id;
    if top is not null and new.revision_no <= top then
      raise exception 'Revízia % kontajnera nie je vyššia ako posledná % (len hlavná rada, D-183)', new.revision_no, top;
    end if;
    if top is not null and new.parent_revision_no is distinct from top then
      raise exception 'Revízia % musí nadväzovať na poslednú revíziu % (rodič %, D-183)', new.revision_no, top, new.parent_revision_no;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.sha256 <> old.sha256 or new.size_bytes is distinct from old.size_bytes
       or new.revision_no <> old.revision_no or new.container_id <> old.container_id
       or new.model_revision_id is distinct from old.model_revision_id then
      raise exception 'Revízia kontajnera je nemenná (sha256, veľkosť, poradie); oprava = nová revízia (D-183)';
    end if;
    return new;
  else
    if exists (select 1 from container_revisions where container_id = old.container_id and revision_no > old.revision_no) then
      raise exception 'Zmazať sa dá len posledná revízia kontajnera (% nie je posledná, D-183)', old.revision_no;
    end if;
    return old;
  end if;
end $$;
create trigger trg_container_revisions_guard
  before insert or update or delete on container_revisions
  for each row execute function container_revisions_guard();

create or replace function model_revisions_immutable()
returns trigger language plpgsql as $$
begin
  if new.sha256 <> old.sha256 or new.size_bytes <> old.size_bytes or new.revision <> old.revision or new.model <> old.model then
    raise exception 'Revízia modelu je nemenná (sha256, veľkosť, číslo); oprava = nová revízia (D-086, D-183)';
  end if;
  return new;
end $$;
create trigger trg_model_revisions_immutable
  before update on model_revisions
  for each row execute function model_revisions_immutable();

-- Nová revízia modelu (etl.model_publish) -> revízia kontajnera v tej istej transakcii.
create or replace function model_revisions_to_container()
returns trigger language plpgsql as $$
begin
  perform container_revision_from_model(new);
  return new;
end $$;
create trigger trg_model_revisions_to_container
  after insert on model_revisions
  for each row execute function model_revisions_to_container();

-- Nový sha256 dokumentu (etl.pdf_text, doc_upload) -> revízia kontajnera dokumentu.
create or replace function documents_to_container()
returns trigger language plpgsql as $$
begin
  if new.file_sha256 is not null and (tg_op = 'INSERT' or new.file_sha256 is distinct from old.file_sha256) then
    perform container_revision_from_document(new.id);
  end if;
  return new;
end $$;
create trigger trg_documents_to_container
  after insert or update of file_sha256 on documents
  for each row execute function documents_to_container();

-- ---------------------------------------------------------------------------
-- Revízie modelov: aktuálne a k času, zastaranie podpisu
-- ---------------------------------------------------------------------------
-- {model: revízia}: t = NULL aktuálne (is_current), inak posledné zverejnené najneskôr v čase t.
create or replace function model_revisions_at(t timestamptz default null)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(model, revision), '{}'::jsonb)
  from (
    select distinct on (model) model, revision
    from model_revisions
    where (t is null and is_current) or (t is not null and created_at <= t)
    order by model, revision desc
  ) x
$$;

-- true = podpis behu sa líši od aktuálnych revízií; NULL = podpis neznámy (prázdny).
create or replace function revisions_stale(based_on jsonb)
returns boolean language sql stable set search_path = public as $$
  select case
    when based_on is null or jsonb_typeof(based_on) <> 'object' or based_on = '{}'::jsonb then null
    else exists (
      select 1 from jsonb_each(based_on) e
      where (model_revisions_at(null) -> e.key) is distinct from e.value
    )
  end
$$;

-- `models` z motora ({model: {etag, size, loaded_at, revision?}} alebo {model: číslo}) -> {model: revízia}.
-- Revízia z motora má prednosť; inak jednoznačná zhoda veľkosti nekomprimovaného súboru.
create or replace function engine_model_revisions(models jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, rev), '{}'::jsonb)
  from (
    select e.key as k,
           case
             when jsonb_typeof(e.value) = 'number' then e.value
             when jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'revision') = 'number' then e.value -> 'revision'
             when jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'size') = 'number' then (
               select to_jsonb(min(m.revision)) from model_revisions m
               where m.model = e.key and m.size_bytes = (e.value ->> 'size')::numeric
               having count(*) = 1
             )
           end as rev
    from jsonb_each(case when jsonb_typeof(models) = 'object' then models else '{}'::jsonb end) e
  ) x
  where rev is not null and rev <> 'null'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- Podpis vstupu na behoch IDS a clash
-- ---------------------------------------------------------------------------
alter table ids_runs add column model_revisions jsonb not null default '{}'::jsonb;    -- {model: revízia}, nad ktorou beh bežal
alter table clash_runs add column model_revisions jsonb not null default '{}'::jsonb;  -- {model: revízia}, D-183

-- Spätne: clash behy z veľkosti (beh 26. 10. má ASR v78 a VZT v9); IDS behy nemajú z čoho (ostanú neznáme).
update clash_runs set model_revisions = engine_model_revisions(models) where model_revisions = '{}'::jsonb;

create or replace function clash_runs_stamp()
returns trigger language plpgsql as $$
begin
  if new.model_revisions is null or new.model_revisions = '{}'::jsonb then
    new.model_revisions := engine_model_revisions(new.models);
  end if;
  return new;
end $$;
create trigger trg_clash_runs_stamp
  before insert on clash_runs
  for each row execute function clash_runs_stamp();

-- ---------------------------------------------------------------------------
-- Podpis vstupu na kalibráciách `_georef` (položka v2 alebo celé v1)
-- ---------------------------------------------------------------------------
-- Pečiatka položky: `model_revisions` {model: revízia} a `document_sha256`. Položka s pečiatkou ju drží;
-- tá istá kalibrácia (strana, affine, výrez) zo starého stavu ju prenesie (viewer neznáme kľúče zahodí);
-- nová kalibrácia dostane aktuálne revízie, pri spätnom doplnení revízie platné v čase `calibrated_at`.
create or replace function georef_stamp_item(c jsonb, old_items jsonb, sha text, backfill boolean)
returns jsonb language plpgsql stable set search_path = public as $$
declare o jsonb; at timestamptz;
begin
  if c is null or jsonb_typeof(c) <> 'object' or c ? 'model_revisions' then return c; end if;
  select x into o from jsonb_array_elements(coalesce(old_items, '[]'::jsonb)) x
   where x -> 'page' = c -> 'page' and x -> 'affine' = c -> 'affine'
     and coalesce(x -> 'region', 'null'::jsonb) = coalesce(c -> 'region', 'null'::jsonb)
   order by (x ? 'model_revisions') desc
   limit 1;
  if o is not null then
    if o ? 'model_revisions' then
      return c || jsonb_build_object('model_revisions', o -> 'model_revisions', 'document_sha256', o -> 'document_sha256');
    end if;
    if not backfill then return c; end if;  -- stará kalibrácia bez pečiatky ostane neznáma
  end if;
  if backfill then
    begin
      at := (c ->> 'calibrated_at')::timestamptz;
    exception when others then
      at := null;
    end;
    if at is null then return c; end if;
    return c || jsonb_build_object('model_revisions', model_revisions_at(at), 'document_sha256', sha);
  end if;
  return c || jsonb_build_object('model_revisions', model_revisions_at(null), 'document_sha256', sha);
end $$;

create or replace function georef_stamp(g jsonb, old_g jsonb, doc uuid, backfill boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
declare sha text; old_items jsonb; out jsonb := '[]'::jsonb; c jsonb;
begin
  if g is null or jsonb_typeof(g) <> 'object' then return g; end if;
  select file_sha256 into sha from documents where id = doc;
  old_items := case
    when old_g is null or jsonb_typeof(old_g) <> 'object' then '[]'::jsonb
    when jsonb_typeof(old_g -> 'calibrations') = 'array' then old_g -> 'calibrations'
    else jsonb_build_array(old_g)
  end;
  if jsonb_typeof(g -> 'calibrations') = 'array' then
    for c in select * from jsonb_array_elements(g -> 'calibrations') loop
      out := out || jsonb_build_array(georef_stamp_item(c, old_items, sha, backfill));
    end loop;
    return jsonb_set(g, '{calibrations}', out);
  end if;
  if g ? 'affine' then return georef_stamp_item(g, old_items, sha, backfill); end if;  -- v1
  return g;
end $$;

update objects o
   set properties = jsonb_set(o.properties, '{_georef}', georef_stamp(o.properties -> '_georef', null, o.id, true))
 where o.properties ? '_georef'
   and georef_stamp(o.properties -> '_georef', null, o.id, true) is distinct from o.properties -> '_georef';

create or replace function objects_georef_stamp()
returns trigger language plpgsql as $$
begin
  if new.properties ? '_georef'
     and (tg_op = 'INSERT' or new.properties -> '_georef' is distinct from old.properties -> '_georef') then
    new.properties := jsonb_set(new.properties, '{_georef}',
      georef_stamp(new.properties -> '_georef', case when tg_op = 'UPDATE' then old.properties -> '_georef' end, new.id));
  end if;
  return new;
end $$;
create trigger trg_objects_georef_stamp
  before insert or update of properties on objects
  for each row execute function objects_georef_stamp();

-- ---------------------------------------------------------------------------
-- Pohľady: `based_on` a `stale` na konci (staré stĺpce bez zmeny)
-- ---------------------------------------------------------------------------
create or replace view v_ids_latest as
  with latest as (
    select distinct on (coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label)
           r.*, d.code as ids_code, v.version as ids_doc_version
    from ids_runs r
    left join ids_document_versions v on v.id = r.ids_version_id
    left join ids_documents d on d.id = v.document_id
    order by coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label, r.checked_at desc, r.id
  )
  select r.id, l.id as run_id, l.ids_title, l.model_label, l.checked_at,
         r.spec_identifier, r.spec_name, r.status, r.reasons,
         r.object_id, o.object_ref, o.name, coalesce(o.ifc_type, r.ifc_type) as ifc_type, r.ifc_guid,
         l.ids_code, l.ids_doc_version, l.engine, l.binding,
         nullif(l.model_revisions, '{}'::jsonb) as based_on, revisions_stale(l.model_revisions) as stale
  from latest l
  join ids_results r on r.run_id = l.id
  left join objects o on o.id = r.object_id;

create or replace view v_ids_summary as
  select ids_title, model_label, checked_at, spec_identifier, spec_name,
         count(*) filter (where ifc_guid is not null)                     as elements,
         count(*) filter (where ifc_guid is not null and status = 'pass') as passed,
         count(*) filter (where status = 'fail')                          as failed,
         (array_agg(reasons[1]) filter (where status = 'fail'))[1]        as example_reason,
         ids_code, ids_doc_version, engine, binding, based_on, stale
  from v_ids_latest
  group by ids_title, model_label, checked_at, spec_identifier, spec_name,
           ids_code, ids_doc_version, engine, binding, based_on, stale;

create or replace view v_clash_latest as
  with latest as (
    select distinct on (r.test_id) r.*
    from clash_runs r
    where r.test_id is not null
    order by r.test_id, r.created_at desc, r.id
  )
  select c.id, l.id as run_id, t.code as test_code, t.name as test_name, l.created_at as run_at,
         l.trigger, l.engine,
         c.clash_key, c.rule, c.status, c.severity, c.distance, c.storey, c.center,
         c.a_guid, c.a_model, c.a_ifc_type, c.a_name, oa.object_ref as a_object_ref, sa.name as a_system,
         c.b_guid, c.b_model, c.b_ifc_type, c.b_name, ob.object_ref as b_object_ref, sb.name as b_system,
         coalesce(rv.status, 'open') as review_status, rv.comment as review_comment,
         rv.bcf_topic_id, mt.number as bcf_topic_number,
         nullif(l.model_revisions, '{}'::jsonb) as based_on, revisions_stale(l.model_revisions) as stale
  from latest l
  join clash_tests t on t.id = l.test_id
  join clash_results c on c.run_id = l.id
  left join clash_reviews rv on rv.test_id = l.test_id and rv.clash_key = c.clash_key
  left join model_tasks mt on mt.id = rv.bcf_topic_id
  left join lateral (
    select o.id, o.object_ref from ifc_guid_history h join objects o on o.id = h.object_id
    where h.ifc_guid = c.a_guid and h.valid_until is null limit 1
  ) oa on true
  left join lateral (
    select o.id, o.object_ref from ifc_guid_history h join objects o on o.id = h.object_id
    where h.ifc_guid = c.b_guid and h.valid_until is null limit 1
  ) ob on true
  left join lateral (
    select s.name from rel_assigns_to_group g join objects s on s.id = g.to_id and s.object_type = 'system' and s.valid_until is null
    where g.from_id = oa.id and g.valid_until is null order by s.name limit 1
  ) sa on true
  left join lateral (
    select s.name from rel_assigns_to_group g join objects s on s.id = g.to_id and s.object_type = 'system' and s.valid_until is null
    where g.from_id = ob.id and g.valid_until is null order by s.name limit 1
  ) sb on true;

create or replace view v_clash_summary as
  with latest as (
    select distinct on (r.test_id) r.*
    from clash_runs r
    where r.test_id is not null
    order by r.test_id, r.created_at desc, r.id
  )
  select t.code as test_code, t.name as test_name, l.id as run_id, l.created_at as run_at,
         c.rule, c.storey, coalesce(rv.status, 'open') as review_status,
         count(*)                                           as clashes,
         count(*) filter (where c.status = 'hard')          as hard,
         count(*) filter (where c.status = 'clearance')     as clearance,
         count(*) filter (where c.severity = 'critical')    as critical,
         count(*) filter (where c.severity = 'major')       as major,
         count(*) filter (where c.severity = 'minor')       as minor,
         count(*) filter (where c.severity = 'info')        as info,
         nullif(l.model_revisions, '{}'::jsonb) as based_on, revisions_stale(l.model_revisions) as stale
  from latest l
  join clash_tests t on t.id = l.test_id
  join clash_results c on c.run_id = l.id
  left join clash_reviews rv on rv.test_id = l.test_id and rv.clash_key = c.clash_key
  group by t.code, t.name, l.id, l.created_at, l.model_revisions, c.rule, c.storey, coalesce(rv.status, 'open');

-- Prehľad kontajnerov s pojmami IfcDocumentInformation a IfcOwnerHistory (po anglicky, D-183 bod 9).
create or replace view v_container_revisions as
  select c.id as container_id, c.identification, c.name, c.container_type, c.model, c.document_id,
         r.id as revision_id, r.revision, r.revision_no, r.parent_revision_no,
         r.revision_no = max(r.revision_no) over (partition by c.id) as is_latest,
         r.status, r.change_action, r.state, r.approval,
         own.person_name as owning_user, own.organization_name as owning_organization,
         ed.person_name as last_modifying_user, ed.organization_name as last_modifying_organization,
         oa.application_full_name as owning_application, la.application_full_name as last_modifying_application,
         r.creation_time, r.last_revision_time, coalesce(r.electronic_format, c.electronic_format) as electronic_format,
         r.location, r.sha256, r.size_bytes, r.file_header, r.recipe_ref, r.task_id, r.commit_sha, r.model_revision_id
  from information_containers c
  join container_revisions r on r.container_id = c.id
  left join ifc_actor own on own.id = c.document_owner_id
  left join ifc_actor ed on ed.id = r.editors_id
  left join ifc_application oa on oa.id = r.owning_application_id
  left join ifc_application la on la.id = r.last_modifying_application_id;

revoke all on ifc_application, ifc_actor, information_containers, container_revisions, v_container_revisions from anon, authenticated;
grant select on v_container_revisions to service_role;
grant all on ifc_application, ifc_actor, information_containers, container_revisions to service_role;
revoke all on v_ids_latest, v_ids_summary, v_clash_latest, v_clash_summary from anon, authenticated;
grant select on v_ids_latest, v_ids_summary, v_clash_latest, v_clash_summary to service_role;

commit;
