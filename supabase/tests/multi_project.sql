-- D-189: AIMviewer multi-project. Backfill to OCB, project scoping of nodes and edges,
-- models identified by container, per-project keys, views and RPCs filtered by project.
-- After the cleanup migration (20261105120000): no default project, no old global keys or OCB
-- wrappers, writers carry container_id and model_revision_id, BCF numbers per project, library
-- releases per project. This test does not include _legacy_ocb.sql.
-- Run on a local DB with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/multi_project.sql
-- On an empty schema insert the OCB project node first (the migration requires it).
-- Everything is rolled back.
begin;

-- 1. Backfill: every project-bound row has a project, the project node points at itself.
do $$
declare n int; t text;
begin
  if (select project_id from objects where id = '9e2dfcba-437b-43d3-a925-0dd29f195b38')
     is distinct from '9e2dfcba-437b-43d3-a925-0dd29f195b38'::uuid then
    raise exception 'OCB node must have project_id = id';
  end if;
  select count(*) into n from objects
   where project_id is null and object_type not in ('person', 'organization');
  if n > 0 then raise exception '% objects without project', n; end if;
  foreach t in array array['information_containers', 'model_revisions', 'model_tasks', 'saved_views',
    'clash_tests', 'clash_runs', 'ids_documents', 'ids_runs', 'derivation_runs', 'verification_runs',
    'icdd_imports', 'drawing_link_overrides', 'ifc_guid_aliases'] loop
    execute format('select count(*) from %I where project_id is null', t) into n;
    if n > 0 then raise exception '%: % rows without project', t, n; end if;
  end loop;
  select count(*) into n from model_revisions where container_id is null;
  if n > 0 then raise exception '% model revisions without container', n; end if;
  select count(*) into n from ifc_rev_imports where model_revision_id is null;
  if n > 0 then raise exception '% revision copies without model_revision_id', n; end if;
end $$;

-- 1b. The cleanup migration (20261105120000) removed the transitional pieces.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and column_name = 'project_id' and column_default is not null) then
    raise exception 'a project_id column still has a default';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and pg_get_function_arguments(oid) like '%9e2dfcba-437b-43d3-a925-0dd29f195b38%') then
    raise exception 'a function still defaults to OCB';
  end if;
  if exists (select 1 from pg_constraint where conname in (
               'information_containers_model_key', 'information_containers_identification_key',
               'model_revisions_model_revision_key', 'ifc_rev_imports_model_revision_key',
               'clash_tests_code_key', 'ids_documents_code_key'))
     or to_regclass('uniq_current_model_revision') is not null or to_regclass('uniq_model_tasks_number') is not null
     or to_regclass('uniq_saved_views_name') is not null or to_regclass('uniq_saved_views_last') is not null
     or to_regclass('uniq_active_guid_alias') is not null then
    raise exception 'an old global key is still there';
  end if;
  if to_regprocedure('model_revisions_at(timestamptz)') is not null or to_regprocedure('revisions_stale(jsonb)') is not null
     or to_regprocedure('engine_model_revisions(jsonb)') is not null or to_regprocedure('container_for_model(text)') is not null
     or to_regprocedure('georef_stamp(jsonb, jsonb, uuid, boolean)') is not null
     or to_regprocedure('georef_stamp_item(jsonb, jsonb, text, boolean)') is not null
     or to_regprocedure('ifc_rev_fill_model_revision_id()') is not null then
    raise exception 'an OCB wrapper or the (model, revision) fill trigger is still there';
  end if;
end $$;

-- Two test projects with the same model code (ASR, which OCB also uses), the same IFC GUIDs and the same codes.
insert into objects (id, object_type, object_ref, name, ifc_type) values
  ('00000000-0000-4000-8189-000000000001', 'project', 'TP1', 'Test project 1', 'IfcProject'),
  ('00000000-0000-4000-8189-000000000002', 'project', 'TP2', 'Test project 2', 'IfcProject');
insert into objects (id, object_type, object_ref, name, ifc_guid, ifc_type, project_id) values
  ('00000000-0000-4000-8189-000000000011', 'floor', 'TP1-1NP', '1NP', 'G-FLOOR', 'IfcBuildingStorey', '00000000-0000-4000-8189-000000000001'),
  ('00000000-0000-4000-8189-000000000012', 'asset', 'TP1-DOOR', 'Door', 'G-DOOR', 'IfcDoor', '00000000-0000-4000-8189-000000000001'),
  ('00000000-0000-4000-8189-000000000021', 'floor', 'TP2-1NP', '1NP', 'G-FLOOR', 'IfcBuildingStorey', '00000000-0000-4000-8189-000000000002'),
  ('00000000-0000-4000-8189-000000000022', 'asset', 'TP2-DOOR', 'Door', 'G-DOOR', 'IfcDoor', '00000000-0000-4000-8189-000000000002');
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8189-000000000011', 'G-FLOOR'), ('00000000-0000-4000-8189-000000000012', 'G-DOOR'),
  ('00000000-0000-4000-8189-000000000021', 'G-FLOOR'), ('00000000-0000-4000-8189-000000000022', 'G-DOOR');

-- 2. objects: people are global, a project node is its own project, object_ref stays global.
do $$
declare p uuid;
begin
  insert into objects (id, object_type, object_ref, name, project_id)
  values ('00000000-0000-4000-8189-000000000099', 'person', 'TP-PERSON', 'Jana', '00000000-0000-4000-8189-000000000001')
  returning project_id into p;
  if p is not null then raise exception 'a person must be global, got %', p; end if;
  begin
    insert into objects (object_type, object_ref, name, project_id)
    values ('asset', 'TP1-DOOR', 'Duplicate ref', '00000000-0000-4000-8189-000000000002');
    raise exception 'object_ref must stay unique across projects';
  exception when unique_violation then null;
  end;
end $$;

-- 3. Edges: project derived from endpoints, cross-project edges rejected.
do $$
declare p uuid;
begin
  insert into relationships (rel_type, from_id, to_id, source)
  values ('rel_referenced_in_spatial_structure', '00000000-0000-4000-8189-000000000012',
          '00000000-0000-4000-8189-000000000011', 'derive:test')
  returning project_id into p;
  if p is distinct from '00000000-0000-4000-8189-000000000001'::uuid then
    raise exception 'edge project not derived: %', p;
  end if;
  begin
    insert into relationships (rel_type, from_id, to_id, source)
    values ('rel_referenced_in_spatial_structure', '00000000-0000-4000-8189-000000000022',
            '00000000-0000-4000-8189-000000000011', 'derive:test');
    raise exception 'cross-project edge was accepted';
  exception when raise_exception then
    if sqlerrm not like '%different projects%' then raise; end if;
  end;
end $$;

-- 4. Models by container: the same code in two projects is two models.
-- The writer names the container (model_publish does the same); container_for_model creates it.
insert into model_revisions (id, project_id, container_id, model, revision, parent_revision, is_current, sha256, size_bytes, archive_path, created_at) values
  ('00000000-0000-4000-8189-0000000000a1', '00000000-0000-4000-8189-000000000001',
   container_for_model('00000000-0000-4000-8189-000000000001', 'ASR'), 'ASR', 1, null, true, repeat('1', 64), 10, 'x', '2026-11-01'),
  ('00000000-0000-4000-8189-0000000000a2', '00000000-0000-4000-8189-000000000002',
   container_for_model('00000000-0000-4000-8189-000000000002', 'ASR'), 'ASR', 1, null, true, repeat('2', 64), 20, 'y', '2026-11-02');
insert into ifc_rev_imports (model_revision_id, model, revision, sha256, status, hash_version) values
  ('00000000-0000-4000-8189-0000000000a1', 'ASR', 1, repeat('1', 64), 'done', 1),
  ('00000000-0000-4000-8189-0000000000a2', 'ASR', 1, repeat('2', 64), 'done', 1);
insert into ifc_rev_objects (model_revision_id, model, revision, global_id, ifc_class, attributes, content_hash)
select m, 'ASR', 1, g, c, a::jsonb, md5(m::text || g) from (values
  ('00000000-0000-4000-8189-0000000000a1'::uuid), ('00000000-0000-4000-8189-0000000000a2'::uuid)) mm(m),
  (values ('G-FLOOR', 'IfcBuildingStorey', '{"Name": "1NP"}'), ('G-DOOR', 'IfcDoor', '{"Name": "Door"}')) v(g, c, a);
insert into ifc_rev_relationships (model_revision_id, model, revision, rel_class, relating, related, relating_class, related_class, content_hash)
select m, 'ASR', 1, 'IfcRelContainedInSpatialStructure', 'G-FLOOR', 'G-DOOR', 'IfcBuildingStorey', 'IfcDoor', md5(m::text)
  from (values ('00000000-0000-4000-8189-0000000000a1'::uuid), ('00000000-0000-4000-8189-0000000000a2'::uuid)) mm(m);

do $$
declare n int; a uuid; b uuid; j jsonb;
begin
  select count(distinct container_id) into n from model_revisions
   where model = 'ASR' and project_id in ('00000000-0000-4000-8189-000000000001', '00000000-0000-4000-8189-000000000002');
  if n <> 2 then raise exception 'ASR in two projects must be two containers, got %', n; end if;
  select container_id into a from model_revisions where id = '00000000-0000-4000-8189-0000000000a1';
  if (select project_id from information_containers where id = a) <> '00000000-0000-4000-8189-000000000001' then
    raise exception 'container of TP1 ASR is in the wrong project';
  end if;
  -- the GUID resolves within the project: each project's door sits on its own floor
  select from_id, to_id into a, b from rel_contained_in_spatial_structure
   where project_id = '00000000-0000-4000-8189-000000000002' and global_id = 'G-DOOR';
  if a is distinct from '00000000-0000-4000-8189-000000000022'::uuid
     or b is distinct from '00000000-0000-4000-8189-000000000021'::uuid then
    raise exception 'TP2 door resolved to % on %', a, b;
  end if;
  select count(*) into n from rel_contained_in_spatial_structure where global_id = 'G-DOOR';
  if n <> 2 then raise exception 'expected one contained edge per project, got %', n; end if;
  select count(*) into n from ifc_guid_node where ifc_guid = 'G-DOOR';
  if n <> 2 then raise exception 'ifc_guid_node: expected 2 rows for G-DOOR, got %', n; end if;
  -- revisions and stamps per project
  j := project_model_revisions_at('00000000-0000-4000-8189-000000000002', null);
  if j <> '{"ASR": 1}'::jsonb then raise exception 'project_model_revisions_at TP2: %', j; end if;
  if project_revisions_stale('00000000-0000-4000-8189-000000000001', '{"ASR": 1}') is not false then
    raise exception 'TP1 stamp should be current';
  end if;
  if project_engine_model_revisions('00000000-0000-4000-8189-000000000002', '{"ASR": {"size": 20}}') <> '{"ASR": 1}'::jsonb then
    raise exception 'engine revision by size must match within the project only';
  end if;
  -- RPCs filter by project
  if ifc_rev_resolve('ASR', null, '00000000-0000-4000-8189-000000000002') <> 1 then
    raise exception 'ifc_rev_resolve TP2';
  end if;
  select count(*) into n from ifc_rev_storey_elements('ASR', 1, '1NP', null, '00000000-0000-4000-8189-000000000001');
  if n <> 1 then raise exception 'ifc_rev_storey_elements TP1: %', n; end if;
  select count(*) into n from search_everything('Door', null, 20, '00000000-0000-4000-8189-000000000002');
  if n <> 1 then raise exception 'search_everything TP2: % rows', n; end if;
  if (aggregate_objects('objects', 'count', null, null, null,
        '[{"column": "object_type", "op": "eq", "value": "asset"}]'::jsonb, null, 50, false,
        '00000000-0000-4000-8189-000000000001') ->> 'value')::int <> 1 then
    raise exception 'aggregate_objects TP1';
  end if;
  begin
    perform ifc_rev_revision_id(null, 'ASR', 1);
    perform aggregate_objects('objects', 'count', null, null, null, '[]'::jsonb, null, 50, false, null);
    raise exception 'aggregate_objects accepted a NULL project';
  exception when raise_exception then
    if sqlerrm not like '%p_project is required%' then raise; end if;
  end;
end $$;

-- 5. Writers carry the ids: a revision copy row without model_revision_id and a model revision
-- without container_id are rejected (the fill triggers are gone).
do $$
begin
  begin
    insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash)
    values ('ASR', 1, 'G-NEW', 'IfcWall', '{}', 'x');
    raise exception 'revision copy row without model_revision_id was accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into model_revisions (project_id, model, revision, is_current, sha256, size_bytes, archive_path)
    values ('00000000-0000-4000-8189-000000000001', 'ASR', 2, false, repeat('3', 64), 1, 'x');
    raise exception 'model revision without container_id was accepted';
  exception when raise_exception then
    if sqlerrm not like '%container_id is required%' then raise; end if;
  end;
  begin
    insert into model_revisions (project_id, container_id, model, revision, is_current, sha256, size_bytes, archive_path)
    values ('00000000-0000-4000-8189-000000000001',
            (select container_id from model_revisions where id = '00000000-0000-4000-8189-0000000000a2'),
            'ASR', 2, false, repeat('3', 64), 1, 'x');
    raise exception 'a container of another project was accepted';
  exception when raise_exception then
    if sqlerrm not like '%is not model%' then raise; end if;
  end;
end $$;

-- 6. Per-project codes: the same clash, IDS, container, saved view and alias in two projects.
insert into clash_tests (code, name, origin, rules, project_id) values
  ('T-SAME', 'a', 'chat', '[{}]'::jsonb, '00000000-0000-4000-8189-000000000001'),
  ('T-SAME', 'b', 'chat', '[{}]'::jsonb, '00000000-0000-4000-8189-000000000002');
insert into ids_documents (code, title, origin, project_id) values
  ('IDS-SAME', 'a', 'chat', '00000000-0000-4000-8189-000000000001'),
  ('IDS-SAME', 'b', 'chat', '00000000-0000-4000-8189-000000000002');
insert into information_containers (identification, name, container_type, project_id) values
  ('DOC-SAME', 'a', 'PDF', '00000000-0000-4000-8189-000000000001'),
  ('DOC-SAME', 'b', 'PDF', '00000000-0000-4000-8189-000000000002');
insert into saved_views (name, kind, viewpoint, project_id) values
  ('View', 'saved', '{}'::jsonb, '00000000-0000-4000-8189-000000000001'),
  ('View', 'saved', '{}'::jsonb, '00000000-0000-4000-8189-000000000002'),
  ('Last', 'last', '{}'::jsonb, '00000000-0000-4000-8189-000000000001'),
  ('Last', 'last', '{}'::jsonb, '00000000-0000-4000-8189-000000000002');
insert into ifc_guid_aliases (ifc_guid, object_id, reason, project_id) values
  ('G-ALIAS', '00000000-0000-4000-8189-000000000012', 'test', '00000000-0000-4000-8189-000000000001'),
  ('G-ALIAS', '00000000-0000-4000-8189-000000000022', 'test', '00000000-0000-4000-8189-000000000002');
do $$
begin
  begin
    insert into clash_tests (code, name, origin, rules, project_id)
    values ('T-SAME', 'c', 'chat', '[{}]'::jsonb, '00000000-0000-4000-8189-000000000001');
    raise exception 'duplicate clash code within a project was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into ids_documents (code, title, origin, project_id)
    values ('IDS-SAME', 'c', 'chat', '00000000-0000-4000-8189-000000000002');
    raise exception 'duplicate IDS code within a project was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into saved_views (name, kind, viewpoint, project_id)
    values ('Last', 'last', '{}'::jsonb, '00000000-0000-4000-8189-000000000002');
    raise exception 'a second last view of a project was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- 6b. BCF topic numbers per project: a new project starts at 1, OCB continues where it was.
do $$
declare a bigint; b bigint; c bigint; ocb_next bigint; t uuid;
begin
  select last_number + 1 into ocb_next from bcf_topic_counters where project_id = '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  if ocb_next is null then ocb_next := 1; end if;
  if ocb_next <= coalesce((select max(number) from model_tasks where project_id = '9e2dfcba-437b-43d3-a925-0dd29f195b38'), 0) then
    raise exception 'OCB counter % is not above its highest topic number', ocb_next - 1;
  end if;
  insert into model_tasks (title, project_id) values ('t1', '00000000-0000-4000-8189-000000000002') returning number into a;
  insert into model_tasks (title, project_id) values ('t2', '00000000-0000-4000-8189-000000000002') returning number into b;
  insert into model_tasks (title, project_id) values ('t1', '00000000-0000-4000-8189-000000000001') returning number into c;
  if (a, b, c) is distinct from (1::bigint, 2::bigint, 1::bigint) then
    raise exception 'per-project BCF numbers: TP2 %, %; TP1 %', a, b, c;
  end if;
  insert into model_tasks (title, project_id) values ('o', '9e2dfcba-437b-43d3-a925-0dd29f195b38') returning number, id into a, t;
  if a <> ocb_next then raise exception 'OCB topic got %, expected %', a, ocb_next; end if;
  begin
    insert into model_tasks (title, project_id, number) values ('x', '00000000-0000-4000-8189-000000000002', 99);
    raise exception 'an explicit BCF number was accepted';
  exception when raise_exception then
    if sqlerrm not like '%number is assigned per project%' then raise; end if;
  end;
  begin
    update model_tasks set number = 99 where id = t;
    raise exception 'a BCF number was changed';
  exception when raise_exception then
    if sqlerrm not like '%do not change%' then raise; end if;
  end;
  update model_tasks set title = 'o2' where id = t;  -- other columns stay editable
end $$;

-- 6c. A missing project is an error: tables, the edge trigger and every RPC.
do $$
declare t text; n int := 0;
begin
  foreach t in array array['clash_tests', 'ids_documents', 'saved_views', 'model_tasks', 'information_containers'] loop
    begin
      case t
        when 'clash_tests' then insert into clash_tests (code, name, origin, rules) values ('T-NULL', 'x', 'chat', '[{}]');
        when 'ids_documents' then insert into ids_documents (code, title, origin) values ('IDS-NULL', 'x', 'chat');
        when 'saved_views' then insert into saved_views (name, kind, viewpoint) values ('V-NULL', 'saved', '{}');
        when 'model_tasks' then insert into model_tasks (title) values ('x');
        when 'information_containers' then insert into information_containers (identification, name, container_type) values ('C-NULL', 'x', 'PDF');
      end case;
      raise exception '% accepted a row without project', t;
    exception when not_null_violation then n := n + 1;
              when raise_exception then
                if sqlerrm like '%project_id is required%' then n := n + 1; else raise; end if;
    end;
  end loop;
  begin
    insert into objects (object_type, object_ref, name) values ('asset', 'TP-NULL', 'x');
    raise exception 'an asset without project was accepted';
  exception when check_violation then n := n + 1;
  end;
  if n <> 6 then raise exception 'expected 6 rejections, got %', n; end if;
end $$;

do $$
declare n int := 0; q text;
begin
  foreach q in array array[
    'select search_everything(''Door'')',
    'select search_documents(''Door'')',
    'select aggregate_objects()',
    'select ifc_rev_resolve(''ASR'')',
    'select count(*) from ifc_rev_storey_elements(''ASR'', 1, ''1NP'')',
    'select count(*) from ifc_rev_compare(''ASR'', 1, 1)'] loop
    begin
      execute q;
      raise exception 'no error for: %', q;
    exception when raise_exception then
      if sqlerrm like '%p_project is required%' then n := n + 1; else raise; end if;
    end;
  end loop;
  if n <> 6 then raise exception 'expected 6 RPC rejections, got %', n; end if;
end $$;

-- 6d. A library release goes into the catalog of one project: the same IDS code in two projects.
do $$
declare k uuid; v1 uuid; v2 uuid; out jsonb; n int;
begin
  select id into k from library.kniznica order by kod limit 1;
  if k is null then
    insert into library.kniznica (kod, nazov) values ('test-d189', 'Test') returning id into k;
  end if;
  insert into library.vydanie (kniznica_id, kod, manifest_sha256, schema_verzia, autor)
  values (k, 'd189-a', '\x00', '1', 'test') returning id into v1;
  insert into library.vydanie (kniznica_id, kod, manifest_sha256, schema_verzia, autor)
  values (k, 'd189-b', '\x00', '1', 'test') returning id into v2;
  out := library.publish_ids(v1, '[{"code": "LIB-D189", "title": "t", "xml": "<ids/>", "library_path": "zadanie/t.md"}]', '00000000-0000-4000-8189-000000000001');
  out := library.publish_ids(v2, '[{"code": "LIB-D189", "title": "t", "xml": "<ids/>", "library_path": "zadanie/t.md"}]', '00000000-0000-4000-8189-000000000002');
  if out -> 0 ->> 'zmena' <> 'nove' then raise exception 'second project should get a new IDS: %', out; end if;
  select count(*) into n from ids_documents where code = 'LIB-D189';
  if n <> 2 then raise exception 'expected the library IDS in both projects, got %', n; end if;
  begin
    perform library.publish_ids(v1, '[]', null);
    raise exception 'publish_ids accepted a NULL project';
  exception when raise_exception then
    if sqlerrm not like '%p_project is required%' then raise; end if;
  end;
end $$;

-- 7. IDS binds only to a container of its own project.
do $$
declare d uuid; c uuid;
begin
  insert into ids_documents (code, title, origin, project_id)
  values ('IDS-TP1', 'IDS', 'chat', '00000000-0000-4000-8189-000000000001') returning id into d;
  select container_id into c from model_revisions where id = '00000000-0000-4000-8189-0000000000a2';
  begin
    insert into ids_document_models (document_id, information_container_id, created_by)
    values (d, c, 'test');
    raise exception 'IDS bound to a container of another project';
  exception when raise_exception then
    if sqlerrm not like '%different projects%' then raise; end if;
  end;
end $$;

-- 8. Grants: new functions only for service_role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'project_model_revisions_at(uuid, timestamptz)', 'execute') then
    raise exception 'anon may call project_model_revisions_at';
  end if;
  if not has_function_privilege('service_role', 'search_everything(text, text[], integer, uuid)', 'execute') then
    raise exception 'service_role may not call search_everything';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and (has_table_privilege('anon', 'bcf_topic_counters', 'select')
          or has_function_privilege('anon', 'library_release(text, text, text, text, text, jsonb, jsonb, jsonb, uuid)', 'execute')) then
    raise exception 'anon may read bcf_topic_counters or call library_release';
  end if;
  if not has_table_privilege('service_role', 'bcf_topic_counters', 'update') then
    raise exception 'service_role may not update bcf_topic_counters (needed by the model_tasks trigger)';
  end if;
  if (select relrowsecurity from pg_class where oid = 'bcf_topic_counters'::regclass) is not true then
    raise exception 'RLS is off on bcf_topic_counters';
  end if;
end $$;

rollback;
