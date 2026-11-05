-- D-189 cleanup (platform step 3, decision 3): remove what the multi-project migration
-- 20261104233000 kept for the old app and ETL. The app (#417) and the ETL (#416) write project_id
-- themselves since 5 Nov; the callers inventory is in the PR.
--
-- What this migration does:
--   1. drops the DEFAULT OCB of every project_id column, so a row without a project is an error;
--   2. RPCs: p_project loses its DEFAULT OCB. It keeps DEFAULT NULL only because parameters before it
--      have defaults (Postgres needs a default after a defaulted parameter); NULL raises
--      "p_project is required";
--   3. drops the old global unique keys (the per-project keys of 20261104233000 stay);
--   4. drops the OCB wrappers of the old function signatures;
--   5. drops the triggers that filled model_revision_id from (model, revision); model_revisions
--      needs container_id from its writer (the trigger only checks it);
--   6. drops the (model, revision) indexes of the revision copy (no reader left);
--   7. library release: drops the old library_vydaj and publikuj_ids without the project (the project
--      versions come from 20261105115915_library_release_project.sql);
--   8. BCF topic numbers per project: counter table bcf_topic_counters, filled by a trigger.
--      Existing numbers do not change; OCB continues after its highest number.
--
-- Applied only after Samuel's yes, a fresh backup and a restore test (D-189, handoff brief).
-- Rollback: restore from that backup. A hand rollback would have to re-create the identity on
-- model_tasks.number and the old keys; not worth the risk.

set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. No DEFAULT project on the columns
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'objects', 'information_containers', 'model_revisions', 'model_tasks', 'saved_views', 'clash_tests',
    'clash_runs', 'ids_documents', 'ids_runs', 'derivation_runs', 'verification_runs', 'icdd_imports',
    'drawing_link_overrides', 'ifc_guid_aliases'
  ] loop
    execute format('alter table public.%I alter column project_id drop default', t);
  end loop;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and column_name = 'project_id' and column_default is not null) then
    raise exception 'D-189 cleanup: a project_id column still has a default';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. RPCs: no DEFAULT OCB on p_project; a NULL project is an error
-- ---------------------------------------------------------------------------

create or replace function public.project_required(p_project uuid, p_caller text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_project is null then
    raise exception '%: p_project is required (D-189)', p_caller;
  end if;
  return p_project;
end $$;

-- The six RPCs keep their bodies; only the default changes and a guard is added in front of the
-- body. SQL functions get a first statement, plpgsql functions a first line after "begin"
-- (aggregate_objects already has its own check).
do $$
declare
  r record;
  def text;
  old_default constant text := 'p_project uuid DEFAULT ''9e2dfcba-437b-43d3-a925-0dd29f195b38''::uuid';
  n int := 0;
begin
  for r in
    select p.oid, p.proname, l.lanname
      from pg_proc p
      join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace
       and pg_get_function_arguments(p.oid) like '%' || old_default || '%'
  loop
    def := replace(pg_get_functiondef(r.oid), old_default, 'p_project uuid DEFAULT NULL::uuid');
    if r.lanname = 'sql' then
      if position(E'AS $function$\n' in def) = 0 then
        raise exception 'D-189 cleanup: unexpected body of %', r.proname;
      end if;
      def := replace(def, E'AS $function$\n',
                     format(E'AS $function$\nselect public.project_required(p_project, %L);\n', r.proname));
    elsif position('p_project is required' in def) = 0 then
      if def !~ E'\nbegin\n' then
        raise exception 'D-189 cleanup: unexpected body of %', r.proname;
      end if;
      def := regexp_replace(def, E'\nbegin\n',
                            format(E'\nbegin\n  perform public.project_required(p_project, %L);\n', r.proname));
    end if;
    execute def;
    n := n + 1;
  end loop;
  if n <> 6 then
    raise exception 'D-189 cleanup: expected 6 RPCs with the DEFAULT OCB, found %', n;
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and pg_get_function_arguments(p.oid) like '%9e2dfcba-437b-43d3-a925-0dd29f195b38%') then
    raise exception 'D-189 cleanup: a function still defaults to OCB';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Old global unique keys (the per-project keys stay)
-- ---------------------------------------------------------------------------

alter table public.information_containers drop constraint information_containers_model_key;
alter table public.information_containers drop constraint information_containers_identification_key;
alter table public.model_revisions drop constraint model_revisions_model_revision_key;
drop index public.uniq_current_model_revision;
alter table public.ifc_rev_imports drop constraint ifc_rev_imports_model_revision_key;
alter table public.clash_tests drop constraint clash_tests_code_key;
alter table public.ids_documents drop constraint ids_documents_code_key;
drop index public.uniq_model_tasks_number;
drop index public.uniq_saved_views_name;
drop index public.uniq_saved_views_last;
drop index public.uniq_active_guid_alias;

-- ---------------------------------------------------------------------------
-- 4. OCB wrappers of the old signatures (no view, function or code calls them)
-- ---------------------------------------------------------------------------

drop function public.model_revisions_at(timestamptz);
drop function public.revisions_stale(jsonb);
drop function public.engine_model_revisions(jsonb);
drop function public.container_for_model(text);
drop function public.georef_stamp(jsonb, jsonb, uuid, boolean);
drop function public.georef_stamp_item(jsonb, jsonb, text, boolean);

-- ---------------------------------------------------------------------------
-- 5. Writers carry the ids: no lookup by (model, revision)
-- ---------------------------------------------------------------------------

-- The revision copy: revision_copy writes model_revision_id itself; the lookup by (model, revision)
-- would be ambiguous as soon as two projects use the same code.
drop trigger trg_ifc_rev_imports_model_revision on public.ifc_rev_imports;
drop trigger trg_ifc_rev_objects_model_revision on public.ifc_rev_objects;
drop trigger trg_ifc_rev_property_sets_model_revision on public.ifc_rev_property_sets;
drop trigger trg_ifc_rev_relationships_model_revision on public.ifc_rev_relationships;
drop function public.ifc_rev_fill_model_revision_id();

-- model_revisions: model_publish sets container_id; the trigger only checks that it is the model's
-- container in the row's project.
create or replace function public.model_revisions_container()
returns trigger
language plpgsql
as $$
begin
  if new.container_id is null then
    raise exception 'model_revisions: container_id is required (D-189)';
  end if;
  if not exists (select 1 from information_containers
                  where id = new.container_id and project_id = new.project_id
                    and model is not distinct from new.model) then
    raise exception 'model_revisions: container % is not model % of project %', new.container_id, new.model, new.project_id;
  end if;
  return new;
end $$;

-- Document containers: identification is unique within the project (the global key is gone).
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
  if exists (select 1 from information_containers where project_id = d.project_id and identification = ident) then
    ident := coalesce(d.object_ref, d.id::text);
    if exists (select 1 from information_containers where project_id = d.project_id and identification = ident) then
      ident := d.id::text;
    end if;
  end if;
  insert into information_containers
    (identification, name, description, purpose, electronic_format, document_owner_id, container_type, document_id,
     project_id)
  values (ident, d.name, d.description, d.purpose, d.electronic_format, ifc_actor_for(d.document_owner),
          container_type_of(d.electronic_format, d.location), d.id, d.project_id)
  returning id into c;
  return c;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Indexes kept only for the old ETL's delete path by (model, revision)
-- ---------------------------------------------------------------------------

drop index public.idx_ifc_rev_objects_model_revision;
drop index public.idx_ifc_rev_property_sets_model_revision;
drop index public.idx_ifc_rev_relationships_model_revision;

-- ---------------------------------------------------------------------------
-- 7. Library release: the project versions were added by 20261105115915_library_release_project.sql;
--    the old signatures without the project go.
-- ---------------------------------------------------------------------------

drop function public.library_vydaj(text, text, text, text, text, jsonb, jsonb, jsonb);
drop function library.publikuj_ids(uuid, jsonb);

-- ---------------------------------------------------------------------------
-- 8. BCF topic numbers per project
-- ---------------------------------------------------------------------------

-- Last number per project. The insert trigger takes the next one under the row lock of
-- "on conflict do update", so two topics of one project never get the same number.
create table public.bcf_topic_counters (
  project_id  uuid primary key references public.objects(id) on delete cascade,
  last_number bigint not null check (last_number >= 0)
);
alter table public.bcf_topic_counters enable row level security;
comment on table public.bcf_topic_counters is
  'D-189: last BCF topic number (model_tasks.number) per project; written only by the model_tasks insert trigger';

-- Seed: every project continues after its highest number. OCB also continues after the last value of
-- the old global identity, so no number it ever handed out comes back.
do $$
declare seq_last bigint := 0; seq text;
begin
  seq := pg_get_serial_sequence('public.model_tasks', 'number');
  if seq is not null then
    execute format('select case when is_called then last_value else 0 end from %s', seq) into seq_last;
  end if;
  insert into public.bcf_topic_counters (project_id, last_number)
  select project_id, max(number) from public.model_tasks group by project_id;
  insert into public.bcf_topic_counters (project_id, last_number)
  values ('9e2dfcba-437b-43d3-a925-0dd29f195b38', seq_last)
  on conflict (project_id) do update set last_number = greatest(public.bcf_topic_counters.last_number, excluded.last_number);
end $$;

alter table public.model_tasks alter column number drop identity;
alter table public.model_tasks alter column number set not null;

create or replace function public.model_tasks_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.number is distinct from old.number or new.project_id is distinct from old.project_id then
      raise exception 'model_tasks: the number and project of a BCF topic do not change (D-189)';
    end if;
    return new;
  end if;
  if new.project_id is null then
    raise exception 'model_tasks: project_id is required (D-189)';
  end if;
  if new.number is not null then
    raise exception 'model_tasks: number is assigned per project, do not set it (D-189)';
  end if;
  insert into bcf_topic_counters as c (project_id, last_number) values (new.project_id, 1)
  on conflict (project_id) do update set last_number = c.last_number + 1
  returning c.last_number into new.number;
  return new;
end $$;

create trigger trg_model_tasks_number
  before insert or update of number, project_id on public.model_tasks
  for each row execute function public.model_tasks_number();

-- ---------------------------------------------------------------------------
-- 9. Grants (D-026, D-079): new and recreated objects only for service_role
-- ---------------------------------------------------------------------------

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where (p.pronamespace = 'public'::regnamespace and p.proname in (
              'project_required', 'search_everything', 'search_documents', 'aggregate_objects', 'ifc_rev_resolve',
              'ifc_rev_storey_elements', 'ifc_rev_compare', 'model_revisions_container', 'container_for_document',
              'library_vydaj', 'model_tasks_number'))
        or (p.pronamespace = 'library'::regnamespace and p.proname = 'publikuj_ids')
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  revoke all on table public.bcf_topic_counters from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.bcf_topic_counters from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table public.bcf_topic_counters to service_role;
  end if;
end $$;

-- Planner statistics for what changed (rule of the D-189 incident addendum, #420).
analyze public.model_tasks;
analyze public.bcf_topic_counters;
analyze public.information_containers;
analyze public.model_revisions;
analyze public.ids_documents;

comment on column public.model_tasks.number is
  'BCF topic.index, unique per project; assigned by trg_model_tasks_number from bcf_topic_counters (D-189)';

reset lock_timeout;
