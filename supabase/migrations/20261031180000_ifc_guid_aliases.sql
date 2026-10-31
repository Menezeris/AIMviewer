-- D-183 K3 krok 3: zlúčenie IFC typov s rovnakým typovým kódom do jedného `asset_type` (D-033) ako údaj.
--
-- ETL grafu zlučuje viac IFC typov (IfcDoorType...) s rovnakým typovým kódom do jedného uzla `asset_type`;
-- zlúčený typ nemal GUID nikde v DB, preto `rel_defines_by_type` z kópie revízie (migrácia 20261031150000)
-- hľadal typ dočasným mostom podľa object_ref výskytu (DD01.06.04 -> DD01.06). Teraz je zlúčenie údaj:
--   * `ifc_guid_aliases` = ďalší GlobalId toho istého uzla AIM (nie jeho história): GUID zlúčeného typu ->
--     `asset_type`, dôvod `type_code` (D-033). Zapisuje ETL grafu (`etl/db.py`, `_load_guid_aliases`) so zdrojom
--     modelu (`IFC import:ASR`) a re-ETL uzavrie, čo už nevydal (D-086), rovnako ako `ifc_guid_history`.
--   * Prečo nie viac aktívnych GUID v `ifc_guid_history` (D-010): tam je na uzle najviac jeden aktívny GUID
--     (`uniq_active_guid`) a na tom stojí `objects.ifc_guid`, zánik objektu bez aktívneho GUID (D-088), presun ručných
--     väzieb na nástupcu, výber v 3D a IDS. História = ten istý prvok v čase (Revit zmení GUID), alias = iná IFC entita
--     v tej istej revízii, ktorú AIM zámerne zlúčil (rozhodnutie AIM, D-183 bod 12), preto vlastná tabuľka.
--   * `ifc_guid_node` (GlobalId -> živý uzol AIM) berie aj aktívne aliasy, ak GUID nie je v aktívnej histórii;
--     nový stĺpec `alias_reason` (null = vlastný GUID uzla). Zlúčené typy majú v kópii okrem IfcRelDefinesByType len
--     IfcRelAssociatesMaterial a IfcRelDeclares (overené 31. 10.), takže ostatné pohľady sa nemenia.
--   * `rel_defines_by_type` bez mosta podľa object_ref (typ len cez GlobalId, aj alias).
--   * Spätné doplnenie: aliasy z dnešného mosta nad kópiou aktuálnej revízie (jednoznačné: GUID typu -> jediný
--     `asset_type`), zdroj `IFC import:<model>`, aby ich prvý re-ETL modelu prevzal (uzavrie a zapíše vlastné id).
--     Produkcia 31. 10.: ASR 8 GUID typov -> 7 `asset_type` (DD01.02, DD01.06 x2, DD02.03, DD03.03, DD04.03, ST01.10,
--     ZD02.02), 35 výskytov; VZT žiadny.
--
-- Rollback (pomocné objekty ostanú; stĺpec z pohľadu sa odobrať nedá, preto alias_reason ostane null):
--   create or replace view ifc_guid_node as
--     select h.ifc_guid, h.object_id, o.object_type, o.object_ref, null::text as alias_reason
--     from ifc_guid_history h join objects o on o.id = h.object_id and o.valid_until is null
--     where h.valid_until is null;
--   a telo `rel_defines_by_type` z migrácie 20261031150000 (s mostom `left join objects tc ...`).

begin;

create table ifc_guid_aliases (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references objects(id) on delete cascade,
  ifc_guid    text not null,
  reason      text not null default 'type_code',   -- prečo je GUID aliasom uzla: type_code = zlúčený IFC typ (D-033)
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,                          -- NULL = aktívny
  source      text,                                 -- IFC import:<model> (ETL grafu), ako ifc_guid_history
  created_at  timestamptz not null default now()
);
create unique index uniq_active_guid_alias on ifc_guid_aliases (ifc_guid) where valid_until is null;
create index idx_ifc_guid_aliases_object_id on ifc_guid_aliases (object_id);

comment on table ifc_guid_aliases is
  'Ďalší GlobalId toho istého uzla AIM (nie história): GUID IFC typu zlúčeného do asset_type s rovnakým typovým kódom (D-033, D-183 K3 krok 3). Aktívny alias GUID najviac jeden.';

-- Spätné doplnenie z mosta podľa object_ref nad kópiou aktuálnej revízie (telo mosta z 20261031150000);
-- len GUID typu, ktorý most mapuje na jediný asset_type.
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

-- GlobalId -> živý uzol AIM: aktívna história, inak aktívny alias.
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
