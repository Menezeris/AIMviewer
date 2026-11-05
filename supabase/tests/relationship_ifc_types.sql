-- D-196 (R10, PR 1): IFC end types in relationship_types, relationship_ifc_end_ok and
-- v_relationship_ifc_violations. Run on a local database with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/relationship_ifc_types.sql
-- Needs the OCB project node (as multi_project.sql). Everything is rolled back.
begin;

do $$
declare
  n int;
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  wall uuid; storey uuid; doc uuid; wall_type uuid; cap uuid; space uuid; ref uuid; sys uuid;
begin
  -- 1. Manifest: every rel_type has its types, the check is off, every type is an entity.
  -- (the mode itself is tested in relationship_ifc_check.sql; here only the end types)
  select count(*) into n from relationship_types
   where namespace = 'rel' and (cardinality(from_ifc_types) = 0 or cardinality(to_ifc_types) = 0);
  if n <> 0 then raise exception 'IFC-anchored rel_type without end types: %', n; end if;
  select count(*) into n from relationship_types m, unnest(m.from_ifc_types || m.to_ifc_types) t
   where not exists (select 1 from entity_types e where e.ifc_class = t);
  if n <> 0 then raise exception 'end type not in entity_types: %', n; end if;
  if (select from_ifc_types from relationship_types where rel_type = 'rel_assigns_to_actor') <> array['IfcActor'] then
    raise exception 'rel_assigns_to_actor From end must be IfcActor (PLATFORM.md 5.3)';
  end if;
  if not (select 'actor' = any (from_object_types) from relationship_types where rel_type = 'rel_assigns_to_actor') then
    raise exception 'rel_assigns_to_actor must allow object_type actor';
  end if;
  begin
    update relationship_types set ifc_check = 'strict' where rel_type = 'rel_aggregates';
    raise exception 'ifc_check accepted an unknown mode';
  exception when check_violation then null;
  end;

  -- 2. relationship_ifc_end_ok: subtype passes, other class fails, NULL and unknown fail, empty = no check.
  if not relationship_ifc_end_ok('IfcWall', array['IfcProduct']) then raise exception 'IfcWall is an IfcProduct'; end if;
  if not relationship_ifc_end_ok('IfcProduct', array['IfcProduct']) then raise exception 'class itself passes'; end if;
  if not relationship_ifc_end_ok('IfcSpace', array['IfcExternalSpatialElement', 'IfcSpace']) then
    raise exception 'second allowed type passes';
  end if;
  if relationship_ifc_end_ok('IfcWallType', array['IfcProduct']) then raise exception 'IfcWallType is not an IfcProduct'; end if;
  if relationship_ifc_end_ok(null, array['IfcProduct']) then raise exception 'NULL ifc_type must fail'; end if;
  if relationship_ifc_end_ok('IfcNoSuchThing', array['IfcProduct']) then raise exception 'unknown class must fail'; end if;
  if not relationship_ifc_end_ok(null, array[]::text[]) then raise exception 'empty allowed = no check'; end if;

  -- 3. Report view on a small graph. Writes still go through the unchanged trigger.
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('floor', 'T196.S', 'storey', 'IfcBuildingStorey', p) returning id into storey;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196.W', 'wall', 'IfcWall', p) returning id into wall;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset_type', 'T196.WT', 'wall type', 'IfcWallType', p) returning id into wall_type;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('space', 'T196.SP', 'space', 'IfcSpace', p) returning id into space;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('system', 'T196.SYS', 'system', 'IfcDistributionSystem', p) returning id into sys;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('document', 'T196.D', 'doc', null, p) returning id into doc;
  insert into objects (object_type, object_ref, name, project_id)
    values ('capture', 'T196.C', 'capture', p) returning id into cap;

  -- valid IFC edges
  insert into relationships (rel_type, from_id, to_id, source)
    values ('rel_contained_in_spatial_structure', wall, storey, 'test'),
           ('rel_defines_by_type', wall, wall_type, 'test'),
           ('rel_assigns_to_group', wall, sys, 'test'),
           ('rel_space_boundary', wall, space, 'test');
  -- aim_*: capture end has no IFC class (empty list), To end must be a spatial element
  insert into relationships (rel_type, from_id, to_id, source) values ('aim_rel_capture_located', cap, space, 'test');
  select count(*) into n from v_relationship_ifc_violations where node_id in (wall, storey, wall_type, space, sys, cap);
  if n <> 0 then raise exception 'valid edges reported: %', n; end if;

  -- document without ifc_type: reported as missing on the To end
  insert into relationships (rel_type, from_id, to_id, role, source) values ('rel_associates_document', wall, doc, null, 'test');
  select count(*) into n from v_relationship_ifc_violations
   where node_id = doc and edge_end = 'to' and reason = 'missing ifc_type' and active;
  if n <> 1 then raise exception 'document without ifc_type not reported: %', n; end if;

  -- wrong IFC class at an end that the object_type rule allows (an IfcSpace marked as asset)
  update objects set ifc_type = 'IfcSpace' where id = wall;
  select count(*) into n from v_relationship_ifc_violations
   where node_id = wall and edge_end = 'from' and rel_type = 'rel_space_boundary'
     and reason = 'not a subtype of an allowed type';
  if n <> 1 then raise exception 'IfcSpace as IfcElement end not reported: %', n; end if;
  -- IfcSpace is still an IfcProduct and an IfcObjectDefinition: contained and assigns_to_group pass
  select count(*) into n from v_relationship_ifc_violations
   where node_id = wall and rel_type in ('rel_contained_in_spatial_structure', 'rel_assigns_to_group');
  if n <> 0 then raise exception 'IfcSpace wrongly reported for contained/group: %', n; end if;

  -- unknown class
  update objects set ifc_type = 'IfcNoSuchThing' where id = wall_type;
  select count(*) into n from v_relationship_ifc_violations where node_id = wall_type and reason = 'unknown ifc_type';
  if n <> 1 then raise exception 'unknown ifc_type not reported: %', n; end if;

  -- classification end: classification_references row counts as IfcClassificationReference
  insert into classification_systems (name) values ('T196') returning id into ref;
  insert into classification_references (system_id, identification, name) values (ref, 'T196.1', 'x') returning id into ref;
  update objects set ifc_type = 'IfcWall' where id = wall;
  insert into relationships (rel_type, from_id, to_id, source) values ('rel_associates_classification', wall, ref, 'test');
  select count(*) into n from v_relationship_ifc_violations where relationship_id in
    (select id from relationships where rel_type = 'rel_associates_classification' and from_id = wall);
  if n <> 0 then raise exception 'classification edge reported: %', n; end if;

  -- inactive edges are reported with active = false
  update relationships set valid_until = now() where rel_type = 'rel_associates_document' and from_id = wall;
  select count(*) into n from v_relationship_ifc_violations where node_id = doc and not active;
  if n <> 1 then raise exception 'inactive edge not reported as inactive: %', n; end if;

  -- 4. Decision B: no document node without ifc_type after the migration (test nodes above excluded).
  select count(*) into n from objects where object_type = 'document' and ifc_type is null and object_ref not like 'T196.%';
  if n <> 0 then raise exception 'document nodes without ifc_type: %', n; end if;

  -- 5. No rights for anon / authenticated.
  if has_table_privilege('anon', 'v_relationship_ifc_violations', 'select')
     or has_table_privilege('authenticated', 'v_relationship_ifc_violations', 'select') then
    raise exception 'view readable by anon/authenticated';
  end if;
  if has_function_privilege('anon', 'relationship_ifc_end_ok(text, text[])', 'execute') then
    raise exception 'function executable by anon';
  end if;
end $$;

rollback;
