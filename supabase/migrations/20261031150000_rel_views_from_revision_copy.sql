-- D-183 K3 krok 2b: ďalšie kanonické pohľady IFC vzťahov z kópie revízie (ifc_rev_relationships), rovnakým spôsobom
-- ako `rel_contained_in_spatial_structure` (migrácia 20261031120000): `rel_aggregates`, `rel_defines_by_type`,
-- `rel_assigns_to_group`, `rel_associates_document`, `rel_associates_classification`.
--
-- Spoločné pravidlá (D-183 bod 13 a 12):
--   * Riadok zo súboru = každá dvojica príslušnej triedy IfcRel* aktuálnej revízie modelu s hotovou kópiou
--     (`ifc_rev_current`: aktuálna revízia, kým jej kópia nie je `done`, najnovšia nižšia `done`). from_id = strana
--     Related (prvok, časť, výskyt, člen, objekt), to_id = strana Relating (celok, typ, skupina, dokument, klasifikácia).
--   * GlobalId -> uzol AIM cez aktívny `ifc_guid_history` a živý `objects` (`ifc_guid_node`). Strana bez uzla AIM má
--     from_id/to_id null; zo súboru ju povie `global_id` (Related) a stĺpec Relating (`parent_global_id`,
--     `type_global_id`, `group_global_id`, `document_key`, `classification_key`).
--   * `id` = md5(model|revízia|trieda IfcRel*|Relating|Related)::uuid, `valid_from` = koniec importu kópie,
--     `valid_until` vždy null, `source` = 'ifc:ASR v79'.
--   * K tomu riadky AIM vrstvy z `relationships` (zdroj nie je ETL zo súboru, napr. 'pdf_link (E4)', 'doc_upload
--     (D-036)'): ostávajú, ako boli (aj s valid_until), model/revision/global_id null. Hrany ETL (`etl`, `etl:*`)
--     pohľady nečítajú, ETL ich zatiaľ píše (prestane v kroku 3).
-- Mapovanie podľa vzťahu:
--   * rel_aggregates: oba konce cez GlobalId. Podlažie VZT (bez vlastného uzla, D-049) sa tu na podlažie AIM nemapuje
--     (budova VZT nemá uzol, podlažie AIM by dostalo druhého rodiča null); ostane from_id null.
--   * rel_defines_by_type: typ cez GlobalId; typ zo súboru bez vlastného uzla (ETL zlúčil viac IFC typov s rovnakým
--     typovým kódom do jedného `asset_type`, D-033) -> `asset_type`, ktorého object_ref je typový kód výskytu
--     (object_ref výskytu bez posledného segmentu, DD01.06.04 -> DD01.06), tak ako ho určil ETL.
--   * rel_associates_document: `IfcDocumentInformation:<Identification>` / `IfcDocumentReference:<Identification>`
--     (prirodzený kľúč kópie) -> uzol `document` / `document_reference` s rovnakou `documents.identification`,
--     len keď je jediný. `role` = 'document' ako doteraz.
--   * rel_associates_classification: `IfcClassificationReference:<Identification>` -> `classification_references`
--     s rovnakou `identification`, len keď je jediná (systém kľúč kópie nenesie). Väzba na celú IfcClassification
--     (projekt) nemá cieľ, to_id null.
-- Prvé stĺpce sú rovnaké ako doteraz (query_view, whitelist, list_relations, v_object_documents, v_asset_effective,
-- v_asset_classifications, v_zone_elements, v_clash_latest bez zmeny).
--
-- Rollback (stĺpce sa z pohľadu odobrať nedajú, preto rovnaké stĺpce s pôvodným telom; pomocné pohľady ostanú):
--   create or replace view rel_aggregates as
--     select id, from_id, to_id, valid_from, valid_until, source, null::text as model, null::integer as revision,
--            null::text as global_id, null::text as parent_global_id
--     from relationships where rel_type = 'rel_aggregates';
--   create or replace view rel_defines_by_type as
--     select id, from_id, to_id, valid_from, valid_until, source, null::text as model, null::integer as revision,
--            null::text as global_id, null::text as type_global_id
--     from relationships where rel_type = 'rel_defines_by_type';
--   create or replace view rel_assigns_to_group as
--     select id, from_id, to_id, valid_from, valid_until, source, null::text as model, null::integer as revision,
--            null::text as global_id, null::text as group_global_id
--     from relationships where rel_type = 'rel_assigns_to_group';
--   create or replace view rel_associates_document as
--     select id, from_id, to_id, role, valid_from, valid_until, source, null::text as model, null::integer as revision,
--            null::text as global_id, null::text as document_key
--     from relationships where rel_type = 'rel_associates_document';
--   create or replace view rel_associates_classification as
--     select id, from_id, to_id, valid_from, valid_until, source, null::text as model, null::integer as revision,
--            null::text as global_id, null::text as classification_key
--     from relationships where rel_type = 'rel_associates_classification';

begin;

-- Revízia kópie, ktorú čítajú pohľady: pre každý model aktuálna, kým nie je `done`, najnovšia nižšia `done`.
create or replace view ifc_rev_current as
  select distinct on (i.model) i.model, i.revision, i.finished_at
  from ifc_rev_imports i
  join model_revisions c on c.model = i.model and c.is_current
  where i.status = 'done' and i.revision <= c.revision
  order by i.model, i.revision desc;

-- GlobalId -> živý uzol AIM (aktívny GUID, objekt bez valid_until).
create or replace view ifc_guid_node as
  select h.ifc_guid, h.object_id, o.object_type, o.object_ref
  from ifc_guid_history h
  join objects o on o.id = h.object_id and o.valid_until is null
  where h.valid_until is null;

-- Hrana AIM vrstvy (nie ETL zo súboru): pohľady nad kópiou ju zachovajú.
create or replace function rel_is_aim_layer(p_source text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_source, '') !~ '^etl(:|$)'
$$;

create or replace view rel_aggregates as
select
  md5(r.model || '|' || r.revision || '|IfcRelAggregates|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  p.object_id as to_id,
  c.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || r.model || ' v' || r.revision as source,
  r.model,
  r.revision,
  r.related as global_id,
  r.relating as parent_global_id
from ifc_rev_relationships r
join ifc_rev_current c on c.model = r.model and c.revision = r.revision
left join ifc_guid_node e on e.ifc_guid = r.related
left join ifc_guid_node p on p.ifc_guid = r.relating
where r.rel_class = 'IfcRelAggregates'
union all
select id, from_id, to_id, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_aggregates' and rel_is_aim_layer(source);

create or replace view rel_defines_by_type as
select
  md5(r.model || '|' || r.revision || '|IfcRelDefinesByType|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  coalesce(t.object_id, tc.id) as to_id,
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
left join objects tc
  on t.object_id is null and e.object_type = 'asset' and tc.object_type = 'asset_type' and tc.valid_until is null
 and tc.object_ref = regexp_replace(e.object_ref, '\.[^.]+$', '')
where r.rel_class = 'IfcRelDefinesByType'
union all
select id, from_id, to_id, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_defines_by_type' and rel_is_aim_layer(source);

create or replace view rel_assigns_to_group as
select
  md5(r.model || '|' || r.revision || '|IfcRelAssignsToGroup|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  g.object_id as to_id,
  c.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || r.model || ' v' || r.revision as source,
  r.model,
  r.revision,
  r.related as global_id,
  r.relating as group_global_id
from ifc_rev_relationships r
join ifc_rev_current c on c.model = r.model and c.revision = r.revision
left join ifc_guid_node e on e.ifc_guid = r.related
left join ifc_guid_node g on g.ifc_guid = r.relating
where r.rel_class = 'IfcRelAssignsToGroup'
union all
select id, from_id, to_id, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_assigns_to_group' and rel_is_aim_layer(source);

create or replace view rel_associates_document as
with doc as (
  select o.ifc_type as cls, d.identification, (array_agg(o.id))[1] as id
  from objects o
  join documents d on d.id = o.id
  where o.valid_until is null and o.object_type in ('document', 'document_reference') and d.identification is not null
  group by 1, 2
  having count(*) = 1
)
select
  md5(r.model || '|' || r.revision || '|IfcRelAssociatesDocument|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  d.id as to_id,
  'document'::text as role,
  c.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || r.model || ' v' || r.revision as source,
  r.model,
  r.revision,
  r.related as global_id,
  r.relating as document_key
from ifc_rev_relationships r
join ifc_rev_current c on c.model = r.model and c.revision = r.revision
left join ifc_guid_node e on e.ifc_guid = r.related
left join doc d on d.cls = r.relating_class and d.identification = substr(r.relating, length(r.relating_class) + 2)
where r.rel_class = 'IfcRelAssociatesDocument'
union all
select id, from_id, to_id, role, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_associates_document' and rel_is_aim_layer(source);

create or replace view rel_associates_classification as
with cref as (
  select identification, (array_agg(id))[1] as id
  from classification_references
  group by 1
  having count(*) = 1
)
select
  md5(r.model || '|' || r.revision || '|IfcRelAssociatesClassification|' || r.relating || '|' || r.related)::uuid as id,
  e.object_id as from_id,
  k.id as to_id,
  c.finished_at as valid_from,
  null::timestamptz as valid_until,
  'ifc:' || r.model || ' v' || r.revision as source,
  r.model,
  r.revision,
  r.related as global_id,
  r.relating as classification_key
from ifc_rev_relationships r
join ifc_rev_current c on c.model = r.model and c.revision = r.revision
left join ifc_guid_node e on e.ifc_guid = r.related
left join cref k
  on r.relating_class = 'IfcClassificationReference' and k.identification = substr(r.relating, length(r.relating_class) + 2)
where r.rel_class = 'IfcRelAssociatesClassification'
union all
select id, from_id, to_id, valid_from, valid_until, source, null, null, null, null
from relationships where rel_type = 'rel_associates_classification' and rel_is_aim_layer(source);

comment on view ifc_rev_current is 'Revízia kópie, ktorú čítajú pohľady IFC vzťahov: aktuálna done, inak najnovšia nižšia done (D-183 K3).';
comment on view ifc_guid_node is 'GlobalId -> živý uzol AIM cez aktívny ifc_guid_history (D-183 K3).';
comment on view rel_aggregates is
  'IfcRelAggregates z kópie aktuálnej hotovej revízie (D-183 K3); from_id = časť, to_id = celok (uzly AIM), global_id/parent_global_id zo súboru; + hrany AIM vrstvy.';
comment on view rel_defines_by_type is
  'IfcRelDefinesByType z kópie aktuálnej hotovej revízie (D-183 K3); from_id = výskyt, to_id = typ AIM (aj zlúčený typ podľa typového kódu), type_global_id zo súboru; + hrany AIM vrstvy.';
comment on view rel_assigns_to_group is
  'IfcRelAssignsToGroup z kópie aktuálnej hotovej revízie (D-183 K3); from_id = člen, to_id = systém/zóna/skupina, group_global_id zo súboru; + hrany AIM vrstvy.';
comment on view rel_associates_document is
  'IfcRelAssociatesDocument z kópie aktuálnej hotovej revízie (D-183 K3); to_id = dokument alebo jeho časť podľa Identification, document_key zo súboru; + hrany AIM vrstvy (pdf_link, doc_upload).';
comment on view rel_associates_classification is
  'IfcRelAssociatesClassification z kópie aktuálnej hotovej revízie (D-183 K3); to_id = classification_references podľa Identification, classification_key zo súboru; + hrany AIM vrstvy.';

revoke all on ifc_rev_current, ifc_guid_node from anon, authenticated;
grant select on ifc_rev_current, ifc_guid_node to service_role;
revoke all on function rel_is_aim_layer(text) from public, anon, authenticated;
grant execute on function rel_is_aim_layer(text) to service_role;

commit;
