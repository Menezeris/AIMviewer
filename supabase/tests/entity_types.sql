-- D-195: entity manifest entity_types, entity_is_a and entity_attributes_unknown_keys.
-- Run on a local database with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/entity_types.sql
-- Read-only checks inside a transaction that ends with ROLLBACK; a failure raises an exception.
begin;

do $$
declare
  n int;
  v text[];
begin
  -- Counts (IFC4X3_ADD2 = the entity files at vendor/ifc4.3 424cadb).
  select count(*) into n from entity_types;
  if n <> 876 then raise exception 'total: % <> 876', n; end if;
  select count(*) into n from entity_types where is_abstract;
  if n <> 133 then raise exception 'abstract: % <> 133', n; end if;
  select count(*) into n from entity_types where is_root;
  if n <> 484 then raise exception 'is_root: % <> 484', n; end if;
  select count(*) into n from entity_types where is_node;
  if n <> 422 then raise exception 'is_node: % <> 422', n; end if;

  -- Resource nodes of R1: nodes, not IfcRoot.
  select array_agg(ifc_class order by ifc_class) into v from entity_types where is_node and not is_root;
  if v <> array['IfcApproval', 'IfcDocumentInformation', 'IfcDocumentReference', 'IfcMetric', 'IfcObjective',
                'IfcOrganization', 'IfcPerson'] then
    raise exception 'resource nodes: %', v;
  end if;

  -- Every IfcObjectDefinition subtype is a node; no relationship or property definition is.
  select count(*) into n from entity_types
   where (ifc_class = 'IfcObjectDefinition' or 'IfcObjectDefinition' = any (ancestors)) and not is_node;
  if n <> 0 then raise exception 'object definitions not flagged as node: %', n; end if;
  select count(*) into n from entity_types
   where is_node and ('IfcRelationship' = any (ancestors) or 'IfcPropertyDefinition' = any (ancestors));
  if n <> 0 then raise exception 'relationship or property definition flagged as node: %', n; end if;

  -- Tree: every supertype exists, ancestors end with the supertype, roots have no ancestors.
  select count(*) into n from entity_types e
   where e.supertype is not null and not exists (select 1 from entity_types p where p.ifc_class = e.supertype);
  if n <> 0 then raise exception 'dangling supertype: %', n; end if;
  select count(*) into n from entity_types where supertype is null and cardinality(ancestors) <> 0;
  if n <> 0 then raise exception 'root with ancestors: %', n; end if;
  select count(*) into n from entity_types e join entity_types p on p.ifc_class = e.supertype
   where e.ancestors <> p.ancestors || p.ifc_class;
  if n <> 0 then raise exception 'ancestors not the parent chain: %', n; end if;

  -- Spot checks of the brief.
  if (select ancestors from entity_types where ifc_class = 'IfcTask')
       <> array['IfcRoot', 'IfcObjectDefinition', 'IfcObject', 'IfcProcess'] then
    raise exception 'IfcTask ancestors';
  end if;
  if (select supertype from entity_types where ifc_class = 'IfcActionRequest') <> 'IfcControl' then
    raise exception 'IfcActionRequest supertype';
  end if;
  if (select supertype from entity_types where ifc_class = 'IfcEvent') <> 'IfcProcess' then
    raise exception 'IfcEvent supertype';
  end if;
  if (select supertype from entity_types where ifc_class = 'IfcSpace') <> 'IfcSpatialStructureElement' then
    raise exception 'IfcSpace supertype';
  end if;
  if (select supertype from entity_types where ifc_class = 'IfcDoor') <> 'IfcBuiltElement' then
    raise exception 'IfcDoor supertype';
  end if;
  if (select supertype from entity_types where ifc_class = 'IfcApproval') is not null then
    raise exception 'IfcApproval has no supertype';
  end if;
  if (select schema_layer || '/' || schema_package from entity_types where ifc_class = 'IfcDoor')
       <> 'shared/IfcSharedBldgElements' then
    raise exception 'IfcDoor docs path';
  end if;

  -- Attributes: own explicit attributes with enum values inline.
  if not exists (select 1 from entity_types e, jsonb_array_elements(e.attributes) a
                  where e.ifc_class = 'IfcTask' and a ->> 'name' = 'PredefinedType' and a ->> 'kind' = 'enum'
                    and a -> 'enum' ? 'MAINTENANCE') then
    raise exception 'IfcTask.PredefinedType enum';
  end if;
  if not exists (select 1 from entity_types e, jsonb_array_elements(e.attributes) a
                  where e.ifc_class = 'IfcTask' and a ->> 'name' = 'TaskTime' and a ->> 'type' = 'IfcTaskTime'
                    and a ->> 'kind' = 'entity' and (a ->> 'optional')::boolean) then
    raise exception 'IfcTask.TaskTime';
  end if;
  if exists (select 1 from entity_types e, jsonb_array_elements(e.attributes) a
              where e.ifc_class = 'IfcTask' and a ->> 'name' = 'GlobalId') then
    raise exception 'inherited attribute stored on the subtype';
  end if;

  -- entity_is_a
  if not entity_is_a('IfcDoor', 'IfcElement') then raise exception 'IfcDoor is an IfcElement'; end if;
  if not entity_is_a('IfcDoor', 'IfcDoor') then raise exception 'a class is itself'; end if;
  if not entity_is_a('IfcTask', 'IfcRoot') then raise exception 'IfcTask is an IfcRoot'; end if;
  if entity_is_a('IfcSpace', 'IfcElement') then raise exception 'IfcSpace is not an IfcElement'; end if;
  if entity_is_a('IfcApproval', 'IfcRoot') then raise exception 'IfcApproval is not an IfcRoot'; end if;
  if entity_is_a('IfcNoSuchClass', 'IfcRoot') then raise exception 'unknown class'; end if;
  if entity_is_a('IfcDoor', null) then raise exception 'null ancestor'; end if;

  -- entity_attributes_unknown_keys: inherited attributes count, meta keys skipped, nothing rejected.
  v := entity_attributes_unknown_keys('IfcTask',
         '{"TaskTime": {"_class": "IfcTaskTime", "ScheduleStart": "2026-11-05"}, "Name": "x",
           "IsMilestone": false, "_source": "app", "Bogus": 1}');
  if v <> array['Bogus'] then raise exception 'unknown keys IfcTask: %', v; end if;
  v := entity_attributes_unknown_keys('IfcPostalAddress', '{"Town": "Bratislava", "Purpose": "OFFICE"}');
  if v <> array[]::text[] then raise exception 'unknown keys IfcPostalAddress: %', v; end if;
  v := entity_attributes_unknown_keys('IfcNoSuchClass', '{"A": 1}');
  if v <> array['A'] then raise exception 'unknown class: %', v; end if;
  v := entity_attributes_unknown_keys('IfcTask', '[1, 2]');
  if v <> array[]::text[] then raise exception 'non-object: %', v; end if;
  v := entity_attributes_unknown_keys('IfcTask', null);
  if v <> array[]::text[] then raise exception 'null: %', v; end if;

  -- D-026: RLS on, no rights for anon / authenticated.
  if not (select relrowsecurity from pg_class where oid = 'public.entity_types'::regclass) then
    raise exception 'RLS off';
  end if;
  if has_table_privilege('anon', 'public.entity_types', 'select')
     or has_table_privilege('authenticated', 'public.entity_types', 'select') then
    raise exception 'anon or authenticated can read entity_types';
  end if;
  if has_function_privilege('anon', 'public.entity_is_a(text, text)', 'execute') then
    raise exception 'anon can execute entity_is_a';
  end if;

  raise notice 'entity_types: OK';
end $$;

rollback;
