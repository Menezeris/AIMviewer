-- D-182 (#351): knižnica požiadaviek v AIM vedomým priradením k projektu.
-- APLIKOVANÉ na produkciu 2. 11. (Samuel "migrácia áno", orchestrátor).
-- Aditívne, bez zmeny existujúcich riadkov. Závisí od 20261023180000_ids_documents.sql a
-- 20261030120000_information_containers.sql (`revisions_stale`, `information_containers`).
--
-- * Verzia knižničného IDS (`source = 'import'`) nesie pôvod v knižnici: repo, cesta, commit a kód súboru v čase
--   priradenia; `author` = kto priradil, `created_at` = kedy. Kópia je nemenná (trigger D-162), zmena = nová verzia.
-- * `ids_document_models` = ručná väzba IDS na model federácie (mnoho na mnoho); zrušenie väzbu ukončí, nemaže.
-- * `ids_runs`: verzia nástroja (`engine_version`) a kto beh uložil (`created_by`); beh z viewera má `trigger = 'viewer'`.
--   Sha256 revízie modelu sa neukladá, je v `model_revisions` pri (model, revízia).
-- * `v_ids_latest`, `v_ids_summary`: na konci `ids_stale` (IDS má v AIM novšiu verziu, než nad ktorou beh bežal) a
--   `engine_version`. `stale` (novšia revízia modelu) ostáva bez zmeny.
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).
-- Rollback: drop table if exists ids_document_models; alter table ids_runs drop column if exists engine_version,
--   drop column if exists created_by; alter table ids_document_versions drop constraint if exists
--   ids_document_versions_library_ref_check, drop column if exists library_repo, drop column if exists library_path,
--   drop column if exists library_commit, drop column if exists library_code; pohľady v_ids_* z 20261030120000.

begin;

-- ---------------------------------------------------------------------------
-- Pôvod verzie knižničného IDS
-- ---------------------------------------------------------------------------
alter table ids_document_versions
  add column library_repo   text,   -- Menezeris/assetin-library
  add column library_path   text,   -- ids/ER-0101_ARCH.ids
  add column library_commit text,   -- sha commitu, z ktorého sa súbor priradil
  add column library_code   text;   -- kód (meno súboru bez .ids) v čase priradenia; kód IDS v AIM sa môže zmeniť

-- Nová verzia z knižnice musí niesť pôvod; staré riadky (pred D-182) sa nekontrolujú.
alter table ids_document_versions
  add constraint ids_document_versions_library_ref_check
  check (source <> 'import' or (library_repo is not null and library_path is not null and library_commit is not null))
  not valid;

create index on ids_document_versions (library_repo, library_path, library_commit) where library_path is not null;

comment on column ids_document_versions.library_commit is
  'D-182: commit knižnice, z ktorého sa IDS priradilo k projektu (author = kto, created_at = kedy).';

-- ---------------------------------------------------------------------------
-- Ručná väzba IDS <-> model federácie
-- ---------------------------------------------------------------------------
create table ids_document_models (
  id                        uuid primary key default gen_random_uuid(),
  document_id               uuid not null references ids_documents (id) on delete cascade,
  information_container_id  uuid not null references information_containers (id) on delete cascade,
  library_container         text,                     -- voliteľne kontajner knižnice (napr. IU-C-arch-model), zadá človek
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

-- Väzba len na IFC kontajner (model federácie); ukončená väzba sa už nemení.
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
-- Behy: verzia nástroja a kto uložil
-- ---------------------------------------------------------------------------
alter table ids_runs
  add column engine_version text,   -- napr. @ifc-lite/ids 1.2.3 (vo forku pri behu z viewera)
  add column created_by     text;   -- meno z dialógu viewera alebo autor v chate

-- ---------------------------------------------------------------------------
-- Pohľady: `ids_stale` a `engine_version` na konci (staré stĺpce bez zmeny)
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
