-- D-196 (R10, PR 3): relationships_validate applies the IFC end types per relationship_types.ifc_check.
-- Run on a local database with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/relationship_ifc_check.sql
-- Needs the OCB project node (as multi_project.sql). Everything is rolled back.
begin;

do $$
declare
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  wall uuid; storey uuid; wtype uuid; bad uuid; nul uuid; cap uuid; space uuid; ref uuid; doc uuid;
  n int;
begin
  -- The modes are set here (20261105170000 left every rel_type in warn, 20261105210000 enforces most of
  -- them; relationship_ifc_enforce.sql tests that state). This test starts from warn everywhere.
  update relationship_types set ifc_check = 'warn';

  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('floor', 'T196C.S', 'storey', 'IfcBuildingStorey', p) returning id into storey;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196C.W', 'wall', 'IfcWall', p) returning id into wall;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset_type', 'T196C.WT', 'wall type', 'IfcWallType', p) returning id into wtype;
  -- an asset whose IFC class is a type object: the object_type rule passes, the IFC rule does not
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196C.B', 'bad', 'IfcWallType', p) returning id into bad;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196C.N', 'no class', null, p) returning id into nul;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('space', 'T196C.SP', 'space', 'IfcSpace', p) returning id into space;
  insert into objects (object_type, object_ref, name, project_id)
    values ('capture', 'T196C.C', 'capture', p) returning id into cap;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('document', 'T196C.D', 'doc', 'IfcDocumentInformation', p) returning id into doc;

  -- 1. warn: a failing edge is written (and listed by the view).
  insert into relationships (rel_type, from_id, to_id, source) values ('rel_contained_in_spatial_structure', bad, storey, 'test');
  select count(*) into n from v_relationship_ifc_violations where node_id = bad and active;
  if n <> 1 then raise exception 'warn mode: failing edge not written or not listed: %', n; end if;

  -- 2. enforce: valid edges pass, a wrong class and a NULL class are rejected.
  update relationship_types set ifc_check = 'enforce';
  insert into relationships (rel_type, from_id, to_id, source)
    values ('rel_contained_in_spatial_structure', wall, storey, 'test'),
           ('rel_defines_by_type', wall, wtype, 'test'),
           ('rel_space_boundary', wall, space, 'test'),
           ('rel_associates_document', wall, doc, 'test'),
           ('aim_rel_capture_located', cap, space, 'test');   -- capture end has no IFC check
  begin
    insert into relationships (rel_type, from_id, to_id, source) values ('rel_space_boundary', bad, space, 'test');
    raise exception 'enforce: IfcWallType accepted as IfcElement';
  exception when check_violation then
    if sqlerrm not like '%from % has ifc_type IfcWallType%(R10)' then raise; end if;
  end;
  begin
    insert into relationships (rel_type, from_id, to_id, source) values ('rel_contained_in_spatial_structure', nul, storey, 'test');
    raise exception 'enforce: NULL ifc_type accepted';
  exception when check_violation then
    if sqlerrm not like '%ifc_type NULL%' then raise; end if;
  end;
  -- to end: a storey is not an IfcTypeObject
  begin
    update objects set ifc_type = 'IfcBuildingStorey' where id = wtype;
    insert into objects (object_type, object_ref, name, ifc_type, project_id)
      values ('asset', 'T196C.W2', 'wall 2', 'IfcWall', p) returning id into ref;
    insert into relationships (rel_type, from_id, to_id, source) values ('rel_defines_by_type', ref, wtype, 'test');
    raise exception 'enforce: IfcBuildingStorey accepted as IfcTypeObject';
  exception
    when unique_violation then raise exception 'test setup: unique-active defines_by_type hit';
    when check_violation then
      if sqlerrm not like '%to % has ifc_type IfcBuildingStorey%' then raise; end if;
  end;
  update objects set ifc_type = 'IfcWallType' where id = wtype;

  -- 3. Classification end counts as IfcClassificationReference.
  insert into classification_systems (name) values ('T196C') returning id into ref;
  insert into classification_references (system_id, identification, name) values (ref, 'T196C.1', 'x') returning id into ref;
  insert into relationships (rel_type, from_id, to_id, source) values ('rel_associates_classification', wall, ref, 'test');

  -- 4. The object_type rule still comes first (a space is not allowed as rel_defines_by_type From).
  begin
    insert into relationships (rel_type, from_id, to_id, source) values ('rel_defines_by_type', space, wtype, 'test');
    raise exception 'object_type rule skipped';
  exception when raise_exception then
    if sqlerrm not like '%from object_type "space"%' then raise; end if;
  end;

  -- 5. Update: closing or relabelling a failing edge works under enforce (ends unchanged); moving an end to
  --    a failing node is rejected.
  update relationship_types set ifc_check = 'enforce' where rel_type = 'rel_contained_in_spatial_structure';
  update relationships set source = 'test2', valid_until = now() where from_id = bad;
  select count(*) into n from relationships where from_id = bad and valid_until is not null;
  if n <> 1 then raise exception 'enforce: closing a failing edge was blocked'; end if;
  begin
    update relationships set from_id = nul where from_id = wall and rel_type = 'rel_contained_in_spatial_structure';
    raise exception 'enforce: moving an end to a failing node accepted';
  exception when check_violation then null;
  end;

  -- 6. off: no IFC check at all.
  update relationship_types set ifc_check = 'off' where rel_type = 'rel_space_boundary';
  insert into relationships (rel_type, from_id, to_id, source) values ('rel_space_boundary', bad, space, 'test');
end $$;

rollback;
