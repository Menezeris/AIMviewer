-- D-196 (R10): after 20261105210000 every rel_type is 'enforce' except rel_assigns_to_actor ('warn').
-- Run on a local database with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/relationship_ifc_enforce.sql
-- Needs the OCB project node (as multi_project.sql). Everything is rolled back.
begin;

do $$
declare
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  bad uuid; storey uuid; n int;
begin
  select count(*) into n from relationship_types where ifc_check <> 'enforce' and rel_type <> 'rel_assigns_to_actor';
  if n <> 0 then raise exception 'rel_types not enforced: %', n; end if;
  if (select ifc_check from relationship_types where rel_type = 'rel_assigns_to_actor') <> 'warn' then
    raise exception 'rel_assigns_to_actor must stay warn until the ETL writes IfcActor nodes';
  end if;

  -- An enforced rel_type rejects a failing edge.
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('floor', 'T196E.S', 'storey', 'IfcBuildingStorey', p) returning id into storey;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196E.B', 'bad', 'IfcWallType', p) returning id into bad;
  begin
    insert into relationships (rel_type, from_id, to_id, source)
      values ('rel_contained_in_spatial_structure', bad, storey, 'test');
    raise exception 'enforce: failing edge accepted';
  exception when check_violation then null;
  end;
end $$;

-- The actor edge of today's ETL (person -> object) is still written, with a warning.
do $$
declare
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  person uuid; space uuid;
begin
  insert into objects (object_type, object_ref, name, ifc_type)
    values ('person', 'T196E.P', 'person', 'IfcPerson') returning id into person;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('space', 'T196E.SP', 'space', 'IfcSpace', p) returning id into space;
  insert into relationships (rel_type, from_id, to_id, role, source)
    values ('rel_assigns_to_actor', person, space, 'responsible', 'test');
end $$;

-- The guard of the migration stops it when an active edge fails.
do $$
declare
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  bad uuid; storey uuid;
begin
  update relationship_types set ifc_check = 'warn' where rel_type = 'rel_contained_in_spatial_structure';
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('floor', 'T196E.S2', 'storey', 'IfcBuildingStorey', p) returning id into storey;
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196E.B2', 'bad', 'IfcWallType', p) returning id into bad;
  insert into relationships (rel_type, from_id, to_id, source)
    values ('rel_contained_in_spatial_structure', bad, storey, 'test');
  begin
    if (select count(*) from v_relationship_ifc_violations where active and rel_type <> 'rel_assigns_to_actor') > 0 then
      raise exception 'D-196: guard would stop';
    end if;
    raise exception 'guard did not see the failing edge';
  exception when raise_exception then
    if sqlerrm <> 'D-196: guard would stop' then raise; end if;
  end;
end $$;

rollback;
