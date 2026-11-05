-- D-182 (#351): origin of a library IDS version, manual link of an IDS to a model, ids_stale and engine_version in the views.
-- Run on a local DB with the migrations applied and supabase/pending/20261102120000_ids_library_assign.sql
-- (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ids_library_assign.sql
begin;
\ir _legacy_ocb.sql

insert into information_containers (id, identification, container_type, model) values
  ('00000000-0000-4000-8000-0000000000e1', 'T-ASR', 'IFC', 'T-ASR'),
  ('00000000-0000-4000-8000-0000000000e2', 'T-VZT', 'IFC', 'T-VZT');
insert into information_containers (id, identification, container_type) values
  ('00000000-0000-4000-8000-0000000000e3', 'T-PDF', 'PDF');

insert into ids_documents (id, code, title, origin, library_source) values
  ('00000000-0000-4000-8000-0000000000a1', 'T-ER-0101_ARCH', 'Knižnica', 'library', 'o/lib@c1:ids/T-ER-0101_ARCH.ids');
insert into ids_document_versions (id, document_id, version, xml, sha256, source, author, library_repo, library_path, library_commit, library_code) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 1, '<ids/>', 'h1', 'import', 'Samuel',
   'o/lib', 'ids/T-ER-0101_ARCH.ids', 'c1', 'T-ER-0101_ARCH');

do $$
declare n int;
begin
  -- verzia z knižnice bez pôvodu nejde
  begin
    insert into ids_document_versions (document_id, version, xml, sha256, source)
    values ('00000000-0000-4000-8000-0000000000a1', 2, '<ids/>', 'h2', 'import');
    raise exception 'import bez pôvodu prešiel';
  exception when check_violation then null;
  end;

  -- väzba na model: len IFC kontajner, jedna aktívna dvojica
  insert into ids_document_models (document_id, information_container_id, created_by, library_container)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'Samuel', 'IU-C-arch-model');
  insert into ids_document_models (document_id, information_container_id, created_by)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e2', 'Samuel');
  begin
    insert into ids_document_models (document_id, information_container_id, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'Iný');
    raise exception 'druhá aktívna väzba na ten istý model prešla';
  exception when unique_violation then null;
  end;
  begin
    insert into ids_document_models (document_id, information_container_id, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e3', 'Samuel');
    raise exception 'väzba na PDF prešla';
  exception when raise_exception then
    if sqlerrm not like 'IDS sa viaže len na model%' then raise; end if;
  end;
  -- väzba sa dá len ukončiť (s menom), potom sa nemení; nová väzba na ten istý model je nový riadok
  begin
    update ids_document_models set library_container = 'x' where information_container_id = '00000000-0000-4000-8000-0000000000e2';
    raise exception 'zmena väzby prešla';
  exception when raise_exception then
    if sqlerrm not like 'väzba IDS na model sa dá len ukončiť%' then raise; end if;
  end;
  begin
    update ids_document_models set valid_until = now() where information_container_id = '00000000-0000-4000-8000-0000000000e2';
    raise exception 'ukončenie bez mena prešlo';
  exception when check_violation then null;
  end;
  update ids_document_models set valid_until = now(), ended_by = 'Samuel'
   where information_container_id = '00000000-0000-4000-8000-0000000000e2' and valid_until is null;
  begin
    update ids_document_models set ended_by = 'Iný' where information_container_id = '00000000-0000-4000-8000-0000000000e2';
    raise exception 'zmena ukončenej väzby prešla';
  exception when raise_exception then
    if sqlerrm not like 'ukončená väzba%' then raise; end if;
  end;
  insert into ids_document_models (document_id, information_container_id, created_by)
  values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e2', 'Samuel');
  select count(*) into n from ids_document_models where valid_until is null;
  if n <> 2 then raise exception 'aktívnych väzieb: čakal som 2, je %', n; end if;
  select count(*) into n from ids_document_models;
  if n <> 3 then raise exception 'väzieb spolu (aj ukončená): čakal som 3, je %', n; end if;
end $$;

-- A run from the viewer over v1 with the tool trace; then a new IDS version in AIM -> ids_stale.
insert into ids_runs (id, ids_title, ids_sha256, model_label, ids_version_id, engine, trigger, engine_version, created_by, model_revisions) values
  ('00000000-0000-4000-8000-0000000000c1', 'Knižnica', 'h1', 'T-ASR', '00000000-0000-4000-8000-0000000000b1', 'ifc-lite', 'viewer',
   '@ifc-lite/ids 1.0.0', 'Samuel', '{"T-ASR": 79}');
insert into ids_results (run_id, spec_identifier, spec_name, ifc_guid, status, reasons) values
  ('00000000-0000-4000-8000-0000000000c1', 'IU-O-space', 'Priestor', 'g1', 'fail', '{dôvod}'),
  ('00000000-0000-4000-8000-0000000000c1', 'IU-O-space', 'Priestor', 'g2', 'pass', '{}');

do $$
declare b boolean; e text; n int;
begin
  select bool_or(ids_stale), max(engine_version) into b, e from v_ids_latest where ids_code = 'T-ER-0101_ARCH';
  if b or e <> '@ifc-lite/ids 1.0.0' then raise exception 'pred novou verziou: ids_stale %, engine_version %', b, e; end if;
  select ids_stale into b from v_ids_summary where ids_code = 'T-ER-0101_ARCH';
  if b then raise exception 'v_ids_summary: ids_stale pred novou verziou'; end if;

  insert into ids_document_versions (document_id, version, xml, sha256, source, author, library_repo, library_path, library_commit, library_code)
  values ('00000000-0000-4000-8000-0000000000a1', 2, '<ids2/>', 'h2', 'import', 'Samuel', 'o/lib', 'ids/T-ER-0101_ARCH.ids', 'c2', 'T-ER-0101_ARCH');

  select bool_and(ids_stale), count(*) into b, n from v_ids_latest where ids_code = 'T-ER-0101_ARCH';
  if not b or n <> 2 then raise exception 'po novej verzii: ids_stale %, riadkov %', b, n; end if;
  select ids_stale, failed into b, n from v_ids_summary where ids_code = 'T-ER-0101_ARCH';
  if not b or n <> 1 then raise exception 'v_ids_summary po novej verzii: ids_stale %, failed %', b, n; end if;
  -- staré behy bez verzie IDS nemajú ids_stale (nevie sa)
  insert into ids_runs (id, ids_title, ids_sha256, model_label) values ('00000000-0000-4000-8000-0000000000c2', 'Starý', 'o', 'T-ASR');
  insert into ids_results (run_id, spec_name, ifc_guid, status, reasons) values ('00000000-0000-4000-8000-0000000000c2', 'staré', 'g0', 'pass', '{}');
  select ids_stale is null into b from v_ids_latest where ids_title = 'Starý';
  if not b then raise exception 'starý beh má ids_stale'; end if;
end $$;

-- Rights: anon and authenticated do not see the links
do $$
begin
  if has_table_privilege('anon', 'ids_document_models', 'select') or has_table_privilege('authenticated', 'ids_document_models', 'select') then
    raise exception 'anon/authenticated majú práva na ids_document_models';
  end if;
  if not has_table_privilege('service_role', 'ids_document_models', 'insert') then
    raise exception 'service_role nemá právo na ids_document_models';
  end if;
end $$;

rollback;
