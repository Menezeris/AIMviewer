-- D-182 (#351): requirements library in AIM by a deliberate assignment to a project.
-- APPLIED to production 2. 11. (Samuel "migration yes", orchestrator).
-- Additive, without changing existing rows. Depends on 20261023180000_ids_documents.sql and
-- 20261030120000_information_containers.sql (`revisions_stale`, `information_containers`).
--
-- * A library IDS version (`source = 'import'`) carries its origin in the library: repo, path, commit and file code at the time of
--   the assignment; `author` = who assigned, `created_at` = when. The copy is immutable (trigger D-162), a change = a new version.
-- * `ids_document_models` = a manual link of an IDS to a federation model (many to many); cancelling ends the link, does not delete.
-- * `ids_runs`: tool version (`engine_version`) and who saved the run (`created_by`); a run from the viewer has `trigger = 'viewer'`.
--   The model revision sha256 is not stored, it is in `model_revisions` at (model, revision).
-- * `v_ids_latest`, `v_ids_summary`: at the end `ids_stale` (the IDS has a newer version in AIM than the one the run ran over) and
--   `engine_version`. `stale` (newer model revision) stays unchanged.
-- anon/authenticated get no rights on new objects (default privileges, migration 20261016120000).
-- Rollback: drop table if exists ids_document_models; alter table ids_runs drop column if exists engine_version,
--   drop column if exists created_by; alter table ids_document_versions drop constraint if exists
--   ids_document_versions_library_ref_check, drop column if exists library_repo, drop column if exists library_path,
--   drop column if exists library_commit, drop column if exists library_code; v_ids_* views from 20261030120000.

begin;

-- ---------------------------------------------------------------------------
-- Origin of a library IDS version
-- ---------------------------------------------------------------------------
alter table ids_document_versions
  add column library_repo   text,   -- Menezeris/assetin-library
  add column library_path   text,   -- ids/ER-0101_ARCH.ids
  add column library_commit text,   -- sha of the commit the file was assigned from
  add column library_code   text;   -- code (file name without .ids) at the time of assignment; the IDS code in AIM may change

-- A new version from the library must carry its origin; old rows (before D-182) are not checked.
alter table ids_document_versions
  add constraint ids_document_versions_library_ref_check
  check (source <> 'import' or (library_repo is not null and library_path is not null and library_commit is not null))
  not valid;

create index on ids_document_versions (library_repo, library_path, library_commit) where library_path is not null;

comment on column ids_document_versions.library_commit is
  'D-182: commit knižnice, z ktorého sa IDS priradilo k projektu (author = kto, created_at = kedy).';

-- ---------------------------------------------------------------------------
-- Manual link IDS <-> federation model
-- ---------------------------------------------------------------------------
create table ids_document_models (
  id                        uuid primary key default gen_random_uuid(),
  document_id               uuid not null references ids_documents (id) on delete cascade,
  information_container_id  uuid not null references information_containers (id) on delete cascade,
  library_container         text,                     -- optionally the library container (e.g. IU-C-arch-model), entered by a person
  created_by                text not null,
  valid_from                timestamptz not null default now(),
  valid_until               timestamptz,
  ended_by                  text,
  check (valid_until is null or valid_until >= valid_from),
  check (valid_until is null or ended_by is not null)
);
create unique index uniq_ids_document_models_active
  on ids_document_models (document_id, information_container_id) where valid_until is null;
create index on ids_document_models (information_container_id) where valid_until is null;

-- Link only to an IFC container (federation model); an ended link no longer changes.
create function ids_document_models_guard() returns trigger language plpgsql as $$
declare kind text;
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
  select container_type into kind from information_containers where id = new.information_container_id;
  if kind is distinct from 'IFC' then
    raise exception 'IDS sa viaže len na model federácie (IFC kontajner)';
  end if;
  return new;
end $$;
create trigger ids_document_models_guard
  before insert or update on ids_document_models
  for each row execute function ids_document_models_guard();

comment on table ids_document_models is
  'D-182: ručná väzba IDS na model federácie (mnoho na mnoho); zrušenie = valid_until, nič sa nemaže.';

revoke all on ids_document_models from anon, authenticated;
grant all on ids_document_models to service_role;

-- ---------------------------------------------------------------------------
-- Runs: tool version and who saved
-- ---------------------------------------------------------------------------
alter table ids_runs
  add column engine_version text,   -- e.g. @ifc-lite/ids 1.2.3 (in the fork for a run from the viewer)
  add column created_by     text;   -- name from the viewer dialog or the author in chat

-- ---------------------------------------------------------------------------
-- Views: `ids_stale` and `engine_version` at the end (old columns unchanged)
-- ---------------------------------------------------------------------------
create or replace view v_ids_latest as
  with latest as (
    select distinct on (coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label)
           r.*, d.code as ids_code, v.version as ids_doc_version, v.document_id as ids_document_id
    from ids_runs r
    left join ids_document_versions v on v.id = r.ids_version_id
    left join ids_documents d on d.id = v.document_id
    order by coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label, r.checked_at desc, r.id
  )
  select r.id, l.id as run_id, l.ids_title, l.model_label, l.checked_at,
         r.spec_identifier, r.spec_name, r.status, r.reasons,
         r.object_id, o.object_ref, o.name, coalesce(o.ifc_type, r.ifc_type) as ifc_type, r.ifc_guid,
         l.ids_code, l.ids_doc_version, l.engine, l.binding,
         nullif(l.model_revisions, '{}'::jsonb) as based_on, revisions_stale(l.model_revisions) as stale,
         case when l.ids_document_id is null then null
              else exists (select 1 from ids_document_versions n
                           where n.document_id = l.ids_document_id and n.version > l.ids_doc_version)
         end as ids_stale,
         l.engine_version
  from latest l
  join ids_results r on r.run_id = l.id
  left join objects o on o.id = r.object_id;

create or replace view v_ids_summary as
  select ids_title, model_label, checked_at, spec_identifier, spec_name,
         count(*) filter (where ifc_guid is not null)                     as elements,
         count(*) filter (where ifc_guid is not null and status = 'pass') as passed,
         count(*) filter (where status = 'fail')                          as failed,
         (array_agg(reasons[1]) filter (where status = 'fail'))[1]        as example_reason,
         ids_code, ids_doc_version, engine, binding, based_on, stale,
         ids_stale, engine_version
  from v_ids_latest
  group by ids_title, model_label, checked_at, spec_identifier, spec_name,
           ids_code, ids_doc_version, engine, binding, based_on, stale, ids_stale, engine_version;

commit;
