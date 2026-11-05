-- D-189: AIMviewer multi-project. Backfill to OCB, project scoping of nodes and edges,
-- models identified by container, per-project keys, views and RPCs filtered by project.
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

-- The transitional global keys are dropped by the cleanup migration; drop them here so the
-- test sees the target state (rolled back at the end).
alter table information_containers drop constraint if exists information_containers_model_key;
alter table information_containers drop constraint if exists information_containers_identification_key;
alter table model_revisions drop constraint if exists model_revisions_model_revision_key;
drop index if exists uniq_current_model_revision;
alter table ifc_rev_imports drop constraint if exists ifc_rev_imports_model_revision_key;
alter table clash_tests drop constraint if exists clash_tests_code_key;
alter table ids_documents drop constraint if exists ids_documents_code_key;
drop index if exists uniq_model_tasks_number;
drop index if exists uniq_saved_views_name;
drop index if exists uniq_saved_views_last;
drop index if exists uniq_active_guid_alias;

-- Two test projects with the same model code, the same IFC GUIDs and the same codes.
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
insert into model_revisions (id, project_id, model, revision, parent_revision, is_current, sha256, size_bytes, archive_path, created_at) values
  ('00000000-0000-4000-8189-0000000000a1', '00000000-0000-4000-8189-000000000001', 'ARCH', 1, null, true, repeat('1', 64), 10, 'x', '2026-11-01'),
  ('00000000-0000-4000-8189-0000000000a2', '00000000-0000-4000-8189-000000000002', 'ARCH', 1, null, true, repeat('2', 64), 20, 'y', '2026-11-02');
insert into ifc_rev_imports (model_revision_id, model, revision, sha256, status, hash_version) values
  ('00000000-0000-4000-8189-0000000000a1', 'ARCH', 1, repeat('1', 64), 'done', 1),
  ('00000000-0000-4000-8189-0000000000a2', 'ARCH', 1, repeat('2', 64), 'done', 1);
insert into ifc_rev_objects (model_revision_id, model, revision, global_id, ifc_class, attributes, content_hash)
select m, 'ARCH', 1, g, c, a::jsonb, md5(m::text || g) from (values
  ('00000000-0000-4000-8189-0000000000a1'::uuid), ('00000000-0000-4000-8189-0000000000a2'::uuid)) mm(m),
  (values ('G-FLOOR', 'IfcBuildingStorey', '{"Name": "1NP"}'), ('G-DOOR', 'IfcDoor', '{"Name": "Door"}')) v(g, c, a);
insert into ifc_rev_relationships (model_revision_id, model, revision, rel_class, relating, related, relating_class, related_class, content_hash)
select m, 'ARCH', 1, 'IfcRelContainedInSpatialStructure', 'G-FLOOR', 'G-DOOR', 'IfcBuildingStorey', 'IfcDoor', md5(m::text)
  from (values ('00000000-0000-4000-8189-0000000000a1'::uuid), ('00000000-0000-4000-8189-0000000000a2'::uuid)) mm(m);

do $$
declare n int; a uuid; b uuid; j jsonb;
begin
  select count(distinct container_id) into n from model_revisions where model = 'ARCH';
  if n <> 2 then raise exception 'ARCH in two projects must be two containers, got %', n; end if;
  select container_id into a from model_revisions where id = '00000000-0000-4000-8189-0000000000a1';
  if (select project_id from information_containers where id = a) <> '00000000-0000-4000-8189-000000000001' then
    raise exception 'container of TP1 ARCH is in the wrong project';
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
  if j <> '{"ARCH": 1}'::jsonb then raise exception 'project_model_revisions_at TP2: %', j; end if;
  if project_revisions_stale('00000000-0000-4000-8189-000000000001', '{"ARCH": 1}') is not false then
    raise exception 'TP1 stamp should be current';
  end if;
  if project_engine_model_revisions('00000000-0000-4000-8189-000000000002', '{"ARCH": {"size": 20}}') <> '{"ARCH": 1}'::jsonb then
    raise exception 'engine revision by size must match within the project only';
  end if;
  -- RPCs filter by project
  if ifc_rev_resolve('ARCH', null, '00000000-0000-4000-8189-000000000002') <> 1 then
    raise exception 'ifc_rev_resolve TP2';
  end if;
  select count(*) into n from ifc_rev_storey_elements('ARCH', 1, '1NP', null, '00000000-0000-4000-8189-000000000001');
  if n <> 1 then raise exception 'ifc_rev_storey_elements TP1: %', n; end if;
  select count(*) into n from search_everything('Door', null, 20, '00000000-0000-4000-8189-000000000002');
  if n <> 1 then raise exception 'search_everything TP2: % rows', n; end if;
  if (aggregate_objects('objects', 'count', null, null, null,
        '[{"column": "object_type", "op": "eq", "value": "asset"}]'::jsonb, null, 50, false,
        '00000000-0000-4000-8189-000000000001') ->> 'value')::int <> 1 then
    raise exception 'aggregate_objects TP1';
  end if;
  begin
    perform ifc_rev_revision_id(null, 'ARCH', 1);
    perform aggregate_objects('objects', 'count', null, null, null, '[]'::jsonb, null, 50, false, null);
    raise exception 'aggregate_objects accepted a NULL project';
  exception when raise_exception then
    if sqlerrm not like '%p_project is required%' then raise; end if;
  end;
end $$;

-- 5. The deployed ETL writes the revision copy by (model, revision) only: filled when unambiguous.
do $$
begin
  begin
    insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash)
    values ('ARCH', 1, 'G-NEW', 'IfcWall', '{}', 'x');
    raise exception 'ambiguous (model, revision) was accepted';
  exception when raise_exception then
    if sqlerrm not like '%model_revision_id is required%' then raise; end if;
  end;
end $$;

-- 6. Per-project codes: the same code and number in two projects.
insert into clash_tests (code, name, origin, rules, project_id) values
  ('T-SAME', 'a', 'chat', '[{}]'::jsonb, '00000000-0000-4000-8189-000000000001'),
  ('T-SAME', 'b', 'chat', '[{}]'::jsonb, '00000000-0000-4000-8189-000000000002');
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
end $$;

rollback;
