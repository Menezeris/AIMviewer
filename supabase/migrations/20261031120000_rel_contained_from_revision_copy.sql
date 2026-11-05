-- D-183 K3 step 2 (first view): `rel_contained_in_spatial_structure` from the revision copy (ifc_rev_relationships)
-- instead of the edges the graph ETL took from the file (exception D-049 "group-only": VZT pipes and fittings without
-- a storey, #220).
--
-- The view reads, for each model, the current revision with a finished copy (`ifc_rev_imports.status = 'done'`; when the copy
-- of the current revision is not finished yet, the newest finished lower one, column `revision` says which). Row:
--   * every IfcRelContainedInSpatialStructure pair of the revision (element -> storey or room from the file);
--   * an assembly part with an AIM node (asset) that is not in a storey itself inherits the container of the whole one level up
--     (railing in a stairwell, door in a curtain wall): that is how ETL (`get_container`) and the engine did it
--     ("storey also via the whole"), `via_global_id` = GlobalId of the whole. Parts without an AIM node (bars and panels
--     of the curtain wall, stair flights) are not inherited, they are only in the engine.
-- GlobalId -> objects.id via the active `ifc_guid_history` (live node). A storey of a discipline model without its own
-- node (VZT, D-049) is mapped to the AIM storey by the number in the name (`2NP`, `2.NP`, `2. NP`), like the federation ETL.
-- An element without an AIM node has `from_id` null and `global_id`, a container without a node `to_id` null and `container_global_id`.
-- The first columns are the same as before (query_view, whitelist, v_space_elements, v_zone_elements, v_object_documents
-- unchanged); `id` is stable from (model, revision, container, element), `valid_until` always null, `source` = 'ifc:VZT v11'.
-- The `rel_contained_in_spatial_structure` edges in `relationships` stay (ETL still writes them), the view does not read them.
--
-- Rollback (columns cannot be removed from a view, hence the same columns with the original body):
--   create or replace view rel_contained_in_spatial_structure as
--     select id, from_id, to_id, valid_from, valid_until, source,
--            null::text as model, null::integer as revision, null::text as global_id,
--            null::text as container_global_id, null::text as via_global_id
--     from relationships where rel_type = 'rel_contained_in_spatial_structure';

begin;

-- Storey number from a name in any notation (2NP, 2.NP, 2. NP, 1NP_VZT -> 2NP), like etl/transform.py `_np_key`.
create or replace function ifc_np_key(p_name text)
returns text language sql immutable set search_path = public as $$
  select (regexp_match(p_name, '(\d+)\.?\s?NP'))[1] || 'NP'
$$;

-- GlobalId -> AIM node (live). An active GUID is on a node at most once (uniq_active_guid), here the reverse direction is needed too.
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
