-- D-183 K3 krok 2 (prvý pohľad): `rel_contained_in_spatial_structure` z kópie revízie (ifc_rev_relationships)
-- namiesto hrán, ktoré ETL grafu vyberal zo súboru (výnimka D-049 "group-only": potrubie a tvarovky VZT bez
-- podlažia, #220).
--
-- Pohľad číta pre každý model aktuálnu revíziu s hotovou kópiou (`ifc_rev_imports.status = 'done'`; keď kópia
-- aktuálnej revízie ešte nie je hotová, najnovšiu hotovú nižšiu, stĺpec `revision` povie ktorú). Riadok:
--   * každá dvojica IfcRelContainedInSpatialStructure revízie (prvok -> podlažie alebo miestnosť zo súboru);
--   * časť zostavy s uzlom AIM (asset), ktorá sama v podlaží nie je, dedí kontajner celku o úroveň vyššie
--     (zábradlie v schodisku, dvere v závesovej stene): tak to robil ETL (`get_container`) aj motor
--     ("podlažie aj cez celok"), `via_global_id` = GlobalId celku. Časti bez uzla AIM (prúty a panely
--     závesovej steny, ramená schodiska) sa nededia, sú len v motore.
-- GlobalId -> objects.id cez aktívny `ifc_guid_history` (živý uzol). Podlažie disciplinárneho modelu bez vlastného
-- uzla (VZT, D-049) sa mapuje na podlažie AIM podľa čísla v mene (`2NP`, `2.NP`, `2. NP`), ako ETL federácie.
-- Prvok bez uzla AIM má `from_id` null a `global_id`, kontajner bez uzla `to_id` null a `container_global_id`.
-- Prvé stĺpce sú rovnaké ako doteraz (query_view, whitelist, v_space_elements, v_zone_elements, v_object_documents
-- bez zmeny); `id` je stabilné z (model, revízia, kontajner, prvok), `valid_until` vždy null, `source` = 'ifc:VZT v11'.
-- Hrany `rel_contained_in_spatial_structure` v `relationships` ostávajú (ETL ich zatiaľ píše), pohľad ich nečíta.
--
-- Rollback (stĺpce sa z pohľadu odobrať nedajú, preto rovnaké stĺpce s pôvodným telom):
--   create or replace view rel_contained_in_spatial_structure as
--     select id, from_id, to_id, valid_from, valid_until, source,
--            null::text as model, null::integer as revision, null::text as global_id,
--            null::text as container_global_id, null::text as via_global_id
--     from relationships where rel_type = 'rel_contained_in_spatial_structure';

begin;

-- Číslo podlažia z mena v ľubovoľnom zápise (2NP, 2.NP, 2. NP, 1NP_VZT -> 2NP), ako etl/transform.py `_np_key`.
create or replace function ifc_np_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select (regexp_match(p_name, '(\d+)\.?\s?NP'))[1] || 'NP'
$$;

-- GlobalId -> uzol AIM (živý). Aktívny GUID je na uzle najviac raz (uniq_active_guid), tu treba aj opačný smer.
create index if not exists idx_ifc_guid_history_active_guid on ifc_guid_history (ifc_guid) where valid_until is null;

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
  pairs as (select * from direct union all select * from part),
  floor_by_np as (
    select distinct on (ifc_np_key(coalesce(o.name, o.object_ref))) ifc_np_key(coalesce(o.name, o.object_ref)) as np, o.id
    from objects o
    where o.object_type = 'floor' and o.valid_until is null and ifc_np_key(coalesce(o.name, o.object_ref)) is not null
    order by ifc_np_key(coalesce(o.name, o.object_ref)), o.object_ref
  )
select
  md5(p.model || '|' || p.revision || '|' || p.relating || '|' || p.related)::uuid as id,
  e.object_id as from_id,
  coalesce(s.object_id, f.id) as to_id,
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
left join ifc_rev_objects so
  on s.object_id is null and p.relating_class = 'IfcBuildingStorey'
 and so.model = p.model and so.revision = p.revision and so.global_id = p.relating
left join floor_by_np f on f.np = ifc_np_key(so.attributes ->> 'Name');

comment on view rel_contained_in_spatial_structure is
  'IfcRelContainedInSpatialStructure z kópie aktuálnej hotovej revízie každého modelu (D-183 K3); from_id/to_id = uzly AIM, global_id/container_global_id = GlobalId zo súboru, via_global_id = celok, od ktorého časť dedí kontajner.';

revoke all on function ifc_np_key(text) from public, anon, authenticated;
grant execute on function ifc_np_key(text) to service_role;

commit;
