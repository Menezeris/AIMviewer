-- D-183 K3 krok 4: ifc_storey_map (podlažia naprieč modelmi, R6) a jeho použitie v rel_contained_in_spatial_structure.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ifc_storey_map.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- Podlažia AIM: 1NP a 2NP (jediné), dve podlažia s číslom 3 (3NP a 3.NP = dvojznačné), 4NP bez výšky.
insert into objects (id, object_type, object_ref, name, ifc_type, properties, valid_until) values
  ('00000000-0000-4000-8000-0000000000f1', 'floor', 'S1NP', '1NP', 'IfcBuildingStorey',
     '{"Pset_BuildingStoreyCommon": {"ElevationOfFFLRelative": 0}}', null),
  ('00000000-0000-4000-8000-0000000000f2', 'floor', 'S2NP', '2NP', 'IfcBuildingStorey',
     '{"Pset_BuildingStoreyCommon": {"ElevationOfFFLRelative": 5000}}', null),
  ('00000000-0000-4000-8000-0000000000f3', 'floor', 'S3NP-A', '3NP', 'IfcBuildingStorey', '{}', null),
  ('00000000-0000-4000-8000-0000000000f4', 'floor', 'S3NP-B', '3.NP', 'IfcBuildingStorey', '{}', null),
  ('00000000-0000-4000-8000-0000000000f5', 'floor', 'S4NP', '4NP', 'IfcBuildingStorey', '{}', null),
  ('00000000-0000-4000-8000-0000000000f6', 'floor', 'S6NP', '6NP', 'IfcBuildingStorey', '{}', now()),   -- zaniknuté
  ('00000000-0000-4000-8000-0000000000a1', 'asset', 'SP.1', 'potrubie', 'IfcDuctSegment', '{}', null);
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-0000000000f2', 'A-S2'),     -- 2NP má vlastný uzol (model, ktorý podlažia vlastní)
  ('00000000-0000-4000-8000-0000000000a1', 'V-P1');

insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('SAS', 1, null, true, repeat('1', 64), 1, 'x'),
  ('SVZ', 1, null, false, repeat('2', 64), 1, 'x'), ('SVZ', 2, 1, true, repeat('3', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values
  ('SAS', 1, repeat('1', 64), 'done', 1), ('SVZ', 1, repeat('2', 64), 'done', 1), ('SVZ', 2, repeat('3', 64), 'done', 1);

insert into ifc_rev_objects (model, revision, global_id, ifc_class, attributes, content_hash) values
  ('SAS', 1, 'A-S2', 'IfcBuildingStorey', '{"Name": "2NP"}', 'x'),                              -- guid, bez výšky
  ('SVZ', 1, 'V-OLD', 'IfcBuildingStorey', '{"Name": "1NP"}', 'x'),                              -- stará revízia, mapa ju nevráti
  ('SVZ', 2, 'V-S1', 'IfcBuildingStorey', '{"Name": "1NP_VZT", "Elevation": 0}', 'x'),           -- číslo, výška sedí
  ('SVZ', 2, 'V-S2', 'IfcBuildingStorey', '{"Name": "2. NP", "Elevation": 5200}', 'x'),          -- číslo, výška nesedí
  ('SVZ', 2, 'V-S3', 'IfcBuildingStorey', '{"Name": "3NP", "Elevation": 9200}', 'x'),            -- dvojznačné
  ('SVZ', 2, 'V-S4', 'IfcBuildingStorey', '{"Name": "4NP", "Elevation": "n/a"}', 'x'),           -- výška nie je číslo
  ('SVZ', 2, 'V-S5', 'IfcBuildingStorey', '{"Name": "5NP"}', 'x'),                              -- podlažie AIM neexistuje
  ('SVZ', 2, 'V-S6', 'IfcBuildingStorey', '{"Name": "6NP"}', 'x'),                              -- podlažie AIM zaniklo
  ('SVZ', 2, 'V-SX', 'IfcBuildingStorey', '{"Name": "Strojovňa", "Elevation": 100}', 'x'),       -- bez čísla
  ('SVZ', 2, 'V-NOTSTOREY', 'IfcSpace', '{"Name": "2NP"}', 'x');                                -- nie podlažie

insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  ('SVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S2', 'V-P1', 'IfcBuildingStorey', 'IfcDuctSegment', 'x'),
  ('SVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-S3', 'V-P3', 'IfcBuildingStorey', 'IfcDuctSegment', 'x'),
  ('SVZ', 2, 'IfcRelContainedInSpatialStructure', 'V-SX', 'V-P4', 'IfcBuildingStorey', 'IfcDuctSegment', 'x'),
  ('SAS', 1, 'IfcRelContainedInSpatialStructure', 'A-S2', 'A-W', 'IfcBuildingStorey', 'IfcWall', 'x');

do $$
declare got text; n int;
begin
  -- 1) obsah mapy: pravidlo, dôvod, kontrola výškou
  select string_agg(m.model || ':' || m.name || '>' || coalesce(m.floor_ref, '-') || ':' || coalesce(m.match_rule, '-')
                    || ':' || coalesce(m.reason, '-') || ':' || m.elevation_check, ',' order by m.model, m.global_id)
    into got from ifc_storey_map m where m.model in ('SAS', 'SVZ');
  if got is distinct from
     'SAS:2NP>S2NP:guid:-:unknown,'
     'SVZ:1NP_VZT>S1NP:name_number:-:match,'
     'SVZ:2. NP>S2NP:name_number:-:mismatch,'
     'SVZ:3NP>-:-:ambiguous_floors:unknown,'
     'SVZ:4NP>S4NP:name_number:-:unknown,'
     'SVZ:5NP>-:-:no_floor_for_number:unknown,'
     'SVZ:6NP>-:-:no_floor_for_number:unknown,'
     'SVZ:Strojovňa>-:-:no_number_in_name:unknown' then
    raise exception 'obsah ifc_storey_map: %', got;
  end if;

  -- 2) len aktuálna hotová revízia, len IfcBuildingStorey; nespárované majú to_id null
  if exists (select 1 from ifc_storey_map where global_id in ('V-OLD', 'V-NOTSTOREY')) then
    raise exception 'mapa obsahuje starú revíziu alebo iný objekt ako podlažie';
  end if;
  if exists (select 1 from ifc_storey_map where (to_id is null) <> (match_rule is null) or (to_id is null) = (reason is null)) then
    raise exception 'to_id / match_rule / reason nie sú konzistentné';
  end if;

  -- 3) kľúč (model, revision, global_id) je jedinečný
  select count(*) - count(distinct (model, revision, global_id)) into n from ifc_storey_map;
  if n <> 0 then raise exception 'duplicitné podlažia v mape: %', n; end if;

  -- 4) rel_contained_in_spatial_structure: podlažie z mapy; dvojznačné a bez čísla ostane bez to_id (s container_global_id)
  select string_agg(c.global_id || '@' || coalesce(f.object_ref, '-') || ':' || c.container_global_id, ',' order by c.global_id)
    into got from rel_contained_in_spatial_structure c left join objects f on f.id = c.to_id
   where c.model in ('SAS', 'SVZ');
  if got is distinct from 'A-W@S2NP:A-S2,V-P1@S2NP:V-S2,V-P3@-:V-S3,V-P4@-:V-SX' then
    raise exception 'rel_contained_in_spatial_structure cez mapu: %', got;
  end if;
  if (select from_id from rel_contained_in_spatial_structure where global_id = 'V-P1')
     is distinct from '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'from_id prvku sa zmenil';
  end if;
end $$;

rollback;
