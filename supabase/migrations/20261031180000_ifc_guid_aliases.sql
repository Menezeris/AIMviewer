-- D-183 K3 step 3: merging IFC types with the same type code into one `asset_type` (D-033) as data.
--
-- The graph ETL merges several IFC types (IfcDoorType...) with the same type code into one `asset_type` node;
-- the merged type had no GUID anywhere in the DB, so `rel_defines_by_type` from the revision copy (migration 20261031150000)
-- looked up the type through a temporary bridge by the occurrence object_ref (DD01.06.04 -> DD01.06). Now the merge is data:
--   * `ifc_guid_aliases` = another GlobalId of the same AIM node (not its history): the GUID of the merged type ->
--     `asset_type`, reason `type_code` (D-033). Written by the graph ETL (`etl/db.py`, `_load_guid_aliases`) with the model
--     source (`IFC import:ASR`) and re-ETL closes what it no longer emitted (D-086), the same as `ifc_guid_history`.
--   * Why not several active GUIDs in `ifc_guid_history` (D-010): there a node has at most one active GUID
--     (`uniq_active_guid`) and `objects.ifc_guid` stands on it, as do the end of an object without an active GUID (D-088), the transfer of manual
--     links to the successor, selection in 3D and IDS. History = the same element in time (Revit changes the GUID), alias = a different IFC entity
--     in the same revision that AIM deliberately merged (an AIM decision, D-183 point 12), hence a table of its own.
--   * `ifc_guid_node` (GlobalId -> live AIM node) also takes active aliases, if the GUID is not in the active history;
--     new column `alias_reason` (null = the node's own GUID). Merged types have in the copy, besides IfcRelDefinesByType, only
--     IfcRelAssociatesMaterial and IfcRelDeclares (verified 31. 10.), so the other views do not change.
--   * `rel_defines_by_type` without the bridge by object_ref (type only via GlobalId, also alias).
--   * Backfill: aliases from today's bridge over the copy of the current revision (unambiguous: type GUID -> a single
--     `asset_type`), source `IFC import:<model>`, so that the first re-ETL of the model takes them over (closes them and writes its own id).
--     Production 31. 10.: ASR 8 type GUIDs -> 7 `asset_type` (DD01.02, DD01.06 x2, DD02.03, DD03.03, DD04.03, ST01.10,
--     ZD02.02), 35 occurrences; VZT none.
--
-- Rollback (helper objects stay; a column cannot be removed from a view, so alias_reason stays null):
--   create or replace view ifc_guid_node as
--     select h.ifc_guid, h.object_id, o.object_type, o.object_ref, null::text as alias_reason
--     from ifc_guid_history h join objects o on o.id = h.object_id and o.valid_until is null
--     where h.valid_until is null;
--   and the body of `rel_defines_by_type` from migration 20261031150000 (with the bridge `left join objects tc ...`).

begin;

create table ifc_guid_aliases (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  reason      text not null default 'type_code',   -- why the GUID is an alias of the node: type_code = merged IFC type (D-033)
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,                          -- NULL = active
  source      text,                                 -- IFC import:<model> (graph ETL), like ifc_guid_history
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid_alias on ifc_guid_aliases (ifc_guid) where valid_until is null;
create index idx_ifc_guid_aliases_object_id on ifc_guid_aliases (object_id);

comment on table ifc_guid_aliases is
  'Ďalší GlobalId toho istého uzla AIM (nie história): GUID IFC typu zlúčeného do asset_type s rovnakým typovým kódom (D-033, D-183 K3 krok 3). Aktívny alias GUID najviac jeden.';

-- Backfill from the bridge by object_ref over the copy of the current revision (bridge body from 20261031150000);
-- only a type GUID that the bridge maps to a single asset_type.
with bridge as (
  select r.model, r.relating, tc.id as type_id
  from ifc_rev_relationships r
  join ifc_rev_current c on c.model = r.model and c.revision = r.revision
  join ifc_guid_node e on e.ifc_guid = r.related and e.object_type = 'asset'
  join objects tc on tc.object_type = 'asset_type' and tc.valid_until is null
   and tc.object_ref = regexp_replace(e.object_ref, '\.[^.]+$', '')
  where r.rel_class = 'IfcRelDefinesByType'
    and not exists (select 1 from ifc_guid_node t where t.ifc_guid = r.relating)
),
unique_guid as (
  select relating from bridge group by relating having count(distinct type_id) = 1
)
insert into ifc_guid_aliases (object_id, ifc_guid, reason, source)
select distinct on (b.relating) b.type_id, b.relating, 'type_code', 'IFC import:' || b.model
from bridge b join unique_guid u using (relating)
order by b.relating, b.model;

-- GlobalId -> live AIM node: active history, otherwise active alias.
create or replace view ifc_guid_node as
  select h.ifc_guid, h.object_id, o.object_type, o.object_ref, null::text as alias_reason
  from ifc_guid_history h
  join objects o on o.id = h.object_id and o.valid_until is null
  where h.valid_until is null
  union all
  select a.ifc_guid, a.object_id, o.object_type, o.object_ref, a.reason
  from ifc_guid_aliases a
  join objects o on o.id = a.object_id and o.valid_until is null
  where a.valid_until is null
    and not exists (select 1 from ifc_guid_history h where h.ifc_guid = a.ifc_guid and h.valid_until is null);

create or replace view rel_defines_by_type as
select
  md5(r.model || '|' || r.revision || '|IfcRelDefinesByType|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  t.object_id as to_id,
  c.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || r.model || ' v' || r.revision as source,
  r.model,
  r.revision,
  r.related as global_id,
  r.relating as type_global_id
from ifc_rev_relationships r
join ifc_rev_current c on c.model = r.model and c.revision = r.revision
left join ifc_guid_node e on e.ifc_guid = r.related
left join ifc_guid_node t on t.ifc_guid = r.relating
where r.rel_class = 'IfcRelDefinesByType'
union all
select id, from_id, to_id, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_defines_by_type' and rel_is_aim_layer(source);

comment on view ifc_guid_node is
  'GlobalId -> živý uzol AIM: aktívny ifc_guid_history, inak aktívny ifc_guid_aliases (alias_reason, napr. type_code = zlúčený typ D-033); D-183 K3.';
comment on view rel_defines_by_type is
  'IfcRelDefinesByType z kópie aktuálnej hotovej revízie (D-183 K3); from_id = výskyt, to_id = typ AIM cez GlobalId typu (aj alias zlúčeného typu, ifc_guid_aliases), type_global_id zo súboru; + hrany AIM vrstvy.';

revoke all on ifc_guid_aliases from anon, authenticated;
grant all on ifc_guid_aliases to service_role;

commit;
