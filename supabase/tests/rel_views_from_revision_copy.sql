-- D-183 K3 krok 2b: rel_aggregates, rel_defines_by_type, rel_assigns_to_group, rel_associates_document,
-- rel_associates_classification z kópie revízie (ifc_rev_relationships) + hrany AIM vrstvy z relationships.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rel_views_from_revision_copy.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- Uzly AIM (ASR "TAS" + VZT "TVZ"): podlažie, miestnosť, schodisko so zábradlím, dvere dvoch IFC typov zlúčených
-- do jedného typu AIM (typový kód TD01.01), systém s vyústkou, zóna, výkres, strana, klasifikácia.
insert into objects (id, object_type, object_ref, name, ifc_type, properties, valid_until) values
  ('00000000-0000-4000-8000-0000000000f2', 'floor', 'T2NP', '2NP', 'IfcBuildingStorey', '{}', null),
  ('00000000-0000-4000-8000-0000000000e1', 'space', 'T2.01', 'T2.01', 'IfcSpace', '{}', null),
  ('00000000-0000-4000-8000-0000000000a1', 'asset', 'TS01.01.01', 'schodisko', 'IfcStair', '{}', null),
  ('00000000-0000-4000-8000-0000000000a2', 'asset', 'TZ01.01.01', 'zábradlie', 'IfcRailing', '{}', null),
  ('00000000-0000-4000-8000-0000000000a3', 'asset', 'TD01.01.01', 'dvere 1', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-0000000000a4', 'asset', 'TD01.01.02', 'dvere 2', 'IfcDoor', '{}', null),
  ('00000000-0000-4000-8000-0000000000a5', 'asset', 'TV.01', 'vyústka', 'IfcAirTerminal', '{}', null),
  ('00000000-0000-4000-8000-0000000000a6', 'asset', 'TX.01', 'zaniknutá', 'IfcDoor', '{}', now()),
  ('00000000-0000-4000-8000-0000000000c1', 'asset_type', 'TD01.01', 'TD01.01', 'IfcDoorType',
   '{"Pset_DoorCommon": {"FireRating": "EI30"}}', null),
  ('00000000-0000-4000-8000-0000000000c2', 'system', 'TSYS.1', 'Prívod 1', 'IfcDistributionSystem', '{}', null),
  ('00000000-0000-4000-8000-0000000000c3', 'zone', 'TZN.1', 'Zóna', 'IfcZone', '{}', null),
  ('00000000-0000-4000-8000-0000000000d1', 'document', 'TDOC_PODORYS', 'Pôdorys', 'IfcDocumentInformation', '{}', null),
  ('00000000-0000-4000-8000-0000000000d2', 'document_reference', 'TDOC_PODORYS#page=2', 'strana 2', 'IfcDocumentReference', '{}', null),
  ('00000000-0000-4000-8000-0000000000d3', 'document', 'TDOC_DUP1', 'dup 1', 'IfcDocumentInformation', '{}', null),
  ('00000000-0000-4000-8000-0000000000d4', 'document', 'TDOC_DUP2', 'dup 2', 'IfcDocumentInformation', '{}', null);
insert into documents (id, identification, storage_type) values
  ('00000000-0000-4000-8000-0000000000d1', 'TDOC_PODORYS', 'supabase'),
  ('00000000-0000-4000-8000-0000000000d2', 'page=2', 'supabase'),
  ('00000000-0000-4000-8000-0000000000d3', 'TDOC_DUP', 'supabase'),   -- rovnaká Identification dvakrát = bez cieľa
  ('00000000-0000-4000-8000-0000000000d4', 'TDOC_DUP', 'supabase');
insert into classification_systems (id, name) values ('00000000-0000-4000-8000-0000000000b1', 'TSNIM');
insert into classification_references (id, system_id, identification, name) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'TDD01', 'Dvere');
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-0000000000f2', 'A-S2'), ('00000000-0000-4000-8000-0000000000e1', 'A-R1'),
  ('00000000-0000-4000-8000-0000000000a1', 'A-STAIR'), ('00000000-0000-4000-8000-0000000000a2', 'A-RAIL'),
  ('00000000-0000-4000-8000-0000000000a3', 'A-D1'), ('00000000-0000-4000-8000-0000000000a4', 'A-D2'),
  ('00000000-0000-4000-8000-0000000000a5', 'V-T1'), ('00000000-0000-4000-8000-0000000000a6', 'A-DEAD'),
  ('00000000-0000-4000-8000-0000000000c1', 'A-DT1'), ('00000000-0000-4000-8000-0000000000c2', 'V-SYS'),
  ('00000000-0000-4000-8000-0000000000c3', 'A-ZN');
-- Zlúčený typ A-DT2 (D-033) je od D-183 K3 kroku 3 údaj: alias GUID na ten istý asset_type (predtým most podľa object_ref).
insert into ifc_guid_aliases (object_id, ifc_guid, reason, source) values
  ('00000000-0000-4000-8000-0000000000c1', 'A-DT2', 'type_code', 'IFC import:TAS');

-- Hrany grafu: ETL (pohľady ich nečítajú) a AIM vrstva (E4 výkres -> prvok, ostáva).
insert into relationships (rel_type, from_id, to_id, role, source) values
  ('rel_aggregates', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f2', null, 'etl:TAS'),
  ('rel_associates_document', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', 'document', 'etl:TAS'),
  ('rel_associates_document', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000d1', 'drawing', 'pdf_link (E4)');

-- TAS v1 hotová a aktuálna; TVZ v1 hotová, v2 aktuálna bez kópie (pohľady berú v1).
insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('TAS', 1, null, true, repeat('a', 64), 1, 'x'),
  ('TVZ', 1, null, false, repeat('b', 64), 1, 'x'), ('TVZ', 2, 1, true, repeat('c', 64), 1, 'x');
insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values
  ('TAS', 1, repeat('a', 64), 'done', 1), ('TVZ', 1, repeat('b', 64), 'done', 1);

insert into ifc_rev_relationships (model, revision, rel_class, relating, related, relating_class, related_class, content_hash) values
  -- agregácia: miestnosť v podlaží, zábradlie v schodisku, prút závesovej steny bez uzla, budova VZT -> podlažie VZT
  ('TAS', 1, 'IfcRelAggregates', 'A-S2', 'A-R1', 'IfcBuildingStorey', 'IfcSpace', 'x'),
  ('TAS', 1, 'IfcRelAggregates', 'A-STAIR', 'A-RAIL', 'IfcStair', 'IfcRailing', 'x'),
  ('TAS', 1, 'IfcRelAggregates', 'A-CW', 'A-MEMBER', 'IfcCurtainWall', 'IfcMember', 'x'),
  ('TVZ', 1, 'IfcRelAggregates', 'V-B', 'V-S2', 'IfcBuilding', 'IfcBuildingStorey', 'x'),
  -- typ: dvere 1 cez GlobalId typu, dvere 2 cez zlúčený typ (A-DT2 nemá uzol, typový kód TD01.01), zaniknutý výskyt
  ('TAS', 1, 'IfcRelDefinesByType', 'A-DT1', 'A-D1', 'IfcDoorType', 'IfcDoor', 'x'),
  ('TAS', 1, 'IfcRelDefinesByType', 'A-DT2', 'A-D2', 'IfcDoorType', 'IfcDoor', 'x'),
  ('TAS', 1, 'IfcRelDefinesByType', 'A-DT2', 'A-DEAD', 'IfcDoorType', 'IfcDoor', 'x'),
  -- skupina: miestnosť v zóne, vyústka v systéme, port bez uzla v systéme
  ('TAS', 1, 'IfcRelAssignsToGroup', 'A-ZN', 'A-R1', 'IfcZone', 'IfcSpace', 'x'),
  ('TVZ', 1, 'IfcRelAssignsToGroup', 'V-SYS', 'V-T1', 'IfcDistributionSystem', 'IfcAirTerminal', 'x'),
  ('TVZ', 1, 'IfcRelAssignsToGroup', 'V-SYS', 'V-PORT', 'IfcDistributionSystem', 'IfcDistributionPort', 'x'),
  -- dokument: na type (dedí výskyt), strana na miestnosti, dvojznačná Identification, projekt VZT bez uzla
  ('TAS', 1, 'IfcRelAssociatesDocument', 'IfcDocumentInformation:TDOC_PODORYS', 'A-DT1', 'IfcDocumentInformation', 'IfcDoorType', 'x'),
  ('TAS', 1, 'IfcRelAssociatesDocument', 'IfcDocumentReference:page=2', 'A-R1', 'IfcDocumentReference', 'IfcSpace', 'x'),
  ('TAS', 1, 'IfcRelAssociatesDocument', 'IfcDocumentInformation:TDOC_DUP', 'A-S2', 'IfcDocumentInformation', 'IfcBuildingStorey', 'x'),
  ('TVZ', 1, 'IfcRelAssociatesDocument', 'IfcDocumentInformation:TDOC_PODORYS', 'V-PROJ', 'IfcDocumentInformation', 'IfcProject', 'x'),
  -- klasifikácia: známa referencia, neznáma referencia, celá klasifikácia na projekte
  ('TAS', 1, 'IfcRelAssociatesClassification', 'IfcClassificationReference:TDD01', 'A-D1', 'IfcClassificationReference', 'IfcDoor', 'x'),
  ('TAS', 1, 'IfcRelAssociatesClassification', 'IfcClassificationReference:TXX99', 'A-D2', 'IfcClassificationReference', 'IfcDoor', 'x'),
  ('TAS', 1, 'IfcRelAssociatesClassification', 'IfcClassification:TSNIM', 'A-PROJ', 'IfcClassification', 'IfcProject', 'x');

do $$
declare got text; n int;
begin
  -- 1) rel_aggregates: oba konce cez GlobalId, časť bez uzla a podlažie VZT majú from_id null, hrana ETL sa nečíta
  select string_agg(coalesce(f.object_ref, '-') || '<' || coalesce(t.object_ref, '-') || ':' || coalesce(a.global_id, '')
                    || '<' || coalesce(a.parent_global_id, '') || ':' || a.source, ',' order by a.global_id)
    into got
  from rel_aggregates a left join objects f on f.id = a.from_id left join objects t on t.id = a.to_id
  where a.model in ('TAS', 'TVZ') or a.from_id = '00000000-0000-4000-8000-0000000000e1';
  if got is distinct from
     '-<-:A-MEMBER<A-CW:ifc:TAS v1,T2.01<T2NP:A-R1<A-S2:ifc:TAS v1,TZ01.01.01<TS01.01.01:A-RAIL<A-STAIR:ifc:TAS v1,-<-:V-S2<V-B:ifc:TVZ v1' then
    raise exception 'rel_aggregates: %', got;
  end if;

  -- 2) rel_defines_by_type: zlúčený typ cez alias GUID (ifc_guid_aliases), zaniknutý výskyt from_id null
  select string_agg(coalesce(f.object_ref, '-') || '>' || coalesce(t.object_ref, '-') || ':' || d.type_global_id, ',' order by d.global_id)
    into got
  from rel_defines_by_type d left join objects f on f.id = d.from_id left join objects t on t.id = d.to_id
  where d.model = 'TAS';
  if got is distinct from 'TD01.01.01>TD01.01:A-DT1,TD01.01.02>TD01.01:A-DT2,->TD01.01:A-DT2' then
    raise exception 'rel_defines_by_type: %', got;
  end if;

  -- 3) v_asset_effective: jeden riadok na výskyt, oba dvere dedia pset typu
  select count(*), string_agg(object_ref || '=' || coalesce(properties #>> '{Pset_DoorCommon,FireRating}', '-'), ',' order by object_ref)
    into n, got
  from v_asset_effective where object_ref like 'TD01.01.%';
  if n <> 2 or got is distinct from 'TD01.01.01=EI30,TD01.01.02=EI30' then
    raise exception 'v_asset_effective: % %', n, got;
  end if;

  -- 4) rel_assigns_to_group: port bez uzla má from_id null a global_id, členovia s uzlom ostávajú
  select string_agg(coalesce(f.object_ref, '-') || '>' || coalesce(t.object_ref, '-') || ':' || g.global_id, ',' order by g.global_id)
    into got
  from rel_assigns_to_group g left join objects f on f.id = g.from_id left join objects t on t.id = g.to_id
  where g.model in ('TAS', 'TVZ');
  if got is distinct from 'T2.01>TZN.1:A-R1,->TSYS.1:V-PORT,TV.01>TSYS.1:V-T1' then
    raise exception 'rel_assigns_to_group: %', got;
  end if;

  -- 5) rel_associates_document: dokument a strana podľa Identification, dvojznačná bez cieľa, E4 z AIM vrstvy ostáva,
  --    ETL hrana nie
  select string_agg(coalesce(f.object_ref, '-') || '>' || coalesce(t.object_ref, '-') || ':' || d.role || ':'
                    || coalesce(d.document_key, '') || ':' || d.source, ',' order by coalesce(d.document_key, ''), d.global_id)
    into got
  from rel_associates_document d left join objects f on f.id = d.from_id left join objects t on t.id = d.to_id
  where d.model in ('TAS', 'TVZ') or d.source = 'pdf_link (E4)' or d.source like 'etl%';
  if got is distinct from
     'TD01.01.01>TDOC_PODORYS:drawing::pdf_link (E4),'
     'T2NP>-:document:IfcDocumentInformation:TDOC_DUP:ifc:TAS v1,'
     'TD01.01>TDOC_PODORYS:document:IfcDocumentInformation:TDOC_PODORYS:ifc:TAS v1,'
     '->TDOC_PODORYS:document:IfcDocumentInformation:TDOC_PODORYS:ifc:TVZ v1,'
     'T2.01>TDOC_PODORYS#page=2:document:IfcDocumentReference:page=2:ifc:TAS v1' then
    raise exception 'rel_associates_document: %', got;
  end if;

  -- 6) v_object_documents: dvere dedia pôdorys cez typ (zo súboru), E4 väzba sa nepočíta
  select string_agg(ob.object_ref || ':' || od.via, ',' order by ob.object_ref)
    into got
  from v_object_documents od join objects ob on ob.id = od.object_id
  where od.document_id = '00000000-0000-4000-8000-0000000000d1';
  if got is distinct from 'TD01.01:direct,TD01.01.01:type,TD01.01.02:type' then
    raise exception 'v_object_documents: %', got;
  end if;

  -- 7) rel_associates_classification: známa referencia, neznáma a celá klasifikácia bez cieľa; v_asset_classifications
  select string_agg(coalesce(f.object_ref, '-') || '>' || coalesce(c.identification, '-') || ':' || k.classification_key, ','
                    order by k.classification_key)
    into got
  from rel_associates_classification k left join objects f on f.id = k.from_id
  left join classification_references c on c.id = k.to_id
  where k.model = 'TAS';
  if got is distinct from '->-:IfcClassification:TSNIM,TD01.01.01>TDD01:IfcClassificationReference:TDD01,TD01.01.02>-:IfcClassificationReference:TXX99' then
    raise exception 'rel_associates_classification: %', got;
  end if;
  select count(*) into n from v_asset_classifications where classification_ref_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 1 then raise exception 'v_asset_classifications: %', n; end if;

  -- 8) id stabilné a jedinečné v každom pohľade, valid_until pri riadkoch zo súboru null
  if (select id from rel_aggregates where global_id = 'A-RAIL')
     is distinct from md5('TAS|1|IfcRelAggregates|A-STAIR|A-RAIL')::uuid then
    raise exception 'id nie je z (model, revízia, trieda, Relating, Related)';
  end if;
  select (select count(*) - count(distinct id) from rel_aggregates) + (select count(*) - count(distinct id) from rel_defines_by_type)
       + (select count(*) - count(distinct id) from rel_assigns_to_group) + (select count(*) - count(distinct id) from rel_associates_document)
       + (select count(*) - count(distinct id) from rel_associates_classification) into n;
  if n <> 0 then raise exception 'duplicitné id: %', n; end if;
  if exists (select 1 from rel_assigns_to_group where model is not null and valid_until is not null) then
    raise exception 'valid_until má byť null';
  end if;

  -- 9) hotová kópia aktuálnej revízie VZT má prednosť (prázdna = žiadne riadky VZT)
  insert into ifc_rev_imports (model, revision, sha256, status, hash_version) values ('TVZ', 2, repeat('c', 64), 'done', 1);
  select count(*) into n from rel_assigns_to_group where model = 'TVZ';
  if n <> 0 then raise exception 'TVZ v2 je prázdna kópia, pohľad má vrátiť 0, vrátil %', n; end if;
end $$;

rollback;
