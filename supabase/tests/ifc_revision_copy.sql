-- D-183 K2: kópia revízie (ifc_rev_*), ifc_rev_storey_elements, ifc_rev_compare.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ifc_revision_copy.sql
begin;

insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('TST', 1, null, false, repeat('a', 64), 1, 'x'),
  ('TST', 2, 1, true, repeat('b', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values
  ('TST', 1, repeat('a', 64), 'done', 1),
  ('TST', 2, repeat('b', 64), 'done', 1);

-- v1: podlažia, systém, potrubie P1 a P2, vyústka V s typom T, klapka K v 2NP
insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash)
select 'TST', r, g, c, a::jsonb, md5(a || c) from (values
  ('S2', 'IfcBuildingStorey', '{"Name": "2NP"}'), ('S3', 'IfcBuildingStorey', '{"Name": "3NP"}'),
  ('SYS', 'IfcDistributionSystem', '{"Name": "Prívod-2NP"}'), ('ODV', 'IfcDistributionSystem', '{"Name": "Odvod-2NP"}'),
  ('P1', 'IfcDuctSegment', '{"Name": "PO.1"}'), ('P2', 'IfcDuctSegment', '{"Name": "PO.2"}'),
  ('V', 'IfcAirTerminal', '{"Name": "VV.1"}'), ('T', 'IfcAirTerminalType', '{"Name": "Typ"}'),
  ('K', 'IfcDamper', '{"Name": "KL.1"}')) v(g, c, a), (values (1), (2)) rr(r)
where not (r = 2 and g = 'P2');
-- v2: P2 zmazané, N pridané, V premenované
insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash) values
  ('TST', 2, 'N', 'IfcAirTerminal', '{"Name": "VV.NEW"}', 'n');
update ifc_rev_objects set attributes = '{"Name": "VV.1-X"}', content_hash = 'v2' where revision = 2 and global_id = 'V';

insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash)
select 'TST', r, c, a, b, 'x', 'y', md5(c || a || b) from (values
  ('IfcRelContainedInSpatialStructure', 'S2', 'P1'), ('IfcRelContainedInSpatialStructure', 'S2', 'P2'),
  ('IfcRelContainedInSpatialStructure', 'S2', 'V'), ('IfcRelContainedInSpatialStructure', 'S2', 'K'),
  ('IfcRelAssignsToGroup', 'SYS', 'P1'), ('IfcRelAssignsToGroup', 'SYS', 'P2'), ('IfcRelAssignsToGroup', 'SYS', 'K'),
  ('IfcRelAssignsToGroup', 'ODV', 'V'), ('IfcRelDefinesByType', 'T', 'V')) v(c, a, b), (values (1), (2)) rr(r)
where not (r = 2 and (b = 'P2' or (b = 'K' and c = 'IfcRelContainedInSpatialStructure')));
-- v2: K presunutá do 3NP
insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  ('TST', 2, 'IfcRelContainedInSpatialStructure', 'S3', 'K', 'x', 'y', 'k3');

insert into ifc_rev_property_sets (model, revision, global_id, pset_name, pset_class, properties, content_hash)
select 'TST', r, g, n, 'IfcPropertySet', p::jsonb, md5(p) from (values
  ('P1', 'Qto_DuctSegmentBaseQuantities', '{"Length": 2.4, "Width": 0.2}'),
  ('T', 'Pset_ManufacturerTypeInformation', '{"Manufacturer": "ACME"}')) v(g, n, p), (values (1), (2)) rr(r);
-- v2: jedna hodnota Qto a pset typu
update ifc_rev_property_sets set properties = '{"Length": 2.1, "Width": 0.2}', content_hash = 'q2' where revision = 2 and global_id = 'P1';
update ifc_rev_property_sets set properties = '{"Manufacturer": "INÝ"}', content_hash = 't2' where revision = 2 and global_id = 'T';

do $$
declare n int; a text; j jsonb;
begin
  select count(*) into n from ifc_rev_storey_elements('TST', 1, '2NP', 'Prívod%');
  if n is distinct from 3 then raise exception 'prívod 2NP v1: %', n; end if;
  select count(*) into n from ifc_rev_storey_elements('TST', null, '2NP', 'Prívod%');   -- aktuálna = v2
  if n is distinct from 1 then raise exception 'prívod 2NP v2: %', n; end if;
  select count(*) into n from ifc_rev_storey_elements('TST', 1, 'S2');                  -- podľa GlobalId, bez systému
  if n is distinct from 4 then raise exception 'podlažie podľa GlobalId: %', n; end if;

  select string_agg(global_id || ':' || change_action, ',' order by global_id) into a from ifc_rev_compare('TST', 1, 2);
  if a is distinct from 'K:MODIFIED,N:ADDED,P1:MODIFIED,P2:DELETED,T:MODIFIED,V:MODIFIED' then
    raise exception 'porovnanie: %', a;
  end if;
  select aspects into j from ifc_rev_compare('TST', 1, 2) where global_id = 'P1';
  if j is distinct from '{"psets": ["Qto_DuctSegmentBaseQuantities.Length"]}'::jsonb then raise exception 'P1: %', j; end if;
  select aspects into j from ifc_rev_compare('TST', 1, 2) where global_id = 'K';
  if j is distinct from '{"relations": ["-IfcRelContainedInSpatialStructure:S2", "+IfcRelContainedInSpatialStructure:S3"]}'::jsonb then
    raise exception 'K: %', j;
  end if;
  select aspects into j from ifc_rev_compare('TST', 1, 2) where global_id = 'V';
  if j is distinct from '{"attributes": ["Name"]}'::jsonb then raise exception 'V: %', j; end if;
  select aspects into j from ifc_rev_compare('TST', 1, 2) where global_id = 'S2';
  if j is not null then raise exception 'podlažie nemá byť MODIFIED pri presune klapky: %', j; end if;
end $$;

-- "zmenené cez typ": výskyt bez vlastnej zmeny dostane poznámku, zostane NOCHANGE
update ifc_rev_objects set attributes = '{"Name": "VV.1"}', content_hash = md5('{"Name": "VV.1"}' || 'IfcAirTerminal')
 where revision = 2 and global_id = 'V';
do $$
declare a text; j jsonb;
begin
  select change_action, aspects into a, j from ifc_rev_compare('TST', 1, 2) where global_id = 'V';
  if a is distinct from 'NOCHANGE' or j is distinct from '{"note": "changed via type", "via_type": "T"}'::jsonb then
    raise exception 'cez typ: % %', a, j;
  end if;
  if (select count(*) from ifc_rev_compare('TST', 1, 1)) <> 0 then raise exception 'revízia sama so sebou má zmeny'; end if;
end $$;

-- bez hotovej kópie sa nič nevracia, chyba povie, čo spustiť
insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path)
values ('TST', 3, 2, false, repeat('c', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version, error) values ('TST', 3, repeat('c', 64), 'failed', 1, 'x');
do $$
begin
  perform ifc_rev_compare('TST', 2, 3);
  raise exception 'neúplná revízia prešla';
exception when raise_exception then
  if sqlerrm not like '%etl.revision_copy%' then raise; end if;
end $$;

-- zmazanie poslednej revízie zmaže aj jej kópiu
delete from model_revisions where model = 'TST' and revision = 3;
delete from model_revisions where model = 'TST' and revision = 2;
do $$
begin
  if exists (select 1 from ifc_rev_objects where model = 'TST' and revision = 2) then raise exception 'kópia v2 ostala'; end if;
  if not exists (select 1 from ifc_rev_objects where model = 'TST' and revision = 1) then raise exception 'kópia v1 zmizla'; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ifc_rev_imports', 'ifc_rev_objects', 'ifc_rev_relationships', 'ifc_rev_property_sets'] loop
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') then
      raise exception 'anon/authenticated majú práva na %', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'ifc_rev_compare(text, integer, integer)', 'execute') then
    raise exception 'anon smie volať ifc_rev_compare';
  end if;
  if not has_function_privilege('service_role', 'ifc_rev_compare(text, integer, integer)', 'execute') then
    raise exception 'service_role nesmie volať ifc_rev_compare';
  end if;
end $$;

rollback;
