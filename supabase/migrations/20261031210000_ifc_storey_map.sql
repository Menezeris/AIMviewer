-- D-183 K3 krok 4 (R6, #220): podlažia naprieč modelmi ako pohľad `ifc_storey_map`, nie implicitne v pohľade
-- `rel_contained_in_spatial_structure` (CTE floor_by_np) ani v ETL.
--
-- Riadok = každé IfcBuildingStorey z kópie aktuálnej `done` revízie každého modelu (`ifc_rev_current`):
--   model, revision, global_id (storey), name, elevation  - z kópie revízie (`ifc_rev_objects`);
--   to_id, floor_ref, floor_name                           - podlažie AIM (`objects.object_type = 'floor'`), alebo null;
--   match_rule                                             - ako sa spárovalo:
--       'guid'        = storey má vlastný uzol AIM (GlobalId v ifc_guid_node, napr. ASR - model, ktorý podlažia vlastní);
--       'name_number' = číslo podlažia z mena (`ifc_np_key`: 2NP, 2.NP, 2. NP, 2NP_VZT) sa zhoduje s jediným podlažím AIM
--                       (disciplinárny model bez vlastných uzlov podlaží, D-049; napr. VZT);
--       null          = nespárované, `reason` povie prečo:
--       'no_number_in_name'  = v mene nie je číslo podlažia (Strojovňa, Spadova vrstva);
--       'no_floor_for_number' = číslo je, ale podlažie AIM s ním neexistuje;
--       'ambiguous_floors'   = číslo zodpovedá viac podlažiam AIM (nevyberá sa ticho prvé, ako robil CTE floor_by_np);
--   elevation_check, floor_elevation                        - kontrola výškou: `Elevation` storey z kópie voči
--                                                             `Pset_BuildingStoreyCommon.ElevationOfFFLRelative` podlažia AIM
--                                                             (obe v jednotke kópie, tu mm; tolerancia 1): 'match' | 'mismatch'
--                                                             | 'unknown' (chýba na jednej strane, napr. ASR nemá Elevation
--                                                             v kópii). Je to len kontrola, párovanie nemení.
-- Pravidlo: vlastný uzol cez GlobalId má prednosť, inak číslo z mena. Fallback na najbližšiu eleváciu (ako ETL federácie)
-- sa nepreberá: nič ho dnes nepotrebuje a tichý odhad by bol proti princípu "nejednoznačné viditeľne".
--
-- `rel_contained_in_spatial_structure` ho používa namiesto CTE floor_by_np: výsledok rovnaký (VZT 1NP 43, 2NP 510, 3NP 510,
-- 4NP 12; ASR 253/167/167/149/30), nová je len viditeľnosť nejednoznačnosti. Telo pohľadu inak bez zmeny.
-- Pohľad je len na čítanie pre service_role (ako ostatné pohľady nad kópiou, default privileges 20261016120000).
--
-- Rollback (pohľad rel_contained_in_spatial_structure späť na CTE floor_by_np, potom zrušiť mapu):
--   1) create or replace view rel_contained_in_spatial_structure ... telo z migrácie 20261031120000 (CTE floor_by_np);
--   2) drop view ifc_storey_map;

begin;

create or replace view ifc_storey_map as
with
  floors as (
    select o.id, o.object_ref, o.name,
           ifc_np_key(coalesce(o.name, o.object_ref)) as np,
           case when o.properties #>> '{Pset_BuildingStoreyCommon,ElevationOfFFLRelative}' ~ '^-?\d+(\.\d+)?$'
                then (o.properties #>> '{Pset_BuildingStoreyCommon,ElevationOfFFLRelative}')::numeric end as elevation
    from objects o
    where o.object_type = 'floor' and o.valid_until is null
  ),
  storeys as (
    select o.model, o.revision, o.global_id,
           o.attributes ->> 'Name' as name,
           ifc_np_key(o.attributes ->> 'Name') as np,
           case when o.attributes ->> 'Elevation' ~ '^-?\d+(\.\d+)?$'
                then (o.attributes ->> 'Elevation')::numeric end as elevation
    from ifc_rev_objects o
    join ifc_rev_current c on c.model = o.model and c.revision = o.revision
    where o.ifc_class = 'IfcBuildingStorey'
  ),
  matched as (
    select s.*,
           own.object_id as own_id,
           (select count(*) from floors f where s.np is not null and f.np = s.np) as np_count,
           (select f.id from floors f where s.np is not null and f.np = s.np order by f.object_ref limit 1) as np_id
    from storeys s
    left join ifc_guid_node own on own.ifc_guid = s.global_id and own.object_type = 'floor'
  ),
  resolved as (
    select m.*,
           case when m.own_id is not null then m.own_id
                when m.np_count = 1 then m.np_id end as floor_id,
           case when m.own_id is not null then 'guid'
                when m.np_count = 1 then 'name_number' end as match_rule,
           case when m.own_id is not null or m.np_count = 1 then null
                when m.np is null then 'no_number_in_name'
                when m.np_count = 0 then 'no_floor_for_number'
                else 'ambiguous_floors' end as reason
    from matched m
  )
select
  r.model,
  r.revision,
  r.global_id,
  r.name,
  r.elevation,
  r.floor_id as to_id,
  f.object_ref as floor_ref,
  f.name as floor_name,
  r.match_rule,
  r.reason,
  f.elevation as floor_elevation,
  case when r.floor_id is null or r.elevation is null or f.elevation is null then 'unknown'
       when abs(r.elevation - f.elevation) <= 1 then 'match'
       else 'mismatch' end as elevation_check
from resolved r
left join floors f on f.id = r.floor_id;

comment on view ifc_storey_map is
  'Každé IfcBuildingStorey z kópie aktuálnej hotovej revízie každého modelu -> podlažie AIM (to_id). match_rule = guid (vlastný uzol) | name_number (číslo z mena, ifc_np_key); nespárované a nejednoznačné majú to_id null a reason. elevation_check porovnáva Elevation storey s Pset_BuildingStoreyCommon.ElevationOfFFLRelative podlažia AIM (D-183 K3 krok 4, R6).';

-- rel_contained_in_spatial_structure: podlažie bez vlastného uzla z ifc_storey_map (namiesto CTE floor_by_np).
create or replace view rel_contained_in_spatial_structure as
with
  rev as (
    select distinct on (i.model) i.model, i.revision, i.finished_at
    from ifc_rev_imports i
    join model_revisions c on c.model = i.model and c.is_current
    where i.status = 'done' and i.revision <= c.revision
    order by i.model, i.revision desc
  ),
  node as (
    select h.ifc_guid, h.object_id, o.object_type
    from ifc_guid_history h
    join objects o on o.id = h.object_id and o.valid_until is null
    where h.valid_until is null
  ),
  direct as (
    select r.model, r.revision, rev.finished_at, r.relating, r.relating_class, r.related, null::text as via
    from ifc_rev_relationships r
    join rev on rev.model = r.model and rev.revision = r.revision
    where r.rel_class = 'IfcRelContainedInSpatialStructure'
  ),
  part as (
    select d.model, d.revision, d.finished_at, d.relating, d.relating_class, a.related, d.related as via
    from direct d
    join ifc_rev_relationships a
      on a.model = d.model and a.revision = d.revision and a.rel_class = 'IfcRelAggregates' and a.relating = d.related
    join node n on n.ifc_guid = a.related and n.object_type = 'asset'
    where not exists (select 1 from direct x where x.model = d.model and x.related = a.related)
  ),
  pairs as (select * from direct union all select * from part)
select
  md5(p.model || '|' || p.revision || '|' || p.relating || '|' || p.related)::uuid as id,
  e.object_id as from_id,
  coalesce(s.object_id, m.to_id) as to_id,
  p.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || p.model || ' v' || p.revision as source,
  p.model,
  p.revision,
  p.related as global_id,
  p.relating as container_global_id,
  p.via as via_global_id
from pairs p
left join node e on e.ifc_guid = p.related
left join node s on s.ifc_guid = p.relating
left join ifc_storey_map m
  on s.object_id is null and p.relating_class = 'IfcBuildingStorey'
 and m.model = p.model and m.revision = p.revision and m.global_id = p.relating;

comment on view rel_contained_in_spatial_structure is
  'IfcRelContainedInSpatialStructure z kópie aktuálnej hotovej revízie každého modelu (D-183 K3); from_id/to_id = uzly AIM, global_id/container_global_id = GlobalId zo súboru, via_global_id = celok, od ktorého časť dedí kontajner; podlažie bez vlastného uzla cez ifc_storey_map.';

commit;
