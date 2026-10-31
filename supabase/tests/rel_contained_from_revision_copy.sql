-- D-183 K3 krok 2: rel_contained_in_spatial_structure z kópie revízie (ifc_rev_relationships).
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rel_contained_from_revision_copy.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- Uzly AIM: podlažie 2NP (z ASR), miestnosť, potrubie, vyústka, schodisko (bez uzla), zábradlie v ňom, zaniknutý prvok.
insert into objects (id, object_type, object_ref, name, ifc_type, valid_until) values
  ('00000000-0000-4000-8000-0000000000f2', 'floor', 'T2NP', '2NP', 'IfcBuildingStorey', null),
  ('00000000-0000-4000-8000-0000000000f3', 'floor', 'T3NP', '3NP', 'IfcBuildingStorey', null),
  ('00000000-0000-4000-8000-0000000000e1', 'space', 'T2.01', 'T2.01', 'IfcSpace', null),
  ('00000000-0000-4000-8000-0000000000a1', 'asset', 'TP.1', 'potrubie', 'IfcDuctSegment', null),
  ('00000000-0000-4000-8000-0000000000a2', 'asset', 'TV.1', 'vyústka', 'IfcAirTerminal', null),
  ('00000000-0000-4000-8000-0000000000a3', 'asset', 'TZ.1', 'zábradlie', 'IfcRailing', null),
  ('00000000-0000-4000-8000-0000000000a4', 'asset', 'TX.1', 'zaniknutý', 'IfcDamper', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'spatial_zone', 'TSZ.1', 'zóna', 'IfcSpatialZone', null);
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-0000000000f2', 'A-S2'), ('00000000-0000-4000-8000-0000000000e1', 'A-R1'),
  ('00000000-0000-4000-8000-0000000000a1', 'V-P1'), ('00000000-0000-4000-8000-0000000000a2', 'V-T1'),
  ('00000000-0000-4000-8000-0000000000a3', 'A-RAIL'), ('00000000-0000-4000-8000-0000000000a4', 'V-DEAD'),
  ('00000000-0000-4000-8000-0000000000b1', 'A-SZ');

-- Stará hrana grafu (ETL): pohľad ju už nečíta.
insert into relationships (rel_type, from_id, to_id, source) values
  ('rel_contained_in_spatial_structure', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000f3', 'etl:TVZ');

-- TVZ: v1 a v2 hotové, v3 aktuálna, ale kópia ešte nie je (pohľad berie v2). TAS: v1 hotová a aktuálna.
insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('TVZ', 1, null, false, repeat('1', 64), 1, 'x'), ('TVZ', 2, 1, false, repeat('2', 64), 1, 'x'),
  ('TVZ', 3, 2, true, repeat('3', 64), 1, 'x'), ('TAS', 1, null, true, repeat('4', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values
  ('TVZ', 1, repeat('1', 64), 'done', 1), ('TVZ', 2, repeat('2', 64), 'done', 1), ('TAS', 1, repeat('4', 64), 'done', 1);

insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash) values
  ('TVZ', 1, 'V-S2', 'IfcBuildingStorey', '{"Name": "3NP"}', 'x'),
  ('TVZ', 2, 'V-S2', 'IfcBuildingStorey', '{"Name": "2.NP_VZT"}', 'x'),   -- podlažie bez uzla, mapuje sa podľa mena
  ('TVZ', 2, 'V-SX', 'IfcBuildingStorey', '{"Name": "Strojovňa"}', 'x'),  -- bez čísla podlažia = bez uzla
  ('TAS', 1, 'A-S2', 'IfcBuildingStorey', '{"Name": "2NP"}', 'x');

insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  ('TVZ', 1, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-P1', 'IfcBuildingStorey', 'IfcDuctSegment', 'x'),
  ('TVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-P1', 'IfcBuildingStorey', 'IfcDuctSegment', 'x'),
  ('TVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-T1', 'IfcBuildingStorey', 'IfcAirTerminal', 'x'),
  ('TVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-NEW', 'IfcBuildingStorey', 'IfcDuctFitting', 'x'),
  ('TVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-DEAD', 'IfcBuildingStorey', 'IfcDamper', 'x'),
  ('TVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-SX', 'V-FAN', 'IfcBuildingStorey', 'IfcFan', 'x'),
  ('TAS', 1, 'IfcRelContainedInSpatialStructure', 'A-S2', 'A-STAIR', 'IfcBuildingStorey', 'IfcStair', 'x'),
  ('TAS', 1, 'IfcRelContainedInSpatialStructure', 'A-S2', 'A-SZ-TOP', 'IfcBuildingStorey', 'IfcSpatialZone', 'x'),
  ('TAS', 1, 'IfcRelContainedInSpatialStructure', 'A-R1', 'A-DOOR', 'IfcSpace', 'IfcDoor', 'x'),
  -- časti zostáv: zábradlie (asset) dedí podlažie schodiska, rameno bez uzla nie, zóna (nie asset) nie
  ('TAS', 1, 'IfcRelAggregates', 'A-STAIR', 'A-RAIL', 'IfcStair', 'IfcRailing', 'x'),
  ('TAS', 1, 'IfcRelAggregates', 'A-STAIR', 'A-FLIGHT', 'IfcStair', 'IfcStairFlight', 'x'),
  ('TAS', 1, 'IfcRelAggregates', 'A-SZ-TOP', 'A-SZ', 'IfcSpatialZone', 'IfcSpatialZone', 'x');

do $$
declare got text; n int; j jsonb;
begin
  -- 1) celý obsah: prvok, kontajner, revízia, celok; podlažie VZT bez uzla -> 2NP podľa mena
  select string_agg(coalesce(e.object_ref, '-') || '@' || coalesce(f.object_ref, '-') || ':' || c.global_id || ':'
                    || c.container_global_id || ':' || c.model || ' v' || c.revision || ':' || coalesce(c.via_global_id, '-')
                    || ':' || c.source, ',' order by c.global_id)
    into got
  from rel_contained_in_spatial_structure c
  left join objects e on e.id = c.from_id left join objects f on f.id = c.to_id
  where c.model in ('TVZ', 'TAS');
  if got is distinct from
     '-@T2.01:A-DOOR:A-R1:TAS v1:-:ifc:TAS v1,'
     'TZ.1@T2NP:A-RAIL:A-S2:TAS v1:A-STAIR:ifc:TAS v1,'
     '-@T2NP:A-STAIR:A-S2:TAS v1:-:ifc:TAS v1,'
     '-@T2NP:A-SZ-TOP:A-S2:TAS v1:-:ifc:TAS v1,'
     '-@T2NP:V-DEAD:V-S2:TVZ v2:-:ifc:TVZ v2,'
     '-@-:V-FAN:V-SX:TVZ v2:-:ifc:TVZ v2,'
     '-@T2NP:V-NEW:V-S2:TVZ v2:-:ifc:TVZ v2,'
     'TP.1@T2NP:V-P1:V-S2:TVZ v2:-:ifc:TVZ v2,'
     'TV.1@T2NP:V-T1:V-S2:TVZ v2:-:ifc:TVZ v2' then
    raise exception 'obsah pohľadu: %', got;
  end if;

  -- 2) stará hrana z relationships (TV.1 v 3NP) sa nečíta, valid_until je vždy null
  if exists (select 1 from rel_contained_in_spatial_structure where to_id = '00000000-0000-4000-8000-0000000000f3') then
    raise exception 'pohľad číta hrany grafu';
  end if;
  if exists (select 1 from rel_contained_in_spatial_structure where valid_until is not null) then
    raise exception 'valid_until má byť null';
  end if;

  -- 3) id je stabilné a jedinečné
  select count(*) - count(distinct id) into n from rel_contained_in_spatial_structure;
  if n <> 0 then raise exception 'duplicitné id: %', n; end if;
  if (select id from rel_contained_in_spatial_structure where global_id = 'V-P1')
     is distinct from md5('TVZ|2|V-S2|V-P1')::uuid then
    raise exception 'id nie je z (model, revízia, kontajner, prvok)';
  end if;

  -- 4) dotaz ako v tooloch (podľa from_id a podľa to_id)
  select string_agg(global_id, ',' order by global_id) into got from rel_contained_in_spatial_structure
   where to_id = '00000000-0000-4000-8000-0000000000f2' and from_id is not null;
  if got is distinct from 'A-RAIL,V-P1,V-T1' then raise exception 'prvky AIM v 2NP: %', got; end if;

  -- 5) v_space_elements berie contained z kópie (prvok bez uzla AIM sa neukáže)
  select count(*) into n from v_space_elements where space_ref = 'T2.01';
  if n <> 0 then raise exception 'v_space_elements: prvok bez uzla sa nemá ukázať: %', n; end if;

  -- 6) hotová kópia aktuálnej revízie má prednosť
  insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values ('TVZ', 3, repeat('3', 64), 'done', 1);
  select count(*) into n from rel_contained_in_spatial_structure where model = 'TVZ';
  if n <> 0 then raise exception 'TVZ v3 je prázdna kópia, pohľad má vrátiť 0, vrátil %', n; end if;
end $$;

rollback;
