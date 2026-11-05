-- D-189: AIMviewer becomes multi-project (platform step 3, PR 1: database only).
--
-- A project is the objects node with object_type = 'project'; its id is the project id
-- (platform.projects.id, step 7). OCB = 9e2dfcba-437b-43d3-a925-0dd29f195b38.
--
-- What this migration does:
--   * project_id on project-bound tables, all existing rows go to OCB;
--   * models are identified by UUID: the container (information_containers.id), with
--     model_revisions.container_id and the revision copy keyed by model_revision_id;
--   * per-project unique keys next to the old global ones (the old ones are dropped by a
--     later cleanup migration, once the app and ETL write project_id themselves);
--   * every v_* / rel_* view gets a project_id column and resolves GUIDs within a project;
--   * RPCs get a trailing p_project parameter (transitional default OCB);
--   * triggers derive project_id where it follows from other data.
--
-- Behaviour of the deployed app does not change: the DEFAULTs and the old keys stay until
-- the cleanup migration. The constant DEFAULT makes "add column" a catalog-only change.
--
-- Not applied to production until Samuel says yes and a fresh backup exists (D-189).
-- Rollback: restore from that backup (the revision copy is re-keyed, a hand rollback is
-- not worth the risk).

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Project id columns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.objects
                  where id = '9e2dfcba-437b-43d3-a925-0dd29f195b38' and object_type = 'project') then
    raise exception 'D-189: the OCB project node 9e2dfcba-... is missing';
  end if;
end $$;

-- objects: NULL only for global people and organizations (A1); a project node points at itself.
alter table public.objects add column project_id uuid default '9e2dfcba-437b-43d3-a925-0dd29f195b38';
alter table public.objects disable trigger user;  -- keep updated_at and georef stamps untouched
update public.objects set project_id = null where object_type in ('person', 'organization');
update public.objects set project_id = id where object_type = 'project';
alter table public.objects enable trigger user;
alter table public.objects
  add constraint objects_project_id_fkey foreign key (project_id) references public.objects(id),
  add constraint objects_project_scope check (
    case
      when object_type in ('person', 'organization') then project_id is null
      when object_type = 'project' then project_id = id
      else project_id is not null
    end);
create index idx_objects_project on public.objects (project_id);
create index idx_objects_project_ifc_guid on public.objects (project_id, ifc_guid);

-- relationships: derived by the validation trigger (project of from_id, else of to_id);
-- NULL for edges between global nodes (rel_member_of).
alter table public.relationships add column project_id uuid;
alter table public.relationships disable trigger trg_relationships_validate;
update public.relationships r set project_id = f.project_id
  from public.objects f where f.id = r.from_id;
update public.relationships r set project_id = t.project_id
  from public.objects t where r.project_id is null and t.id = r.to_id;
alter table public.relationships enable trigger trg_relationships_validate;
alter table public.relationships
  add constraint relationships_project_id_fkey foreign key (project_id) references public.objects(id);
create index idx_relationships_project on public.relationships (project_id);

-- Tables with their own project_id, NOT NULL with the transitional DEFAULT OCB.
do $$
declare t text;
begin
  foreach t in array array[
    'information_containers', 'model_revisions', 'model_tasks', 'saved_views', 'clash_tests',
    'clash_runs', 'ids_documents', 'ids_runs', 'derivation_runs', 'verification_runs',
    'icdd_imports', 'drawing_link_overrides', 'ifc_guid_aliases'
  ] loop
    execute format(
      'alter table public.%I add column project_id uuid not null default %L', t,
      '9e2dfcba-437b-43d3-a925-0dd29f195b38');
    execute format(
      'alter table public.%I add constraint %I foreign key (project_id) references public.objects(id)',
      t, t || '_project_id_fkey');
    execute format('create index %I on public.%I (project_id)', 'idx_' || t || '_project', t);
  end loop;
end $$;

-- Document containers belong to the project of their document.
update public.information_containers c set project_id = o.project_id
  from public.objects o where o.id = c.document_id and o.project_id is not null;

-- mcp_call_log: a call without a project is legitimate, no default.
alter table public.mcp_call_log add column project_id uuid
  constraint mcp_call_log_project_id_fkey references public.objects(id);
create index idx_mcp_call_log_project on public.mcp_call_log (project_id);

-- ---------------------------------------------------------------------------
-- 2. Models identified by UUID: model_revisions.container_id
-- ---------------------------------------------------------------------------

alter table public.model_revisions add column container_id uuid
  constraint model_revisions_container_id_fkey references public.information_containers(id);
update public.model_revisions m set container_id = c.id
  from public.information_containers c
 where c.project_id = m.project_id and c.model = m.model;
do $$
begin
  if exists (select 1 from public.model_revisions where container_id is null) then
    raise exception 'D-189: a model revision has no container';
  end if;
end $$;
alter table public.model_revisions alter column container_id set not null;

-- Per-project keys. The old global ones (model), (identification), (model, revision),
-- current (model) stay until the cleanup migration, because the deployed ETL relies on
-- them in ON CONFLICT.
create unique index uniq_information_containers_project_model
  on public.information_containers (project_id, model) where model is not null;
create unique index uniq_information_containers_project_identification
  on public.information_containers (project_id, identification);
create unique index uniq_model_revisions_container_revision
  on public.model_revisions (container_id, revision);
create unique index uniq_model_revisions_container_current
  on public.model_revisions (container_id) where is_current;

-- ---------------------------------------------------------------------------
-- 3. Revision copy keyed by model_revision_id
-- ---------------------------------------------------------------------------

alter table public.ifc_rev_imports add column model_revision_id uuid;
update public.ifc_rev_imports i set model_revision_id = m.id
  from public.model_revisions m where m.model = i.model and m.revision = i.revision;
alter table public.ifc_rev_imports alter column model_revision_id set not null;

alter table public.ifc_rev_objects add column model_revision_id uuid;
alter table public.ifc_rev_property_sets add column model_revision_id uuid;
alter table public.ifc_rev_relationships add column model_revision_id uuid;
update public.ifc_rev_objects x set model_revision_id = i.model_revision_id
  from public.ifc_rev_imports i where i.model = x.model and i.revision = x.revision;
update public.ifc_rev_property_sets x set model_revision_id = i.model_revision_id
  from public.ifc_rev_imports i where i.model = x.model and i.revision = x.revision;
update public.ifc_rev_relationships x set model_revision_id = i.model_revision_id
  from public.ifc_rev_imports i where i.model = x.model and i.revision = x.revision;
alter table public.ifc_rev_objects alter column model_revision_id set not null;
alter table public.ifc_rev_property_sets alter column model_revision_id set not null;
alter table public.ifc_rev_relationships alter column model_revision_id set not null;

alter table public.ifc_rev_objects drop constraint ifc_rev_objects_model_revision_fkey;
alter table public.ifc_rev_property_sets drop constraint ifc_rev_property_sets_model_revision_fkey;
alter table public.ifc_rev_relationships drop constraint ifc_rev_relationships_model_revision_fkey;
alter table public.ifc_rev_imports drop constraint ifc_rev_imports_model_revision_fkey;

-- ifc_rev_imports: PK becomes model_revision_id; (model, revision) stays unique for the
-- deployed ETL (ON CONFLICT (model, revision)) until the cleanup migration.
alter table public.ifc_rev_imports drop constraint ifc_rev_imports_pkey;
alter table public.ifc_rev_imports
  add constraint ifc_rev_imports_pkey primary key (model_revision_id),
  add constraint ifc_rev_imports_model_revision_key unique (model, revision),
  add constraint ifc_rev_imports_model_revision_id_fkey
    foreign key (model_revision_id) references public.model_revisions(id) on delete cascade;

alter table public.ifc_rev_objects drop constraint ifc_rev_objects_pkey;
alter table public.ifc_rev_objects
  add constraint ifc_rev_objects_pkey primary key (model_revision_id, global_id),
  add constraint ifc_rev_objects_model_revision_id_fkey
    foreign key (model_revision_id) references public.ifc_rev_imports(model_revision_id) on delete cascade;

alter table public.ifc_rev_property_sets drop constraint ifc_rev_property_sets_pkey;
alter table public.ifc_rev_property_sets
  add constraint ifc_rev_property_sets_pkey primary key (model_revision_id, global_id, pset_name),
  add constraint ifc_rev_property_sets_model_revision_id_fkey
    foreign key (model_revision_id) references public.ifc_rev_imports(model_revision_id) on delete cascade;

alter table public.ifc_rev_relationships drop constraint ifc_rev_relationships_pkey;
alter table public.ifc_rev_relationships
  add constraint ifc_rev_relationships_pkey primary key (model_revision_id, rel_class, relating, related),
  add constraint ifc_rev_relationships_model_revision_id_fkey
    foreign key (model_revision_id) references public.ifc_rev_imports(model_revision_id) on delete cascade;

-- The deployed ETL deletes by (model, revision); keep that path indexed.
create index idx_ifc_rev_objects_model_revision on public.ifc_rev_objects (model, revision);
create index idx_ifc_rev_property_sets_model_revision on public.ifc_rev_property_sets (model, revision);
create index idx_ifc_rev_relationships_model_revision on public.ifc_rev_relationships (model, revision);

-- ---------------------------------------------------------------------------
-- 4. Per-project codes (old global keys stay until the cleanup migration)
-- ---------------------------------------------------------------------------

create unique index uniq_clash_tests_project_code on public.clash_tests (project_id, code);
create unique index uniq_ids_documents_project_code on public.ids_documents (project_id, code);
create unique index uniq_model_tasks_project_number on public.model_tasks (project_id, number);
create unique index uniq_saved_views_project_name
  on public.saved_views (project_id, lower(name)) where kind = 'saved';
create unique index uniq_saved_views_project_last
  on public.saved_views (project_id) where kind = 'last';
create unique index uniq_ifc_guid_aliases_project_guid
  on public.ifc_guid_aliases (project_id, ifc_guid) where valid_until is null;

-- The IfcProject of every other file of OCB is an alias of the OCB node (IFC defines
-- IfcProject per exchange; the AIM node is the canonical project).
insert into public.ifc_guid_aliases (ifc_guid, object_id, reason, project_id)
select o.global_id, '9e2dfcba-437b-43d3-a925-0dd29f195b38', 'IfcProject of another file of the project (D-189)',
       '9e2dfcba-437b-43d3-a925-0dd29f195b38'
  from public.ifc_rev_objects o
  join public.model_revisions m on m.id = o.model_revision_id and m.is_current
 where o.ifc_class = 'IfcProject'
   and o.attributes ->> 'Name' = 'OCB'
   and o.global_id <> (select ifc_guid from public.objects where id = '9e2dfcba-437b-43d3-a925-0dd29f195b38')
   and not exists (select 1 from public.ifc_guid_aliases a where a.ifc_guid = o.global_id and a.valid_until is null)
   and not exists (select 1 from public.ifc_guid_history h where h.ifc_guid = o.global_id and h.valid_until is null);

-- ---------------------------------------------------------------------------
-- 5. Functions and triggers that know the project
-- ---------------------------------------------------------------------------

-- {model code: revision} of one project, at time t (null = current revisions).
-- Model codes are unique within a project, so the stamp is unambiguous inside the row's project.
create or replace function public.project_model_revisions_at(p_project uuid, t timestamptz default null)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(model, revision), '{}'::jsonb)
  from (
    select distinct on (container_id) model, revision
    from model_revisions
    where project_id = p_project
      and ((t is null and is_current) or (t is not null and created_at <= t))
    order by container_id, revision desc
  ) x
$$;

create or replace function public.project_revisions_stale(p_project uuid, based_on jsonb)
returns boolean
language sql stable
set search_path = public
as $$
  select case
    when based_on is null or jsonb_typeof(based_on) <> 'object' or based_on = '{}'::jsonb then null
    else exists (
      select 1 from jsonb_each(based_on) e
      where (project_model_revisions_at(p_project, null) -> e.key) is distinct from e.value
    )
  end
$$;

create or replace function public.project_engine_model_revisions(p_project uuid, models jsonb)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, rev), '{}'::jsonb)
  from (
    select e.key as k,
           case
             when jsonb_typeof(e.value) = 'number' then e.value
             when jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'revision') = 'number' then e.value -> 'revision'
             when jsonb_typeof(e.value) = 'object' and jsonb_typeof(e.value -> 'size') = 'number' then (
               select to_jsonb(min(m.revision)) from model_revisions m
               where m.project_id = p_project and m.model = e.key and m.size_bytes = (e.value ->> 'size')::numeric
               having count(*) = 1
             )
           end as rev
    from jsonb_each(case when jsonb_typeof(models) = 'object' then models else '{}'::jsonb end) e
  ) x
  where rev is not null and rev <> 'null'::jsonb
$$;

-- The old one-project signatures stay as OCB wrappers until the app passes the project.
create or replace function public.model_revisions_at(t timestamptz default null)
returns jsonb
language sql stable
set search_path = public
as $$ select project_model_revisions_at('9e2dfcba-437b-43d3-a925-0dd29f195b38', t) $$;

create or replace function public.revisions_stale(based_on jsonb)
returns boolean
language sql stable
set search_path = public
as $$ select project_revisions_stale('9e2dfcba-437b-43d3-a925-0dd29f195b38', based_on) $$;

create or replace function public.engine_model_revisions(models jsonb)
returns jsonb
language sql stable
set search_path = public
as $$ select project_engine_model_revisions('9e2dfcba-437b-43d3-a925-0dd29f195b38', models) $$;

-- model_revision_id of a revision of a model (code) within a project.
create or replace function public.ifc_rev_revision_id(p_project uuid, p_model text, p_revision integer)
returns uuid
language sql stable
set search_path = public
as $$
  select id from model_revisions where project_id = p_project and model = p_model and revision = p_revision
$$;

-- Container (= model identity) of a model code within a project; created on first use.
create or replace function public.container_for_model(p_project uuid, p_model text)
returns uuid
language plpgsql
as $$
declare c uuid;
begin
  if p_project is null then raise exception 'container_for_model: p_project is required'; end if;
  select id into c from information_containers where project_id = p_project and model = p_model;
  if c is null then
    insert into information_containers (identification, name, container_type, model, project_id)
    values (p_model, p_model, 'IFC', p_model, p_project)
    returning id into c;
  end if;
  return c;
end $$;

create or replace function public.container_for_model(p_model text)
returns uuid
language sql
as $$ select container_for_model('9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid, p_model) $$;

create or replace function public.container_revision_from_model(m model_revisions)
returns uuid
language plpgsql
as $$
declare c uuid; r uuid; first_time timestamptz; prior int;
begin
  c := coalesce(m.container_id, container_for_model(m.project_id, m.model));
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

-- Document container: in the project of the document; identification unique within it.
create or replace function public.container_for_document(p_doc uuid)
returns uuid
language plpgsql
as $$
declare c uuid; d record; ident text;
begin
  select id into c from information_containers where document_id = p_doc;
  if c is not null then return c; end if;
  select o.id, o.object_ref, o.name, o.project_id, dd.identification, dd.description, dd.purpose,
         dd.electronic_format, dd.location, dd.document_owner
    into d
    from objects o join documents dd on dd.id = o.id
   where o.id = p_doc and o.object_type = 'document';
  if not found then return null; end if;
  ident := coalesce(nullif(btrim(d.identification), ''), d.object_ref, d.id::text);
  if exists (select 1 from information_containers where identification = ident) then
    ident := coalesce(d.object_ref, d.id::text);
    if exists (select 1 from information_containers where identification = ident) then ident := d.id::text; end if;
  end if;
  insert into information_containers
    (identification, name, description, purpose, electronic_format, document_owner_id, container_type, document_id,
     project_id)
  values (ident, d.name, d.description, d.purpose, d.electronic_format, ifc_actor_for(d.document_owner),
          container_type_of(d.electronic_format, d.location), d.id, d.project_id)
  returning id into c;
  return c;
end $$;

-- model_revisions: container_id follows from (project_id, model) for writers that do not set it.
create or replace function public.model_revisions_container()
returns trigger
language plpgsql
as $$
begin
  if new.container_id is null then
    new.container_id := container_for_model(new.project_id, new.model);
  elsif not exists (select 1 from information_containers
                     where id = new.container_id and project_id = new.project_id
                       and model is not distinct from new.model) then
    raise exception 'model_revisions: container % is not model % of project %', new.container_id, new.model, new.project_id;
  end if;
  return new;
end $$;

create trigger trg_model_revisions_container
  before insert on public.model_revisions
  for each row execute function public.model_revisions_container();

create or replace function public.model_revisions_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.sha256 <> old.sha256 or new.size_bytes <> old.size_bytes or new.revision <> old.revision or new.model <> old.model
     or new.container_id <> old.container_id or new.project_id <> old.project_id then
    raise exception 'Revízia modelu je nemenná (sha256, veľkosť, číslo); oprava = nová revízia (D-086, D-183)';
  end if;
  return new;
end $$;

-- Revision copy: model_revision_id follows from (model, revision) for the deployed ETL, which
-- does not know it yet. Ambiguous (the same code in two projects) is an error.
create or replace function public.ifc_rev_fill_model_revision_id()
returns trigger
language plpgsql
as $$
declare n int; mid uuid;
begin
  if new.model_revision_id is null then
    select count(*), min(id::text)::uuid into n, mid
      from model_revisions where model = new.model and revision = new.revision;
    if n <> 1 then
      raise exception '%: model_revision_id is required (% revisions match % v%)', tg_table_name, n, new.model, new.revision;
    end if;
    new.model_revision_id := mid;
  end if;
  return new;
end $$;

create trigger trg_ifc_rev_imports_model_revision before insert on public.ifc_rev_imports
  for each row execute function public.ifc_rev_fill_model_revision_id();
create trigger trg_ifc_rev_objects_model_revision before insert on public.ifc_rev_objects
  for each row execute function public.ifc_rev_fill_model_revision_id();
create trigger trg_ifc_rev_property_sets_model_revision before insert on public.ifc_rev_property_sets
  for each row execute function public.ifc_rev_fill_model_revision_id();
create trigger trg_ifc_rev_relationships_model_revision before insert on public.ifc_rev_relationships
  for each row execute function public.ifc_rev_fill_model_revision_id();

-- objects: people and organizations are global, a project node is its own project.
create or replace function public.objects_project_scope()
returns trigger
language plpgsql
as $$
begin
  if new.object_type in ('person', 'organization') then
    new.project_id := null;
  elsif new.object_type = 'project' then
    new.project_id := new.id;
  end if;
  return new;
end $$;

create trigger trg_objects_project_scope
  before insert or update of object_type, project_id on public.objects
  for each row execute function public.objects_project_scope();

-- Georeference stamps (D-129) record the revisions of the object's own project.
create or replace function public.georef_stamp_item(c jsonb, old_items jsonb, sha text, backfill boolean, p_project uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
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
    if not backfill then return c; end if;
  end if;
  if backfill then
    begin
      at := (c ->> 'calibrated_at')::timestamptz;
    exception when others then
      at := null;
    end;
    if at is null then return c; end if;
    return c || jsonb_build_object('model_revisions', project_model_revisions_at(p_project, at), 'document_sha256', sha);
  end if;
  return c || jsonb_build_object('model_revisions', project_model_revisions_at(p_project, null), 'document_sha256', sha);
end $$;

create or replace function public.georef_stamp_item(c jsonb, old_items jsonb, sha text, backfill boolean)
returns jsonb
language sql stable
set search_path = public
as $$ select georef_stamp_item(c, old_items, sha, backfill, '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid) $$;

create or replace function public.georef_stamp(g jsonb, old_g jsonb, doc uuid, backfill boolean, p_project uuid)
returns jsonb
language plpgsql stable
set search_path = public
as $$
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
      out := out || jsonb_build_array(georef_stamp_item(c, old_items, sha, backfill, p_project));
    end loop;
    return jsonb_set(g, '{calibrations}', out);
  end if;
  if g ? 'affine' then return georef_stamp_item(g, old_items, sha, backfill, p_project); end if;
  return g;
end $$;

create or replace function public.georef_stamp(g jsonb, old_g jsonb, doc uuid, backfill boolean default false)
returns jsonb
language sql stable
set search_path = public
as $$ select georef_stamp(g, old_g, doc, backfill, '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid) $$;

create or replace function public.objects_georef_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.properties ? '_georef'
     and (tg_op = 'INSERT' or new.properties -> '_georef' is distinct from old.properties -> '_georef') then
    new.properties := jsonb_set(new.properties, '{_georef}',
      georef_stamp(new.properties -> '_georef', case when tg_op = 'UPDATE' then old.properties -> '_georef' end,
                   new.id, false, new.project_id));
  end if;
  return new;
end $$;

create or replace function public.clash_runs_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.model_revisions is null or new.model_revisions = '{}'::jsonb then
    new.model_revisions := project_engine_model_revisions(new.project_id, new.models);
  end if;
  return new;
end $$;

-- Edges: project follows from the endpoints; edges across projects are rejected
-- (global people, organizations and classification references excepted).
create or replace function public.relationships_validate()
returns trigger
language plpgsql
as $$
declare
  m         relationship_types%rowtype;
  from_type text;
  to_type   text;
  from_proj uuid;
  to_proj   uuid;
begin
  select * into m from relationship_types where rel_type = new.rel_type;
  if not found then
    raise exception 'relationships: neznamy rel_type "%"', new.rel_type;
  end if;

  select object_type, project_id into from_type, from_proj from objects where id = new.from_id;
  if from_type is null then
    raise exception 'relationships(%): from_id % nie je v objects', new.rel_type, new.from_id;
  end if;
  if cardinality(m.from_object_types) > 0 and not (from_type = any(m.from_object_types)) then
    raise exception 'relationships(%): from object_type "%" nie je povoleny %',
      new.rel_type, from_type, m.from_object_types;
  end if;

  if m.to_is_classification then
    if not exists (select 1 from classification_references where id = new.to_id) then
      raise exception 'relationships(%): to_id % nie je v classification_references', new.rel_type, new.to_id;
    end if;
  else
    select object_type, project_id into to_type, to_proj from objects where id = new.to_id;
    if to_type is null then
      raise exception 'relationships(%): to_id % nie je v objects', new.rel_type, new.to_id;
    end if;
    if cardinality(m.to_object_types) > 0 and not (to_type = any(m.to_object_types)) then
      raise exception 'relationships(%): to object_type "%" nie je povoleny %',
        new.rel_type, to_type, m.to_object_types;
    end if;
  end if;

  if from_proj is not null and to_proj is not null and from_proj <> to_proj then
    raise exception 'relationships(%): % and % are in different projects (D-189)', new.rel_type, new.from_id, new.to_id;
  end if;
  new.project_id := coalesce(from_proj, to_proj);
  return new;
end $$;

-- IDS binds only to a model container of its own project.
create or replace function public.ids_document_models_guard()
returns trigger
language plpgsql
as $$
declare kind text; c_proj uuid; d_proj uuid;
begin
  if tg_op = 'UPDATE' then
    if old.valid_until is not null then
      raise exception 'ukončená väzba IDS na model sa nemení';
    end if;
    if new.document_id <> old.document_id or new.information_container_id <> old.information_container_id
       or new.created_by <> old.created_by or new.valid_from <> old.valid_from
       or new.library_container is distinct from old.library_container then
      raise exception 'väzba IDS na model sa dá len ukončiť (valid_until, ended_by)';
    end if;
    return new;
  end if;
  select container_type, project_id into kind, c_proj from information_containers where id = new.information_container_id;
  if kind is distinct from 'IFC' then
    raise exception 'IDS sa viaže len na model federácie (IFC kontajner)';
  end if;
  select project_id into d_proj from ids_documents where id = new.document_id;
  if d_proj is distinct from c_proj then
    raise exception 'IDS and model container are in different projects (D-189)';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Views over the revision copy: join on model_revision_id, resolve GUIDs within
-- the project, append project_id as the last column.
-- ---------------------------------------------------------------------------

create or replace view public.ifc_rev_current as
 SELECT DISTINCT ON (c.container_id) i.model,
    i.revision,
    i.finished_at,
    c.project_id,
    c.container_id,
    i.model_revision_id
   FROM ifc_rev_imports i
     JOIN model_revisions m ON m.id = i.model_revision_id
     JOIN model_revisions c ON c.container_id = m.container_id AND c.is_current
  WHERE i.status = 'done'::text AND i.revision <= c.revision
  ORDER BY c.container_id, i.revision DESC;

create or replace view public.ifc_guid_node as
SELECT h.ifc_guid,
    h.object_id,
    o.object_type,
    o.object_ref,
    NULL::text AS alias_reason,
    o.project_id
   FROM ifc_guid_history h
     JOIN objects o ON o.id = h.object_id AND o.valid_until IS NULL
  WHERE h.valid_until IS NULL
UNION ALL
 SELECT a.ifc_guid,
    a.object_id,
    o.object_type,
    o.object_ref,
    a.reason AS alias_reason,
    o.project_id
   FROM ifc_guid_aliases a
     JOIN objects o ON o.id = a.object_id AND o.valid_until IS NULL
  WHERE a.valid_until IS NULL AND NOT (EXISTS ( SELECT 1
           FROM ifc_guid_history h
          JOIN objects ho ON ho.id = h.object_id
          WHERE h.ifc_guid = a.ifc_guid AND h.valid_until IS NULL AND ho.project_id IS NOT DISTINCT FROM o.project_id));

create or replace view public.rel_aggregates as
SELECT md5((((((r.model || '|'::text) || r.revision) || '|IfcRelAggregates|'::text) || r.relating) || '|'::text) || r.related)::uuid AS id,
    e.object_id AS from_id,
    p.object_id AS to_id,
    c.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || r.model) || ' v'::text) || r.revision AS source,
    r.model,
    r.revision,
    r.related AS global_id,
    r.relating AS parent_global_id,
    c.project_id
   FROM ifc_rev_relationships r
     JOIN ifc_rev_current c ON c.model_revision_id = r.model_revision_id
     LEFT JOIN ifc_guid_node e ON e.ifc_guid = r.related AND e.project_id = c.project_id
     LEFT JOIN ifc_guid_node p ON p.ifc_guid = r.relating AND p.project_id = c.project_id
  WHERE r.rel_class = 'IfcRelAggregates'::text
UNION ALL
 SELECT relationships.id,
    relationships.from_id,
    relationships.to_id,
    relationships.valid_from,
    relationships.valid_until,
    relationships.source,
    NULL::text AS model,
    NULL::integer AS revision,
    NULL::text AS global_id,
    NULL::text AS parent_global_id,
    relationships.project_id
   FROM relationships
  WHERE relationships.rel_type = 'rel_aggregates'::text AND rel_is_aim_layer(relationships.source);

create or replace view public.rel_assigns_to_group as
SELECT md5((((((r.model || '|'::text) || r.revision) || '|IfcRelAssignsToGroup|'::text) || r.relating) || '|'::text) || r.related)::uuid AS id,
    e.object_id AS from_id,
    g.object_id AS to_id,
    c.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || r.model) || ' v'::text) || r.revision AS source,
    r.model,
    r.revision,
    r.related AS global_id,
    r.relating AS group_global_id,
    c.project_id
   FROM ifc_rev_relationships r
     JOIN ifc_rev_current c ON c.model_revision_id = r.model_revision_id
     LEFT JOIN ifc_guid_node e ON e.ifc_guid = r.related AND e.project_id = c.project_id
     LEFT JOIN ifc_guid_node g ON g.ifc_guid = r.relating AND g.project_id = c.project_id
  WHERE r.rel_class = 'IfcRelAssignsToGroup'::text
UNION ALL
 SELECT relationships.id,
    relationships.from_id,
    relationships.to_id,
    relationships.valid_from,
    relationships.valid_until,
    relationships.source,
    NULL::text AS model,
    NULL::integer AS revision,
    NULL::text AS global_id,
    NULL::text AS group_global_id,
    relationships.project_id
   FROM relationships
  WHERE relationships.rel_type = 'rel_assigns_to_group'::text AND rel_is_aim_layer(relationships.source);

create or replace view public.rel_defines_by_type as
SELECT md5((((((r.model || '|'::text) || r.revision) || '|IfcRelDefinesByType|'::text) || r.relating) || '|'::text) || r.related)::uuid AS id,
    e.object_id AS from_id,
    t.object_id AS to_id,
    c.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || r.model) || ' v'::text) || r.revision AS source,
    r.model,
    r.revision,
    r.related AS global_id,
    r.relating AS type_global_id,
    c.project_id
   FROM ifc_rev_relationships r
     JOIN ifc_rev_current c ON c.model_revision_id = r.model_revision_id
     LEFT JOIN ifc_guid_node e ON e.ifc_guid = r.related AND e.project_id = c.project_id
     LEFT JOIN ifc_guid_node t ON t.ifc_guid = r.relating AND t.project_id = c.project_id
  WHERE r.rel_class = 'IfcRelDefinesByType'::text
UNION ALL
 SELECT relationships.id,
    relationships.from_id,
    relationships.to_id,
    relationships.valid_from,
    relationships.valid_until,
    relationships.source,
    NULL::text AS model,
    NULL::integer AS revision,
    NULL::text AS global_id,
    NULL::text AS type_global_id,
    relationships.project_id
   FROM relationships
  WHERE relationships.rel_type = 'rel_defines_by_type'::text AND rel_is_aim_layer(relationships.source);

create or replace view public.rel_associates_classification as
WITH cref AS (
         SELECT classification_references.identification,
            (array_agg(classification_references.id))[1] AS id
           FROM classification_references
          GROUP BY classification_references.identification
         HAVING count(*) = 1
        )
 SELECT md5((((((r.model || '|'::text) || r.revision) || '|IfcRelAssociatesClassification|'::text) || r.relating) || '|'::text) || r.related)::uuid AS id,
    e.object_id AS from_id,
    k.id AS to_id,
    c.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || r.model) || ' v'::text) || r.revision AS source,
    r.model,
    r.revision,
    r.related AS global_id,
    r.relating AS classification_key,
    c.project_id
   FROM ifc_rev_relationships r
     JOIN ifc_rev_current c ON c.model_revision_id = r.model_revision_id
     LEFT JOIN ifc_guid_node e ON e.ifc_guid = r.related AND e.project_id = c.project_id
     LEFT JOIN cref k ON r.relating_class = 'IfcClassificationReference'::text AND k.identification = substr(r.relating, length(r.relating_class) + 2)
  WHERE r.rel_class = 'IfcRelAssociatesClassification'::text
UNION ALL
 SELECT relationships.id,
    relationships.from_id,
    relationships.to_id,
    relationships.valid_from,
    relationships.valid_until,
    relationships.source,
    NULL::text AS model,
    NULL::integer AS revision,
    NULL::text AS global_id,
    NULL::text AS classification_key,
    relationships.project_id
   FROM relationships
  WHERE relationships.rel_type = 'rel_associates_classification'::text AND rel_is_aim_layer(relationships.source);

create or replace view public.rel_associates_document as
WITH doc AS (
         SELECT o.project_id,
            o.ifc_type AS cls,
            d.identification,
            (array_agg(o.id))[1] AS id
           FROM objects o
             JOIN documents d ON d.id = o.id
          WHERE o.valid_until IS NULL AND (o.object_type = ANY (ARRAY['document'::text, 'document_reference'::text])) AND d.identification IS NOT NULL
          GROUP BY o.project_id, o.ifc_type, d.identification
         HAVING count(*) = 1
        )
 SELECT md5((((((r.model || '|'::text) || r.revision) || '|IfcRelAssociatesDocument|'::text) || r.relating) || '|'::text) || r.related)::uuid AS id,
    e.object_id AS from_id,
    d.id AS to_id,
    'document'::text AS role,
    c.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || r.model) || ' v'::text) || r.revision AS source,
    r.model,
    r.revision,
    r.related AS global_id,
    r.relating AS document_key,
    c.project_id
   FROM ifc_rev_relationships r
     JOIN ifc_rev_current c ON c.model_revision_id = r.model_revision_id
     LEFT JOIN ifc_guid_node e ON e.ifc_guid = r.related AND e.project_id = c.project_id
     LEFT JOIN doc d ON d.project_id = c.project_id AND d.cls = r.relating_class AND d.identification = substr(r.relating, length(r.relating_class) + 2)
  WHERE r.rel_class = 'IfcRelAssociatesDocument'::text
UNION ALL
 SELECT relationships.id,
    relationships.from_id,
    relationships.to_id,
    relationships.role,
    relationships.valid_from,
    relationships.valid_until,
    relationships.source,
    NULL::text AS model,
    NULL::integer AS revision,
    NULL::text AS global_id,
    NULL::text AS document_key,
    relationships.project_id
   FROM relationships
  WHERE relationships.rel_type = 'rel_associates_document'::text AND rel_is_aim_layer(relationships.source);

create or replace view public.ifc_storey_map as
WITH floors AS (
         SELECT o.id,
            o.project_id,
            o.object_ref,
            o.name,
            ifc_np_key(COALESCE(o.name, o.object_ref)) AS np,
                CASE
                    WHEN (o.properties #>> '{Pset_BuildingStoreyCommon,ElevationOfFFLRelative}'::text[]) ~ '^-?\d+(\.\d+)?$'::text THEN (o.properties #>> '{Pset_BuildingStoreyCommon,ElevationOfFFLRelative}'::text[])::numeric
                    ELSE NULL::numeric
                END AS elevation
           FROM objects o
          WHERE o.object_type = 'floor'::text AND o.valid_until IS NULL
        ), storeys AS (
         SELECT o.model,
            o.revision,
            o.global_id,
            c.project_id,
            o.model_revision_id,
            o.attributes ->> 'Name'::text AS name,
            ifc_np_key(o.attributes ->> 'Name'::text) AS np,
                CASE
                    WHEN (o.attributes ->> 'Elevation'::text) ~ '^-?\d+(\.\d+)?$'::text THEN (o.attributes ->> 'Elevation'::text)::numeric
                    ELSE NULL::numeric
                END AS elevation
           FROM ifc_rev_objects o
             JOIN ifc_rev_current c ON c.model_revision_id = o.model_revision_id
          WHERE o.ifc_class = 'IfcBuildingStorey'::text
        ), matched AS (
         SELECT s.model,
            s.revision,
            s.global_id,
            s.project_id,
            s.model_revision_id,
            s.name,
            s.np,
            s.elevation,
            own.object_id AS own_id,
            ( SELECT count(*) AS count
                   FROM floors f_1
                  WHERE s.np IS NOT NULL AND f_1.np = s.np AND f_1.project_id = s.project_id) AS np_count,
            ( SELECT f_1.id
                   FROM floors f_1
                  WHERE s.np IS NOT NULL AND f_1.np = s.np AND f_1.project_id = s.project_id
                  ORDER BY f_1.object_ref
                 LIMIT 1) AS np_id
           FROM storeys s
             LEFT JOIN ifc_guid_node own ON own.ifc_guid = s.global_id AND own.project_id = s.project_id AND own.object_type = 'floor'::text
        ), resolved AS (
         SELECT m.model,
            m.revision,
            m.global_id,
            m.project_id,
            m.model_revision_id,
            m.name,
            m.np,
            m.elevation,
            m.own_id,
            m.np_count,
            m.np_id,
                CASE
                    WHEN m.own_id IS NOT NULL THEN m.own_id
                    WHEN m.np_count = 1 THEN m.np_id
                    ELSE NULL::uuid
                END AS floor_id,
                CASE
                    WHEN m.own_id IS NOT NULL THEN 'guid'::text
                    WHEN m.np_count = 1 THEN 'name_number'::text
                    ELSE NULL::text
                END AS match_rule,
                CASE
                    WHEN m.own_id IS NOT NULL OR m.np_count = 1 THEN NULL::text
                    WHEN m.np IS NULL THEN 'no_number_in_name'::text
                    WHEN m.np_count = 0 THEN 'no_floor_for_number'::text
                    ELSE 'ambiguous_floors'::text
                END AS reason
           FROM matched m
        )
 SELECT r.model,
    r.revision,
    r.global_id,
    r.name,
    r.elevation,
    r.floor_id AS to_id,
    f.object_ref AS floor_ref,
    f.name AS floor_name,
    r.match_rule,
    r.reason,
    f.elevation AS floor_elevation,
        CASE
            WHEN r.floor_id IS NULL OR r.elevation IS NULL OR f.elevation IS NULL THEN 'unknown'::text
            WHEN abs(r.elevation - f.elevation) <= 1::numeric THEN 'match'::text
            ELSE 'mismatch'::text
        END AS elevation_check,
    r.project_id,
    r.model_revision_id
   FROM resolved r
     LEFT JOIN floors f ON f.id = r.floor_id;

create or replace view public.rel_contained_in_spatial_structure as
WITH rev AS (
         SELECT ifc_rev_current.model,
            ifc_rev_current.revision,
            ifc_rev_current.finished_at,
            ifc_rev_current.project_id,
            ifc_rev_current.model_revision_id
           FROM ifc_rev_current
        ), node AS (
         SELECT h.ifc_guid,
            h.object_id,
            o.object_type,
            o.project_id
           FROM ifc_guid_history h
             JOIN objects o ON o.id = h.object_id AND o.valid_until IS NULL
          WHERE h.valid_until IS NULL
        ), direct AS (
         SELECT r.model,
            r.revision,
            rev.project_id,
            r.model_revision_id,
            rev.finished_at,
            r.relating,
            r.relating_class,
            r.related,
            NULL::text AS via
           FROM ifc_rev_relationships r
             JOIN rev ON rev.model_revision_id = r.model_revision_id
          WHERE r.rel_class = 'IfcRelContainedInSpatialStructure'::text
        ), part AS (
         SELECT d.model,
            d.revision,
            d.project_id,
            d.model_revision_id,
            d.finished_at,
            d.relating,
            d.relating_class,
            a.related,
            d.related AS via
           FROM direct d
             JOIN ifc_rev_relationships a ON a.model_revision_id = d.model_revision_id AND a.rel_class = 'IfcRelAggregates'::text AND a.relating = d.related
             JOIN node n ON n.ifc_guid = a.related AND n.project_id = d.project_id AND n.object_type = 'asset'::text
          WHERE NOT (EXISTS ( SELECT 1
                   FROM direct x
                  WHERE x.model_revision_id = d.model_revision_id AND x.related = a.related))
        ), pairs AS (
         SELECT direct.model,
            direct.revision,
            direct.project_id,
            direct.model_revision_id,
            direct.finished_at,
            direct.relating,
            direct.relating_class,
            direct.related,
            direct.via
           FROM direct
        UNION ALL
         SELECT part.model,
            part.revision,
            part.project_id,
            part.model_revision_id,
            part.finished_at,
            part.relating,
            part.relating_class,
            part.related,
            part.via
           FROM part
        )
 SELECT md5((((((p.model || '|'::text) || p.revision) || '|'::text) || p.relating) || '|'::text) || p.related)::uuid AS id,
    e.object_id AS from_id,
    COALESCE(s.object_id, m.to_id) AS to_id,
    p.finished_at AS valid_from,
    NULL::timestamp with time zone AS valid_until,
    (('ifc:'::text || p.model) || ' v'::text) || p.revision AS source,
    p.model,
    p.revision,
    p.related AS global_id,
    p.relating AS container_global_id,
    p.via AS via_global_id,
    p.project_id
   FROM pairs p
     LEFT JOIN node e ON e.ifc_guid = p.related AND e.project_id = p.project_id
     LEFT JOIN node s ON s.ifc_guid = p.relating AND s.project_id = p.project_id
     LEFT JOIN ifc_storey_map m ON s.object_id IS NULL AND p.relating_class = 'IfcBuildingStorey'::text AND m.model_revision_id = p.model_revision_id AND m.global_id = p.relating;

create or replace view public.rel_assigns_to_actor as
SELECT id,
    from_id,
    to_id,
    role,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_assigns_to_actor'::text;

create or replace view public.rel_member_of as
SELECT id,
    from_id,
    to_id,
    role,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_member_of'::text;

create or replace view public.rel_referenced_in_spatial_structure as
SELECT id,
    from_id,
    to_id,
    role,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_referenced_in_spatial_structure'::text;

create or replace view public.rel_space_boundary as
SELECT id,
    from_id,
    to_id,
    role,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_space_boundary'::text;

create or replace view public.rel_document_information_relationship as
SELECT id,
    from_id,
    to_id,
    role,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_document_information_relationship'::text;

create or replace view public.rel_external_reference_relationship as
SELECT id,
    from_id,
    to_id,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'rel_external_reference_relationship'::text;

create or replace view public.aim_rel_capture_located as
SELECT id,
    from_id,
    to_id,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'aim_rel_capture_located'::text;

create or replace view public.aim_rel_capture_media as
SELECT id,
    from_id,
    to_id,
    valid_from,
    valid_until,
    source,
    project_id
   FROM relationships
  WHERE rel_type = 'aim_rel_capture_media'::text;

create or replace view public.v_actors as
select x.*, o.project_id as project_id
from (
SELECT id,
    object_type,
    object_ref,
    name,
    ifc_guid,
    ifc_type,
    predefined_type,
    user_defined_type,
    properties,
    created_at,
    updated_at
   FROM objects
  WHERE (object_type = ANY (ARRAY['person'::text, 'organization'::text])) AND valid_until IS NULL
) x
left join objects o on o.id = x.id;

create or replace view public.v_asset_effective as
select x.*, o.project_id as project_id
from (
SELECT occ.id,
    occ.object_ref,
    occ.name,
    occ.ifc_type,
        CASE
            WHEN typ.predefined_type IS NOT NULL AND typ.predefined_type <> 'NOTDEFINED'::text THEN typ.predefined_type
            ELSE occ.predefined_type
        END AS predefined_type,
        CASE
            WHEN typ.predefined_type IS NOT NULL AND typ.predefined_type <> 'NOTDEFINED'::text THEN typ.user_defined_type
            ELSE occ.user_defined_type
        END AS user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties) AS properties,
    typ.id AS type_id,
    typ.name AS type_name
   FROM objects occ
     LEFT JOIN rel_defines_by_type r ON r.from_id = occ.id AND r.valid_until IS NULL
     LEFT JOIN objects typ ON typ.id = r.to_id
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL
) x
left join objects o on o.id = x.id;

create or replace view public.v_floors as
select x.*, o.project_id as project_id
from (
SELECT o.id,
    o.object_type,
    o.object_ref,
    o.name,
    o.ifc_guid,
    o.ifc_type,
    o.predefined_type,
    o.user_defined_type,
    o.properties,
    o.created_at,
    o.updated_at,
    f.elevation
   FROM objects o
     JOIN floors f USING (id)
  WHERE o.valid_until IS NULL
) x
left join objects o on o.id = x.id;

create or replace view public.v_spaces as
select x.*, o.project_id as project_id
from (
SELECT o.id,
    o.object_type,
    o.object_ref,
    o.name,
    o.ifc_guid,
    o.ifc_type,
    o.predefined_type,
    o.user_defined_type,
    o.properties,
    o.created_at,
    o.updated_at,
    s.long_name
   FROM objects o
     JOIN spaces s USING (id)
  WHERE o.valid_until IS NULL
) x
left join objects o on o.id = x.id;

create or replace view public.v_asset_classifications as
select x.*, o.project_id as project_id
from (
SELECT occ.id AS object_id,
    rc.to_id AS classification_ref_id,
    'occurrence'::text AS level
   FROM objects occ
     JOIN rel_associates_classification rc ON rc.from_id = occ.id AND rc.valid_until IS NULL
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL
UNION
 SELECT occ.id AS object_id,
    rc.to_id AS classification_ref_id,
    'type'::text AS level
   FROM objects occ
     JOIN rel_defines_by_type dt ON dt.from_id = occ.id AND dt.valid_until IS NULL
     JOIN rel_associates_classification rc ON rc.from_id = dt.to_id AND rc.valid_until IS NULL
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL
) x
left join objects o on o.id = x.object_id;

create or replace view public.v_space_elements as
select x.*, o.project_id as project_id
from (
SELECT c.to_id AS space_id,
    s.object_ref AS space_ref,
    s.name AS space_name,
    sp.long_name AS space_long_name,
    c.from_id AS element_id,
    e.object_ref AS element_ref,
    e.name AS element_name,
    e.ifc_type AS element_ifc_type,
    e.predefined_type AS element_predefined_type,
    'contained'::text AS relation,
    NULL::text AS role,
    c.source
   FROM rel_contained_in_spatial_structure c
     JOIN objects s ON s.id = c.to_id AND s.object_type = 'space'::text
     LEFT JOIN spaces sp ON sp.id = s.id
     JOIN objects e ON e.id = c.from_id
  WHERE c.valid_until IS NULL
UNION ALL
 SELECT r.to_id AS space_id,
    s.object_ref AS space_ref,
    s.name AS space_name,
    sp.long_name AS space_long_name,
    r.from_id AS element_id,
    e.object_ref AS element_ref,
    e.name AS element_name,
    e.ifc_type AS element_ifc_type,
    e.predefined_type AS element_predefined_type,
    'referenced'::text AS relation,
    r.role,
    r.source
   FROM rel_referenced_in_spatial_structure r
     JOIN objects s ON s.id = r.to_id AND s.object_type = 'space'::text
     LEFT JOIN spaces sp ON sp.id = s.id
     JOIN objects e ON e.id = r.from_id
  WHERE r.valid_until IS NULL
UNION ALL
 SELECT b.to_id AS space_id,
    s.object_ref AS space_ref,
    s.name AS space_name,
    sp.long_name AS space_long_name,
    b.from_id AS element_id,
    e.object_ref AS element_ref,
    e.name AS element_name,
    e.ifc_type AS element_ifc_type,
    e.predefined_type AS element_predefined_type,
    'boundary'::text AS relation,
    b.role,
    b.source
   FROM rel_space_boundary b
     JOIN objects s ON s.id = b.to_id AND s.object_type = 'space'::text
     LEFT JOIN spaces sp ON sp.id = s.id
     JOIN objects e ON e.id = b.from_id
  WHERE b.valid_until IS NULL AND NOT (EXISTS ( SELECT 1
           FROM rel_contained_in_spatial_structure c
          WHERE c.from_id = b.from_id AND c.to_id = b.to_id AND c.valid_until IS NULL)) AND NOT (EXISTS ( SELECT 1
           FROM rel_referenced_in_spatial_structure r
          WHERE r.from_id = b.from_id AND r.to_id = b.to_id AND r.valid_until IS NULL))
) x
left join objects o on o.id = x.space_id;

create or replace view public.v_zone_elements as
select x.*, o.project_id as project_id
from (
WITH RECURSIVE zone_spaces(zone_id, space_id) AS (
         SELECT g.to_id,
            g.from_id
           FROM rel_assigns_to_group g
             JOIN objects s_1 ON s_1.id = g.from_id AND s_1.object_type = 'space'::text AND s_1.valid_until IS NULL
             JOIN objects z_1 ON z_1.id = g.to_id AND z_1.object_type = 'zone'::text AND z_1.valid_until IS NULL
          WHERE g.valid_until IS NULL
        UNION
         SELECT parent.to_id,
            zs_1.space_id
           FROM zone_spaces zs_1
             JOIN rel_assigns_to_group parent ON parent.from_id = zs_1.zone_id AND parent.valid_until IS NULL
             JOIN objects pz ON pz.id = parent.to_id AND pz.object_type = 'zone'::text AND pz.valid_until IS NULL
        ), element_spaces AS (
         SELECT c.from_id AS element_id,
            c.to_id AS space_id,
            'contained'::text AS relation,
            NULL::text AS role,
            c.source
           FROM rel_contained_in_spatial_structure c
          WHERE c.valid_until IS NULL
        UNION ALL
         SELECT r.from_id,
            r.to_id,
            'referenced'::text AS text,
            r.role,
            r.source
           FROM rel_referenced_in_spatial_structure r
          WHERE r.valid_until IS NULL
        )
 SELECT zs.zone_id,
    z.object_ref AS zone_ref,
    z.name AS zone_name,
    es.element_id,
    e.object_ref AS element_ref,
    e.name AS element_name,
    e.ifc_type AS element_ifc_type,
    e.predefined_type AS element_predefined_type,
    zs.space_id AS via_space_id,
    s.object_ref AS via_space_ref,
    es.relation,
    es.role,
    es.source
   FROM zone_spaces zs
     JOIN element_spaces es ON es.space_id = zs.space_id
     JOIN objects e ON e.id = es.element_id AND e.object_type = 'asset'::text AND e.valid_until IS NULL
     JOIN objects z ON z.id = zs.zone_id
     JOIN objects s ON s.id = zs.space_id
  WHERE (EXISTS ( SELECT 1
           FROM derivation_rules
          WHERE derivation_rules.id = 'element_in_zone'::text AND derivation_rules.enabled))
) x
left join objects o on o.id = x.zone_id;

create or replace view public.v_object_documents as
select x.*, o.project_id as project_id
from (
WITH RECURSIVE members(member_id, parent_id, via_space_id) AS MATERIALIZED (
         SELECT g.from_id,
            g.to_id,
            NULL::uuid AS uuid
           FROM rel_assigns_to_group g
          WHERE g.valid_until IS NULL
        UNION ALL
         SELECT a.from_id,
            a.to_id,
            NULL::uuid AS uuid
           FROM rel_aggregates a
             JOIN objects p ON p.id = a.to_id AND (p.object_type = ANY (ARRAY['group'::text, 'spatial_zone'::text]))
          WHERE a.valid_until IS NULL
        UNION ALL
         SELECT t_1.from_id,
            t_1.to_id,
            NULL::uuid AS uuid
           FROM rel_defines_by_type t_1
          WHERE t_1.valid_until IS NULL
        UNION ALL
         SELECT r.from_id,
            r.to_id,
            NULL::uuid AS uuid
           FROM rel_referenced_in_spatial_structure r
             JOIN objects p ON p.id = r.to_id AND p.object_type = 'spatial_zone'::text
          WHERE r.valid_until IS NULL
        UNION ALL
         SELECT ze.element_id,
            ze.zone_id,
            ze.via_space_id
           FROM v_zone_elements ze
        UNION ALL
         SELECT c.from_id,
            c.to_id,
            NULL::uuid AS uuid
           FROM rel_contained_in_spatial_structure c
             JOIN objects e ON e.id = c.from_id AND e.object_type = 'asset'::text
             JOIN objects p ON p.id = c.to_id AND (p.object_type = ANY (ARRAY['floor'::text, 'space'::text]))
          WHERE c.valid_until IS NULL
        UNION ALL
         SELECT r.from_id,
            r.to_id,
                CASE
                    WHEN p.object_type = 'space'::text THEN r.to_id
                    ELSE NULL::uuid
                END AS "case"
           FROM rel_referenced_in_spatial_structure r
             JOIN objects e ON e.id = r.from_id AND e.object_type = 'asset'::text
             JOIN objects p ON p.id = r.to_id AND (p.object_type = ANY (ARRAY['floor'::text, 'space'::text]))
          WHERE r.valid_until IS NULL
        ), walk(object_id, holder_id, via_space_id, depth, path) AS (
         SELECT h_1.id,
            h_1.id,
            NULL::uuid AS uuid,
            0 AS "?column?",
            ARRAY[h_1.id] AS "array"
           FROM objects h_1
          WHERE h_1.valid_until IS NULL AND (EXISTS ( SELECT 1
                   FROM rel_associates_document ad_1
                  WHERE ad_1.from_id = h_1.id AND ad_1.valid_until IS NULL AND ad_1.source <> 'pdf_link (E4)'::text))
        UNION ALL
         SELECT m.member_id,
            w_1.holder_id,
            COALESCE(m.via_space_id, w_1.via_space_id) AS "coalesce",
            w_1.depth + 1,
            w_1.path || m.member_id
           FROM walk w_1
             JOIN objects wo ON wo.id = w_1.object_id AND (wo.object_type = ANY (ARRAY['zone'::text, 'group'::text, 'spatial_zone'::text, 'system'::text, 'asset_type'::text, 'floor'::text, 'space'::text]))
             JOIN members m ON m.parent_id = w_1.object_id
             JOIN objects mo ON mo.id = m.member_id AND mo.valid_until IS NULL
          WHERE w_1.depth < 6 AND NOT (m.member_id = ANY (w_1.path))
        )
 SELECT w.object_id,
    ob.object_type,
    ob.object_ref,
    COALESCE(d.referenced_document_id, ad.to_id) AS document_id,
        CASE
            WHEN t.object_type = 'document_reference'::text THEN ad.to_id
            ELSE NULL::uuid
        END AS reference_id,
        CASE
            WHEN t.object_type = 'document_reference'::text THEN COALESCE("substring"(d.location, '#.*page=([0-9]+)'::text), "substring"(d.identification, '^page=([0-9]+)'::text))::integer
            ELSE NULL::integer
        END AS page,
        CASE
            WHEN w.depth = 0 THEN 'direct'::text
            WHEN h.object_type = 'asset_type'::text THEN 'type'::text
            ELSE h.object_type
        END AS via,
        CASE
            WHEN w.depth = 0 THEN NULL::uuid
            ELSE w.holder_id
        END AS via_id,
        CASE
            WHEN w.depth = 0 THEN NULL::uuid
            ELSE w.path[array_length(w.path, 1) - 1]
        END AS via_nearest_id,
    w.via_space_id,
    w.depth,
    w.path,
    ad.role,
    ad.source
   FROM walk w
     JOIN objects ob ON ob.id = w.object_id
     JOIN objects h ON h.id = w.holder_id
     JOIN rel_associates_document ad ON ad.from_id = w.holder_id AND ad.valid_until IS NULL AND ad.source <> 'pdf_link (E4)'::text
     JOIN objects t ON t.id = ad.to_id AND t.valid_until IS NULL
     LEFT JOIN documents d ON d.id = ad.to_id AND t.object_type = 'document_reference'::text
) x
left join objects o on o.id = x.object_id;

create or replace view public.v_property_dictionary as
SELECT o.object_type,
    o.ifc_type,
    p.key AS pset,
    a.key AS property,
    jsonb_typeof(a.value) AS value_type,
    count(*)::integer AS object_count,
    count(DISTINCT a.value)::integer AS distinct_values,
    (array_agg(DISTINCT "left"(a.value #>> '{}'::text[], 60)))[1:5] AS sample_values,
    min(
        CASE
            WHEN jsonb_typeof(a.value) = 'number'::text THEN (a.value #>> '{}'::text[])::numeric
            ELSE NULL::numeric
        END) AS min_number,
    max(
        CASE
            WHEN jsonb_typeof(a.value) = 'number'::text THEN (a.value #>> '{}'::text[])::numeric
            ELSE NULL::numeric
        END) AS max_number,
    o.project_id
   FROM objects o
     CROSS JOIN LATERAL jsonb_each(o.properties) p(key, value)
     CROSS JOIN LATERAL jsonb_each(p.value) a(key, value)
  WHERE o.valid_until IS NULL AND p.key !~ '^_'::text AND jsonb_typeof(p.value) = 'object'::text
  GROUP BY o.project_id, o.object_type, o.ifc_type, p.key, a.key, (jsonb_typeof(a.value));

create or replace view public.v_container_revisions as
SELECT c.id AS container_id,
    c.identification,
    c.name,
    c.container_type,
    c.model,
    c.document_id,
    r.id AS revision_id,
    r.revision,
    r.revision_no,
    r.parent_revision_no,
    r.revision_no = max(r.revision_no) OVER (PARTITION BY c.id) AS is_latest,
    r.status,
    r.change_action,
    r.state,
    r.approval,
    own.person_name AS owning_user,
    own.organization_name AS owning_organization,
    ed.person_name AS last_modifying_user,
    ed.organization_name AS last_modifying_organization,
    oa.application_full_name AS owning_application,
    la.application_full_name AS last_modifying_application,
    r.creation_time,
    r.last_revision_time,
    COALESCE(r.electronic_format, c.electronic_format) AS electronic_format,
    r.location,
    r.sha256,
    r.size_bytes,
    r.file_header,
    r.recipe_ref,
    r.task_id,
    r.commit_sha,
    r.model_revision_id,
    c.project_id
   FROM information_containers c
     JOIN container_revisions r ON r.container_id = c.id
     LEFT JOIN ifc_actor own ON own.id = c.document_owner_id
     LEFT JOIN ifc_actor ed ON ed.id = r.editors_id
     LEFT JOIN ifc_application oa ON oa.id = r.owning_application_id
     LEFT JOIN ifc_application la ON la.id = r.last_modifying_application_id;

create or replace view public.v_ids_latest as
WITH latest AS (
         SELECT DISTINCT ON (r_1.project_id, (COALESCE(v.document_id::text, 't:'::text || r_1.ids_title)), r_1.model_label) r_1.id,
            r_1.project_id,
            r_1.ids_title,
            r_1.ids_version,
            r_1.ids_sha256,
            r_1.ids_source,
            r_1.model_label,
            r_1.model_file,
            r_1.specs_total,
            r_1.specs_passed,
            r_1.results_total,
            r_1.results_failed,
            r_1.checked_at,
            r_1.ids_version_id,
            r_1.engine,
            r_1.binding,
            r_1.trigger,
            r_1.model_revisions,
            r_1.engine_version,
            r_1.created_by,
            d.code AS ids_code,
            v.version AS ids_doc_version,
            v.document_id AS ids_document_id
           FROM ids_runs r_1
             LEFT JOIN ids_document_versions v ON v.id = r_1.ids_version_id
             LEFT JOIN ids_documents d ON d.id = v.document_id
          ORDER BY r_1.project_id, (COALESCE(v.document_id::text, 't:'::text || r_1.ids_title)), r_1.model_label, r_1.checked_at DESC, r_1.id
        )
 SELECT r.id,
    l.id AS run_id,
    l.ids_title,
    l.model_label,
    l.checked_at,
    r.spec_identifier,
    r.spec_name,
    r.status,
    r.reasons,
    r.object_id,
    o.object_ref,
    o.name,
    COALESCE(o.ifc_type, r.ifc_type) AS ifc_type,
    r.ifc_guid,
    l.ids_code,
    l.ids_doc_version,
    l.engine,
    l.binding,
    NULLIF(l.model_revisions, '{}'::jsonb) AS based_on,
    project_revisions_stale(l.project_id, l.model_revisions) AS stale,
        CASE
            WHEN l.ids_document_id IS NULL THEN NULL::boolean
            ELSE (EXISTS ( SELECT 1
               FROM ids_document_versions n
              WHERE n.document_id = l.ids_document_id AND n.version > l.ids_doc_version))
        END AS ids_stale,
    l.engine_version,
    l.project_id
   FROM latest l
     JOIN ids_results r ON r.run_id = l.id
     LEFT JOIN objects o ON o.id = r.object_id;

create or replace view public.v_ids_summary as
SELECT ids_title,
    model_label,
    checked_at,
    spec_identifier,
    spec_name,
    count(*) FILTER (WHERE ifc_guid IS NOT NULL) AS elements,
    count(*) FILTER (WHERE ifc_guid IS NOT NULL AND status = 'pass'::text) AS passed,
    count(*) FILTER (WHERE status = 'fail'::text) AS failed,
    (array_agg(reasons[1]) FILTER (WHERE status = 'fail'::text))[1] AS example_reason,
    ids_code,
    ids_doc_version,
    engine,
    binding,
    based_on,
    stale,
    ids_stale,
    engine_version,
    project_id
   FROM v_ids_latest
  GROUP BY project_id, ids_title, model_label, checked_at, spec_identifier, spec_name, ids_code, ids_doc_version, engine, binding, based_on, stale, ids_stale, engine_version;

create or replace view public.v_verification_latest as
SELECT DISTINCT ON (u.project_id, r.model, r.global_id, r.recipe) r.id,
    r.run_id,
    u.created_at AS checked_at,
    r.model,
    r.revision,
    r.global_id,
    r.element_name,
    r.target,
    r.recipe,
    r.status,
    r.file_value,
    r.computed_value,
    r.method,
    r.definition,
    r.spec_ref,
    r.tolerance,
    r.formula,
    r.note,
    r.distinct_heights,
    r.anchors,
    u.registry_version,
    u.engine,
    NULLIF(u.model_revisions, '{}'::jsonb) AS based_on,
    project_revisions_stale(u.project_id, u.model_revisions) AS stale,
    r.inputs,
    r.explanation,
    u.project_id
   FROM verification_results r
     JOIN verification_runs u ON u.id = r.run_id
  ORDER BY u.project_id, r.model, r.global_id, r.recipe, u.created_at DESC, r.id;

create or replace view public.v_clash_latest as
WITH latest AS (
         SELECT DISTINCT ON (r.test_id) r.id,
            r.test_id,
            r.test_code,
            r.rules_snapshot,
            r.models,
            r.engine,
            r.trigger,
            r.completeness,
            r.summary,
            r.coverage,
            r.created_by,
            r.created_at,
            r.model_revisions
           FROM clash_runs r
          WHERE r.test_id IS NOT NULL
          ORDER BY r.test_id, r.created_at DESC, r.id
        )
 SELECT c.id,
    l.id AS run_id,
    t.code AS test_code,
    t.name AS test_name,
    l.created_at AS run_at,
    l.trigger,
    l.engine,
    c.clash_key,
    c.rule,
    c.status,
    c.severity,
    c.distance,
    c.storey,
    c.center,
    c.a_guid,
    c.a_model,
    c.a_ifc_type,
    c.a_name,
    oa.object_ref AS a_object_ref,
    sa.name AS a_system,
    c.b_guid,
    c.b_model,
    c.b_ifc_type,
    c.b_name,
    ob.object_ref AS b_object_ref,
    sb.name AS b_system,
    COALESCE(rv.status, 'open'::text) AS review_status,
    rv.comment AS review_comment,
    rv.bcf_topic_id,
    mt.number AS bcf_topic_number,
    NULLIF(l.model_revisions, '{}'::jsonb) AS based_on,
    project_revisions_stale(t.project_id, l.model_revisions) AS stale,
    t.project_id
   FROM latest l
     JOIN clash_tests t ON t.id = l.test_id
     JOIN clash_results c ON c.run_id = l.id
     LEFT JOIN clash_reviews rv ON rv.test_id = l.test_id AND rv.clash_key = c.clash_key
     LEFT JOIN model_tasks mt ON mt.id = rv.bcf_topic_id
     LEFT JOIN LATERAL ( SELECT o.id,
            o.object_ref
           FROM ifc_guid_history h
             JOIN objects o ON o.id = h.object_id AND o.project_id = t.project_id
          WHERE h.ifc_guid = c.a_guid AND h.valid_until IS NULL
         LIMIT 1) oa ON true
     LEFT JOIN LATERAL ( SELECT o.id,
            o.object_ref
           FROM ifc_guid_history h
             JOIN objects o ON o.id = h.object_id AND o.project_id = t.project_id
          WHERE h.ifc_guid = c.b_guid AND h.valid_until IS NULL
         LIMIT 1) ob ON true
     LEFT JOIN LATERAL ( SELECT s.name
           FROM rel_assigns_to_group g
             JOIN objects s ON s.id = g.to_id AND s.object_type = 'system'::text AND s.valid_until IS NULL
          WHERE g.from_id = oa.id AND g.valid_until IS NULL
          ORDER BY s.name
         LIMIT 1) sa ON true
     LEFT JOIN LATERAL ( SELECT s.name
           FROM rel_assigns_to_group g
             JOIN objects s ON s.id = g.to_id AND s.object_type = 'system'::text AND s.valid_until IS NULL
          WHERE g.from_id = ob.id AND g.valid_until IS NULL
          ORDER BY s.name
         LIMIT 1) sb ON true;

create or replace view public.v_clash_summary as
WITH latest AS (
         SELECT DISTINCT ON (r.test_id) r.id,
            r.test_id,
            r.test_code,
            r.rules_snapshot,
            r.models,
            r.engine,
            r.trigger,
            r.completeness,
            r.summary,
            r.coverage,
            r.created_by,
            r.created_at,
            r.model_revisions
           FROM clash_runs r
          WHERE r.test_id IS NOT NULL
          ORDER BY r.test_id, r.created_at DESC, r.id
        )
 SELECT t.code AS test_code,
    t.name AS test_name,
    l.id AS run_id,
    l.created_at AS run_at,
    c.rule,
    c.storey,
    COALESCE(rv.status, 'open'::text) AS review_status,
    count(*) AS clashes,
    count(*) FILTER (WHERE c.status = 'hard'::text) AS hard,
    count(*) FILTER (WHERE c.status = 'clearance'::text) AS clearance,
    count(*) FILTER (WHERE c.severity = 'critical'::text) AS critical,
    count(*) FILTER (WHERE c.severity = 'major'::text) AS major,
    count(*) FILTER (WHERE c.severity = 'minor'::text) AS minor,
    count(*) FILTER (WHERE c.severity = 'info'::text) AS info,
    NULLIF(l.model_revisions, '{}'::jsonb) AS based_on,
    project_revisions_stale(t.project_id, l.model_revisions) AS stale,
    t.project_id
   FROM latest l
     JOIN clash_tests t ON t.id = l.test_id
     JOIN clash_results c ON c.run_id = l.id
     LEFT JOIN clash_reviews rv ON rv.test_id = l.test_id AND rv.clash_key = c.clash_key
  GROUP BY t.project_id, t.code, t.name, l.id, l.created_at, l.model_revisions, c.rule, c.storey, (COALESCE(rv.status, 'open'::text));

-- ---------------------------------------------------------------------------
-- RPCs: new trailing parameter p_project. Its default (OCB) is transitional, so the
-- deployed app keeps working; the cleanup migration makes it required.
-- ---------------------------------------------------------------------------

drop function public.search_everything(text, text[], integer);
CREATE OR REPLACE FUNCTION public.search_everything(q text, object_types text[] DEFAULT NULL::text[], max_rows integer DEFAULT 20, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS TABLE(id uuid, object_type text, object_ref text, name text, ifc_type text, predefined_type text, score real, match_kind text, headline text, matched_properties jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
  with nq as (
    select lower(f_unaccent(btrim(q))) as t
  ),
  words as (
    select w
    from regexp_split_to_table((select t from nq), '\s+') as w
    where length(w) >= 2
  ),
  fts as (
    select o.id,
           ts_rank(to_tsvector('simple', o.search_text),
                   websearch_to_tsquery('simple', (select t from nq))) as r
    from objects o
    where length((select t from nq)) >= 2
      and to_tsvector('simple', o.search_text)
          @@ websearch_to_tsquery('simple', (select t from nq))
  ),
  trgm as (
    select o.id, word_similarity((select t from nq), o.search_text) as s
    from objects o
    where length((select t from nq)) >= 2
      and (select t from nq) <% o.search_text
  ),
  ranked as (
    select coalesce(f.id, t.id) as id,
           -- FTS zásah vždy nad čisto fuzzy zásahom (+1.0), v rámci vetvy ranking
           (coalesce(t.s, 0)
            + case when f.id is not null then 1.0 + coalesce(f.r, 0) else 0 end)::real
             as score,
           case when f.id is not null then 'fulltext' else 'fuzzy' end as match_kind
    from fts f
    full join trgm t using (id)
  )
  select o.id, o.object_type, o.object_ref, o.name, o.ifc_type, o.predefined_type,
         r.score, r.match_kind,
         case when r.match_kind = 'fulltext'
              then ts_headline('simple', o.search_text,
                     websearch_to_tsquery('simple', (select t from nq)),
                     'MaxFragments=2, MaxWords=12, MinWords=4')
              end as headline,
         -- Dôkaz pre trust loop: ktoré psety/properties nesú hľadané slovo
         -- (lateral len nad vrátenými riadkami — lacné pri row-cape 50).
         (select jsonb_agg(m) from (
            select jsonb_build_object('pset', p.key, 'property', a.key,
                                      'value', a.value) as m
            from jsonb_each(o.properties) p
            cross join lateral jsonb_each(p.value) a
            where p.key !~ '^_'
              and jsonb_typeof(p.value) = 'object'
              and exists (
                select 1 from words w
                where lower(f_unaccent(p.key || ' ' || a.key || ' ' || (a.value #>> '{}')))
                      like '%' || w.w || '%')
            limit 3
          ) sub) as matched_properties
  from ranked r
  join objects o on o.id = r.id
  where o.valid_until is null
    and o.project_id = p_project
    and (object_types is null or o.object_type = any(object_types))
  order by r.score desc
  limit least(greatest(coalesce(max_rows, 20), 1), 50);
$function$;

drop function public.search_documents(text, integer, uuid);
CREATE OR REPLACE FUNCTION public.search_documents(q text, max_rows integer DEFAULT 10, doc_id uuid DEFAULT NULL::uuid, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS TABLE(document_id uuid, document_ref text, document_name text, page integer, rank real, snippet text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with nq as (
    select lower(f_unaccent(btrim(q))) as t
  ),
  -- Slová dopytu ako prefixy (rovnaký parser ako index). Slovo z písmen od 6
  -- znakov stratí posledné 2 (hrubá náhrada stemmingu pre skloňovanie):
  -- "poziarna odolnost" nájde "poziarnej odolnosti", "keramick" aj "keramicke".
  -- Kódy a čísla (dd01, ei30, 1.05) ostávajú celé.
  tq as (
    select to_tsquery('simple', string_agg(
             quote_literal(case when lexeme ~ '^[a-z]+$' and length(lexeme) >= 6
                                then left(lexeme, length(lexeme) - 2)
                                else lexeme end) || ':*',
             ' & ')) as query
    from unnest(to_tsvector('simple', (select t from nq)))
  )
  select dp.document_id,
         o.object_ref,
         o.name,
         dp.page,
         ts_rank(to_tsvector('simple', lower(f_unaccent(dp.text))),
                 (select query from tq))::real as rank,
         ts_headline('simple', lower(f_unaccent(dp.text)),
                     (select query from tq),
                     'MaxFragments=2, MaxWords=14, MinWords=4') as snippet
  from document_pages dp
  join objects o on o.id = dp.document_id
  where o.valid_until is null
    and o.project_id = p_project
    and (doc_id is null or dp.document_id = doc_id)
    and length((select t from nq)) >= 2
    and (select query from tq) is not null
    and to_tsvector('simple', lower(f_unaccent(dp.text))) @@ (select query from tq)
  order by rank desc, dp.page
  limit least(greatest(coalesce(max_rows, 10), 1), 50);
$function$;

drop function public.aggregate_objects(text, text, text[], text, text[], jsonb, uuid[], integer, boolean);
CREATE OR REPLACE FUNCTION public.aggregate_objects(relation text DEFAULT 'objects'::text, agg text DEFAULT 'count'::text, prop_path text[] DEFAULT NULL::text[], group_by text DEFAULT NULL::text, group_by_path text[] DEFAULT NULL::text[], filters jsonb DEFAULT '[]'::jsonb, ids uuid[] DEFAULT NULL::uuid[], max_groups integer DEFAULT 50, return_rows boolean DEFAULT false, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  allowed_cols constant text[] := array[
    'object_type','ifc_type','predefined_type','user_defined_type','name','object_ref'];
  numeric_re constant text := '^-?[0-9]+(\.[0-9]+)?$';
  f jsonb;
  col text;
  op text;
  op_sql text;
  fpath text[];
  path_lit text;
  fval_expr text;
  where_parts text[] := array['true'];  -- project filter added below
  val_expr text := null;   -- textová hodnota prop_path
  num_expr text := null;   -- guarded numeric cast prop_path
  agg_expr text;
  key_expr text := null;
  where_clause text;
  q text;
  total_rows bigint;
  result jsonb;
begin
  -- ── whitelisty ──────────────────────────────────────────────────────────
  if relation not in ('objects', 'v_asset_effective') then
    raise exception 'relation ''%'' nie je povolená (objects | v_asset_effective)', relation;
  end if;
  if p_project is null then raise exception 'aggregate_objects: p_project is required'; end if;
  where_parts := where_parts || format('project_id = %L::uuid', p_project);
  -- zaniknuté objekty (D-087); v_asset_effective ich filtruje sám
  if relation = 'objects' then
    where_parts := where_parts || 'valid_until is null'::text;
  end if;
  if agg not in ('count', 'sum', 'avg', 'min', 'max') then
    raise exception 'agg ''%'' nie je povolený (count|sum|avg|min|max)', agg;
  end if;
  if agg <> 'count' and (prop_path is null or coalesce(array_length(prop_path, 1), 0) = 0) then
    raise exception 'agg ''%'' vyžaduje prop_path (cesta v properties)', agg;
  end if;
  if group_by is not null and group_by_path is not null then
    raise exception 'group_by a group_by_path sú vzájomne výlučné';
  end if;
  max_groups := least(greatest(coalesce(max_groups, 50), 1), 50);

  -- ── prop_path výrazy ────────────────────────────────────────────────────
  if prop_path is not null and coalesce(array_length(prop_path, 1), 0) > 0 then
    select string_agg(format('%L', e), ',') into path_lit from unnest(prop_path) e;
    val_expr := format('nullif(properties #>> array[%s]::text[], '''')', path_lit);
    num_expr := format('(case when %s ~ %L then (%s)::numeric end)',
                       val_expr, numeric_re, val_expr);
  end if;

  -- ── filtre (AND) ────────────────────────────────────────────────────────
  for f in select * from jsonb_array_elements(coalesce(filters, '[]'::jsonb)) loop
    op := f ->> 'op';
    op_sql := case op
      when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
      when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
    if op is null or (op_sql is null and op not in ('ilike', 'is')) then
      raise exception 'filter op ''%'' nie je povolený (eq|neq|gt|gte|lt|lte|ilike|is)', op;
    end if;

    if f ? 'column' then
      col := f ->> 'column';
      if not (col = any (allowed_cols)) then
        raise exception 'filter column ''%'' nie je povolený (%)', col,
          array_to_string(allowed_cols, ', ');
      end if;
      if op = 'is' then
        where_parts := where_parts || format('%I is %s', col,
          case when f ->> 'value' is null or f ->> 'value' = 'null'
               then 'null' else 'not null' end);
      elsif op = 'ilike' then
        where_parts := where_parts || format('%I ilike %L', col, f ->> 'value');
      else
        where_parts := where_parts || format('%I %s %L', col, op_sql, f ->> 'value');
      end if;

    elsif f ? 'path' then
      select array_agg(x.e) into fpath from jsonb_array_elements_text(f -> 'path') x(e);
      if fpath is null or coalesce(array_length(fpath, 1), 0) = 0 then
        raise exception 'filter path je prázdny';
      end if;
      select string_agg(format('%L', e), ',') into path_lit from unnest(fpath) e;
      fval_expr := format('nullif(properties #>> array[%s]::text[], '''')', path_lit);
      if op in ('gt', 'gte', 'lt', 'lte') then
        -- numericky bezpečné porovnanie (dôvod existencie tejto RPC)
        if f ->> 'value' is null or (f ->> 'value') !~ numeric_re then
          raise exception 'filter %/% vyžaduje číselnú value, dostal ''%''',
            array_to_string(fpath, '.'), op, f ->> 'value';
        end if;
        where_parts := where_parts || format(
          '(case when %s ~ %L then (%s)::numeric end) %s %L::numeric',
          fval_expr, numeric_re, fval_expr, op_sql, f ->> 'value');
      elsif op = 'is' then
        where_parts := where_parts || format('%s is %s', fval_expr,
          case when f ->> 'value' is null or f ->> 'value' = 'null'
               then 'null' else 'not null' end);
      elsif op = 'ilike' then
        where_parts := where_parts || format('%s ilike %L', fval_expr, f ->> 'value');
      else
        where_parts := where_parts || format('%s %s %L', fval_expr, op_sql, f ->> 'value');
      end if;

    else
      raise exception 'filter musí mať column alebo path';
    end if;
  end loop;

  if ids is not null then
    where_parts := where_parts || format('id = any (%L::uuid[])', ids);
  end if;
  where_clause := array_to_string(where_parts, ' and ');

  -- ── režim: riadky s hodnotou (escape hatch pre číselné filtre) ──────────
  if return_rows then
    -- riadky bez prop_path hodnoty sú šum → implicitný not-null (keď je cesta zadaná)
    if val_expr is not null then
      where_clause := where_clause || format(' and %s is not null', val_expr);
    end if;
    q := format(
      'select coalesce(jsonb_agg(r), ''[]''::jsonb) from (
         select jsonb_build_object(
           ''id'', id, ''object_ref'', object_ref, ''name'', name,
           ''object_type'', %s, ''value'', %s) as r
         from %I where %s order by %s desc nulls last limit 50) t',
      -- v_asset_effective nemá object_type stĺpec — je to vždy asset
      case when relation = 'objects' then 'object_type' else quote_literal('asset') end,
      coalesce(val_expr, 'null'), relation, where_clause, coalesce(num_expr, '1'));
    execute q into result;
    return jsonb_build_object('mode', 'rows', 'rows', result,
                              'row_count', jsonb_array_length(result));
  end if;

  -- ── agregát ─────────────────────────────────────────────────────────────
  agg_expr := case
    when agg = 'count' and val_expr is null then 'count(*)'
    when agg = 'count' then format('count(%s)', val_expr)
    else format('%s(%s)', agg, num_expr) end;

  execute format('select count(*) from %I where %s', relation, where_clause)
    into total_rows;

  if group_by is null and group_by_path is null then
    q := format(
      'select jsonb_build_object(
         ''mode'', ''aggregate'', ''agg'', %L, ''value'', %s,
         ''total_rows'', %s::bigint,
         ''skipped_non_numeric'', %s)
       from %I where %s',
      agg, agg_expr, total_rows,
      case when num_expr is null then '0'
           else format('count(*) filter (where %s is not null and %s is null)',
                       val_expr, num_expr) end,
      relation, where_clause);
    execute q into result;
    return result;
  end if;

  -- ── group by ────────────────────────────────────────────────────────────
  if group_by is not null then
    if not (group_by = any (allowed_cols)) then
      raise exception 'group_by ''%'' nie je povolený (%)', group_by,
        array_to_string(allowed_cols, ', ');
    end if;
    key_expr := format('%I', group_by);
  else
    select string_agg(format('%L', e), ',') into path_lit from unnest(group_by_path) e;
    key_expr := format('properties #>> array[%s]::text[]', path_lit);
  end if;

  q := format(
    'select jsonb_build_object(
       ''mode'', ''aggregate'', ''agg'', %L,
       ''groups'', coalesce(jsonb_agg(
           jsonb_build_object(''key'', k, ''value'', v, ''count'', c)), ''[]''::jsonb),
       ''groups_returned'', count(*),
       ''total_rows'', %s::bigint,
       ''skipped_non_numeric'', coalesce(sum(sk), 0))
     from (
       select %s as k, %s as v, count(*) as c,
              %s as sk
       from %I where %s
       group by 1
       order by v desc nulls last
       limit %s) g',
    agg, total_rows, key_expr, agg_expr,
    case when num_expr is null then '0'
         else format('count(*) filter (where %s is not null and %s is null)',
                     val_expr, num_expr) end,
    relation, where_clause, max_groups);
  execute q into result;
  return result;
end;
$function$;

drop function public.ifc_rev_compare(text, integer, integer);
drop function public.ifc_rev_storey_elements(text, integer, text, text);
drop function public.ifc_rev_resolve(text, integer);
CREATE OR REPLACE FUNCTION public.ifc_rev_resolve(p_model text, p_revision integer DEFAULT NULL::integer, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare r integer;
begin
  r := coalesce(p_revision, (select revision from model_revisions where project_id = p_project and model = p_model and is_current));
  if r is null then raise exception 'Model % nemá revíziu', p_model; end if;
  if not exists (select 1 from ifc_rev_imports i join model_revisions m on m.id = i.model_revision_id
                  where m.project_id = p_project and m.model = p_model and m.revision = r and i.status = 'done') then
    raise exception 'Revízia % v% nemá hotovú kópiu v DB (python -m etl.revision_copy --model % --revision %)', p_model, r, p_model, r;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.ifc_rev_storey_elements(p_model text, p_revision integer, p_storey text, p_system text DEFAULT NULL::text, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS TABLE(global_id text, ifc_class text, name text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with rev as (select z.r, ifc_rev_revision_id(p_project, p_model, z.r) as mid from (select ifc_rev_resolve(p_model, p_revision, p_project) as r) z),
  storey as (
    select o.global_id from ifc_rev_objects o, rev
    where o.model_revision_id = rev.mid and o.ifc_class = 'IfcBuildingStorey'
      and (o.global_id = p_storey or o.attributes ->> 'Name' = p_storey)
  ),
  contained as (
    select rr.related from ifc_rev_relationships rr, rev
    where rr.model_revision_id = rev.mid and rr.rel_class = 'IfcRelContainedInSpatialStructure'
      and rr.relating in (select global_id from storey)
  )
  select o.global_id, o.ifc_class, o.attributes ->> 'Name'
  from ifc_rev_objects o, rev
  where o.model_revision_id = rev.mid and o.global_id in (select related from contained)
    and (p_system is null or exists (
      select 1 from ifc_rev_relationships g
      join ifc_rev_objects s on s.model_revision_id = g.model_revision_id and s.global_id = g.relating
      where g.model_revision_id = rev.mid and g.rel_class = 'IfcRelAssignsToGroup'
        and g.related = o.global_id and s.attributes ->> 'Name' ilike p_system
    ))
  order by o.ifc_class, o.global_id
$function$;

CREATE OR REPLACE FUNCTION public.ifc_rev_compare(p_model text, p_from integer, p_to integer, p_project uuid DEFAULT '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid)
 RETURNS TABLE(global_id text, ifc_class text, change_action text, aspects jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  f as (select z.r, ifc_rev_revision_id(p_project, p_model, z.r) as mid from (select ifc_rev_resolve(p_model, p_from, p_project) as r) z),
  t as (select z.r, ifc_rev_revision_id(p_project, p_model, z.r) as mid from (select ifc_rev_resolve(p_model, p_to, p_project) as r) z),
  o_from as (select o.* from ifc_rev_objects o, f where o.model_revision_id = f.mid),
  o_to   as (select o.* from ifc_rev_objects o, t where o.model_revision_id = t.mid),
  objs as (
    select coalesce(b.global_id, a.global_id) as global_id, coalesce(b.ifc_class, a.ifc_class) as ifc_class,
           a.global_id is not null as in_from, b.global_id is not null as in_to,
           case when a.global_id is not null and b.global_id is not null and a.content_hash <> b.content_hash
                then jsonb_changed_keys(a.attributes, b.attributes) end as attr_keys
    from o_from a full join o_to b on b.global_id = a.global_id
  ),
  p_from_ as (select p.* from ifc_rev_property_sets p, f where p.model_revision_id = f.mid),
  p_to_   as (select p.* from ifc_rev_property_sets p, t where p.model_revision_id = t.mid),
  pset_diff as (
    select coalesce(b.global_id, a.global_id) as global_id,
           array_agg(x order by x) as items
    from p_from_ a
    full join p_to_ b on b.global_id = a.global_id and b.pset_name = a.pset_name
    cross join lateral unnest(
      case
        when a.global_id is null then array[b.pset_name || ' (+)']
        when b.global_id is null then array[a.pset_name || ' (-)']
        else (select array_agg(a.pset_name || '.' || k) from unnest(jsonb_changed_keys(a.properties, b.properties)) k)
      end
    ) x
    where a.content_hash is distinct from b.content_hash
    group by 1
  ),
  r_from as (select r.* from ifc_rev_relationships r, f where r.model_revision_id = f.mid),
  r_to   as (select r.* from ifc_rev_relationships r, t where r.model_revision_id = t.mid),
  rel_diff as (
    select coalesce(b.related, a.related) as global_id,
           array_agg(case when a.related is null then '+' when b.related is null then '-' else '~' end
                     || coalesce(b.rel_class, a.rel_class) || ':' || coalesce(b.relating, a.relating)
                     order by coalesce(b.rel_class, a.rel_class), coalesce(b.relating, a.relating)) as items
    from r_from a
    full join r_to b on b.rel_class = a.rel_class and b.relating = a.relating and b.related = a.related
    where a.content_hash is distinct from b.content_hash
    group by 1
  ),
  changed as (
    select o.global_id, o.ifc_class,
           case when not o.in_from then 'ADDED' when not o.in_to then 'DELETED' else 'MODIFIED' end as change_action,
           case when o.in_from and o.in_to then
             jsonb_strip_nulls(jsonb_build_object(
               'attributes', case when cardinality(o.attr_keys) > 0 then to_jsonb(o.attr_keys) end,
               'psets', to_jsonb(pd.items),
               'relations', to_jsonb(rd.items)))
           end as aspects
    from objs o
    left join pset_diff pd on pd.global_id = o.global_id
    left join rel_diff rd on rd.global_id = o.global_id
    where not o.in_from or not o.in_to or cardinality(o.attr_keys) > 0 or pd.items is not null or rd.items is not null
  ),
  via_type as (
    select o.global_id, o.ifc_class, 'NOCHANGE'::text as change_action,
           jsonb_build_object('via_type', r.relating, 'note', 'changed via type') as aspects
    from r_to r
    join changed c on c.global_id = r.relating and c.change_action = 'MODIFIED'
    join objs o on o.global_id = r.related and o.in_from and o.in_to
    where r.rel_class = 'IfcRelDefinesByType'
      and not exists (select 1 from changed c2 where c2.global_id = r.related)
  )
  select * from changed
  union all
  select * from via_type
  order by 3, 2, 1
$function$;

CREATE OR REPLACE FUNCTION public.icdd_apply_import(p_import uuid, p_aim_state text, p_changes jsonb)
 RETURNS icdd_imports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  imp icdd_imports;
  ch jsonb;
  rid uuid;
  written uuid[] := '{}';
  closed uuid[] := '{}';
  src text;
begin
  select * into imp from icdd_imports where id = p_import for update;
  if not found then raise exception 'icdd_apply_import: import % neexistuje', p_import; end if;
  if imp.status <> 'checked' then raise exception 'icdd_apply_import: import % má stav %', p_import, imp.status; end if;
  if imp.aim_state_sha256 <> p_aim_state then raise exception 'icdd_apply_import: stav AIM sa od náhľadu zmenil'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'icdd_apply_import: changes nie je pole'; end if;
  if exists (select 1 from jsonb_array_elements(p_changes) where coalesce(value->>'op', '') not in ('add', 'close')) then
    raise exception 'icdd_apply_import: neznáma operácia';
  end if;
  src := 'icdd:' || imp.version_id;

  for ch in select * from jsonb_array_elements(p_changes) where value->>'op' = 'close' loop
    update relationships set valid_until = now()
     where id = (ch->>'id')::uuid and rel_type = 'rel_associates_document' and valid_until is null and rel_is_aim_layer(source)
     returning id into rid;
    if rid is null then raise exception 'icdd_apply_import: väzba % nie je živá väzba AIM vrstvy', ch->>'id'; end if;
    closed := closed || rid;
    rid := null;
  end loop;

  for ch in select * from jsonb_array_elements(p_changes) where value->>'op' = 'add' loop
    if exists (select 1 from relationships
                where rel_type = 'rel_associates_document' and valid_until is null
                  and from_id = (ch->>'from_id')::uuid and to_id = (ch->>'to_id')::uuid) then
      raise exception 'icdd_apply_import: väzba % -> % už existuje', ch->>'from_id', ch->>'to_id';
    end if;
    insert into relationships (rel_type, from_id, to_id, role, source, project_id)
    values ('rel_associates_document', (ch->>'from_id')::uuid, (ch->>'to_id')::uuid, 'document', src, imp.project_id)
    returning id into rid;
    written := written || rid;
  end loop;

  update icdd_imports
     set status = 'applied', applied_at = now(), written_ids = written, closed_ids = closed
   where id = p_import
   returning * into imp;
  return imp;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants (D-026, D-079): new and recreated functions only for service_role
-- ---------------------------------------------------------------------------

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'project_model_revisions_at', 'project_revisions_stale', 'project_engine_model_revisions',
       'ifc_rev_revision_id', 'container_for_model', 'model_revisions_container',
       'ifc_rev_fill_model_revision_id', 'objects_project_scope', 'georef_stamp', 'georef_stamp_item',
       'search_everything', 'search_documents', 'aggregate_objects',
       'ifc_rev_resolve', 'ifc_rev_storey_elements', 'ifc_rev_compare', 'icdd_apply_import')
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on column public.objects.project_id is
  'D-189: project (IfcProject node) the node belongs to; NULL only for global person/organization; a project node points at itself';
comment on column public.relationships.project_id is
  'D-189: derived by relationships_validate from the endpoints; NULL for edges between global nodes';
comment on column public.model_revisions.container_id is
  'D-189: model identity (information_containers.id); the model code is a label unique within a project';
comment on column public.ifc_rev_imports.model_revision_id is
  'D-189: key of the revision copy (model_revisions.id); model and revision stay as labels';

reset lock_timeout;
