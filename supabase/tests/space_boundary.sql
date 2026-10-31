-- D-156: v_space_elements s relation = 'boundary' nad syntetickými dátami.
-- Spustenie (na lokálnej DB s aplikovanými migráciami, nikdy na produkcii):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/space_boundary.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

insert into objects (id, object_type, object_ref, name, ifc_type) values
  ('00000000-0000-4000-8000-000000000001', 'space', 'T1.01', 'T1.01', 'IfcSpace'),
  ('00000000-0000-4000-8000-000000000002', 'space', 'T1.02', 'T1.02', 'IfcSpace'),
  ('00000000-0000-4000-8000-000000000003', 'floor', 'T1NP', '1NP', 'IfcBuildingStorey'),
  ('00000000-0000-4000-8000-0000000000a1', 'asset', 'TD.only_boundary', 'len hranica', 'IfcDoor'),
  ('00000000-0000-4000-8000-0000000000a2', 'asset', 'TD.contained_and_boundary', 'obe', 'IfcDoor'),
  ('00000000-0000-4000-8000-0000000000a3', 'asset', 'TD.referenced_and_boundary', 'odkaz aj hranica', 'IfcDoor'),
  ('00000000-0000-4000-8000-0000000000a4', 'asset', 'TD.closed_boundary', 'ukoncena hranica', 'IfcDoor'),
  ('00000000-0000-4000-8000-0000000000a5', 'asset', 'TD.two_rooms', 'medzi dvomi', 'IfcDoor');
insert into spaces (id, long_name) values
  ('00000000-0000-4000-8000-000000000001', 'Lobby'),
  ('00000000-0000-4000-8000-000000000002', 'Chodba');

-- Umiestnenie zo súboru je od D-183 K3 z kópie revízie (rel_contained_in_spatial_structure nad ifc_rev_relationships).
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-000000000001', 'G-T1.01'), ('00000000-0000-4000-8000-000000000003', 'G-T1NP'),
  ('00000000-0000-4000-8000-0000000000a1', 'G-a1'), ('00000000-0000-4000-8000-0000000000a2', 'G-a2');
insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path)
  values ('TSB', 1, null, true, repeat('c', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values ('TSB', 1, repeat('c', 64), 'done', 1);
insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  -- DD01.08 z issue #245: na podlaží, s miestnosťou ho spája len hranica
  ('TSB', 1, 'IfcRelContainedInSpatialStructure', 'G-T1NP', 'G-a1', 'IfcBuildingStorey', 'IfcDoor', 'h1'),
  -- v miestnosti aj hranica: ostáva jeden riadok 'contained'
  ('TSB', 1, 'IfcRelContainedInSpatialStructure', 'G-T1.01', 'G-a2', 'IfcSpace', 'IfcDoor', 'h2');

insert into relationships (rel_type, from_id, to_id, role, valid_until, source) values
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'physical', null, 'etl'),
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'physical', null, 'etl'),
  -- odvodená referencia aj hranica: jeden riadok 'referenced'
  ('rel_referenced_in_spatial_structure', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'inside', null, 'derive:spatial_reference'),
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'virtual', null, 'etl'),
  -- ukončená (neaktívna) hranica sa nezobrazí
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'physical', now(), 'etl'),
  -- dvere medzi dvoma miestnosťami: riadok v oboch
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-000000000001', 'physical', null, 'etl'),
  ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-000000000002', 'physical', null, 'etl');

do $$
declare
  got text;
begin
  -- 1) T1.01: presne tieto páry s touto reláciou a rolou, žiadne duplicity
  select string_agg(element_ref || ':' || relation || ':' || coalesce(role, '-'), ',' order by element_ref)
    into got from v_space_elements where space_ref = 'T1.01';
  if got is distinct from
     'TD.contained_and_boundary:contained:-,TD.only_boundary:boundary:physical,'
     'TD.referenced_and_boundary:referenced:inside,TD.two_rooms:boundary:physical' then
    raise exception 'T1.01: nečakaný obsah v_space_elements: %', got;
  end if;

  -- 2) T1.02: len dvere medzi miestnosťami
  select string_agg(element_ref || ':' || relation, ',') into got
    from v_space_elements where space_ref = 'T1.02';
  if got is distinct from 'TD.two_rooms:boundary' then
    raise exception 'T1.02: nečakaný obsah: %', got;
  end if;

  -- 3) filtre z query_view (space_ref + element_ifc_type) nájdu dvere len s hranicou
  if not exists (select 1 from v_space_elements
                 where space_ref = 'T1.01' and element_ifc_type = 'IfcDoor'
                   and element_ref = 'TD.only_boundary' and relation = 'boundary') then
    raise exception 'dvere spojené len hranicou chýbajú vo v_space_elements';
  end if;

  -- 4) rel_space_boundary pustí len prvok -> priestor (trigger z manifestu)
  begin
    insert into relationships (rel_type, from_id, to_id)
    values ('rel_space_boundary', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000003');
    raise exception 'hranica na podlažie mala byť odmietnutá';
  exception when others then
    if sqlerrm not like 'relationships(rel_space_boundary): to object_type%' then raise; end if;
  end;
end $$;

rollback;
