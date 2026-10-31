-- D-183 K3 krok 3: zlúčený IFC typ ako údaj (ifc_guid_aliases), ifc_guid_node s aliasom, rel_defines_by_type bez
-- mosta podľa object_ref, a samostatný krok ukončenia hrán ETL (supabase/pending/) nad testovacími dátami.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ifc_guid_aliases.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- Typ TQ01.06 (GUID Q-T1) zlúčil ďalšie dva IFC typy Q-T2, Q-T3; typ TQ01.07 bez aliasu (most už nie je).
insert into objects (id, object_type, object_ref, name, ifc_type, properties, valid_until) values
  ('00000000-0000-4000-8000-000000000101', 'asset_type', 'TQ01.06', 'TQ01.06', 'IfcDoorType', '{"Pset_DoorCommon": {"FireRating": "EI45"}}', null),
  ('00000000-0000-4000-8000-000000000102', 'asset_type', 'TQ01.07', 'TQ01.07', 'IfcDoorType', '{}', null),
  ('00000000-0000-4000-8000-000000000103', 'asset_type', 'TQ09.09', 'zaniknutý', 'IfcDoorType', '{}', now()),
  ('00000000-0000-4000-8000-000000000111', 'asset', 'TQ01.06.01', 'd1', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-000000000112', 'asset', 'TQ01.06.02', 'd2', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-000000000113', 'asset', 'TQ01.06.03', 'd3', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-000000000114', 'asset', 'TQ01.07.01', 'd4', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-000000000115', 'asset', 'TQ09.09.01', 'd5', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-000000000121', 'floor', 'TQ1NP', '1NP', 'IfcBuildingStorey', '{}', null);
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-000000000101', 'Q-T1'), ('00000000-0000-4000-8000-000000000102', 'Q-T7'),
  ('00000000-0000-4000-8000-000000000111', 'Q-D1'), ('00000000-0000-4000-8000-000000000112', 'Q-D2'),
  ('00000000-0000-4000-8000-000000000113', 'Q-D3'), ('00000000-0000-4000-8000-000000000114', 'Q-D4'),
  ('00000000-0000-4000-8000-000000000115', 'Q-D5'), ('00000000-0000-4000-8000-000000000121', 'Q-S1');
insert into ifc_guid_aliases (object_id, ifc_guid, reason, valid_until, source) values
  ('00000000-0000-4000-8000-000000000101', 'Q-T2', 'type_code', null, 'IFC import:TQA'),
  ('00000000-0000-4000-8000-000000000101', 'Q-T3', 'type_code', null, 'IFC import:TQA'),
  ('00000000-0000-4000-8000-000000000101', 'Q-T8', 'type_code', now(), 'IFC import:TQA'),  -- uzavretý alias
  ('00000000-0000-4000-8000-000000000103', 'Q-T9', 'type_code', null, 'IFC import:TQA'),   -- zaniknutý uzol
  ('00000000-0000-4000-8000-000000000102', 'Q-T1', 'type_code', null, 'IFC import:TQA');   -- GUID je v histórii iného uzla

insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('TQA', 1, null, true, repeat('d', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values ('TQA', 1, repeat('d', 64), 'done', 1);
insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  ('TQA', 1, 'IfcRelDefinesByType', 'Q-T1', 'Q-D1', 'IfcDoorType', 'IfcDoor', 'x'),
  ('TQA', 1, 'IfcRelDefinesByType', 'Q-T2', 'Q-D2', 'IfcDoorType', 'IfcDoor', 'x'),
  ('TQA', 1, 'IfcRelDefinesByType', 'Q-T3', 'Q-D3', 'IfcDoorType', 'IfcDoor', 'x'),
  ('TQA', 1, 'IfcRelDefinesByType', 'Q-T8', 'Q-D4', 'IfcDoorType', 'IfcDoor', 'x'),    -- len uzavretý alias, most by dal TQ01.07
  ('TQA', 1, 'IfcRelDefinesByType', 'Q-T9', 'Q-D5', 'IfcDoorType', 'IfcDoor', 'x');    -- alias na zaniknutý uzol

-- Hrany grafu na krok ukončenia: ETL zo súboru (typy z kópie aj iný typ) a AIM vrstva.
insert into relationships (rel_type, from_id, to_id, role, source) values
  ('rel_defines_by_type', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000101', null, 'etl:TQA'),
  ('rel_contained_in_spatial_structure', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000121', null, 'etl'),
  ('rel_referenced_in_spatial_structure', '00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000121', null, 'etl:TQA'),
  ('rel_defines_by_type', '00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000102', null, 'seed'),
  ('rel_referenced_in_spatial_structure', '00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000121', null, 'derive:spatial_reference');

do $$
declare got text; n int;
begin
  -- 1) ifc_guid_node: aktívny alias živého uzla áno, uzavretý alias, alias zaniknutého uzla a alias GUID z histórie nie
  select string_agg(ifc_guid || '=' || object_ref || ':' || coalesce(alias_reason, 'own'), ',' order by ifc_guid)
    into got
  from ifc_guid_node where ifc_guid like 'Q-T%';
  if got is distinct from 'Q-T1=TQ01.06:own,Q-T2=TQ01.06:type_code,Q-T3=TQ01.06:type_code,Q-T7=TQ01.07:own' then
    raise exception 'ifc_guid_node: %', got;
  end if;

  -- 2) rel_defines_by_type: zlúčené typy cez alias, bez mosta podľa object_ref (Q-D4 by most dal TQ01.07), + AIM vrstva
  select string_agg(f.object_ref || '>' || coalesce(t.object_ref, '-') || ':' || coalesce(d.type_global_id, d.source), ','
                    order by f.object_ref, d.source)
    into got
  from rel_defines_by_type d join objects f on f.id = d.from_id left join objects t on t.id = d.to_id
  where f.object_ref like 'TQ%';
  if got is distinct from 'TQ01.06.01>TQ01.06:Q-T1,TQ01.06.02>TQ01.06:Q-T2,TQ01.06.03>TQ01.06:Q-T3,TQ01.07.01>-:Q-T8,TQ01.07.01>TQ01.07:seed,TQ09.09.01>-:Q-T9' then
    raise exception 'rel_defines_by_type: %', got;
  end if;

  -- 3) v_asset_effective: výskyty zlúčeného typu dedia jeho pset
  select string_agg(object_ref || '=' || coalesce(properties #>> '{Pset_DoorCommon,FireRating}', '-'), ',' order by object_ref)
    into got
  from v_asset_effective where object_ref like 'TQ01.06.%';
  if got is distinct from 'TQ01.06.01=EI45,TQ01.06.02=EI45,TQ01.06.03=EI45' then
    raise exception 'v_asset_effective: %', got;
  end if;

  -- 4) aktívny alias GUID najviac jeden (uniq_active_guid_alias)
  begin
    insert into ifc_guid_aliases (object_id, ifc_guid, source) values ('00000000-0000-4000-8000-000000000102', 'Q-T2', 'x');
    raise exception 'druhý aktívny alias Q-T2 prešiel';
  exception when unique_violation then null;
  end;

  -- 5) krok ukončenia hrán ETL (supabase/pending/20261031190000_end_etl_ifc_edges.sql, podmienka bez zmeny):
  --    ETL hrany typov z kópie áno (etl aj etl:<model>), iný typ ETL, AIM vrstva a derive nie
  update relationships set valid_until = now()
  where valid_until is null
    and not rel_is_aim_layer(source)
    and rel_type in ('rel_aggregates', 'rel_contained_in_spatial_structure', 'rel_defines_by_type',
                     'rel_assigns_to_group', 'rel_associates_document', 'rel_associates_classification');
  select string_agg(r.rel_type || ':' || r.source || ':' || (r.valid_until is null)::text, ',' order by r.rel_type, r.source)
    into got
  from relationships r join objects f on f.id = r.from_id where f.object_ref like 'TQ%';
  if got is distinct from 'rel_contained_in_spatial_structure:etl:false,rel_defines_by_type:etl:TQA:false,'
                          'rel_defines_by_type:seed:true,rel_referenced_in_spatial_structure:derive:spatial_reference:true,'
                          'rel_referenced_in_spatial_structure:etl:TQA:true' then
    raise exception 'ukončenie hrán ETL: %', got;
  end if;
  -- pohľad sa ukončením nemení (ETL hrany nečítal)
  select count(*) into n from rel_defines_by_type d join objects f on f.id = d.from_id where f.object_ref like 'TQ%';
  if n <> 6 then raise exception 'rel_defines_by_type po ukončení: %', n; end if;
end $$;

rollback;
