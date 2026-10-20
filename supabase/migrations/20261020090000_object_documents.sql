-- =============================================================================
-- D-104 krok 2 - Dokumenty objektu cez vzťahy (v_object_documents)
-- =============================================================================
-- Aditívna migrácia (AGENTS.md: migrácie sa nemažú ani needitujú).
--
-- Model nesie dokumenty na nositeľoch, nie na prvkoch (ASR: projekt, zóny, priestorové
-- zóny, skupiny skladieb, typ LOP). Pohľad hovorí pre každý objekt, ktoré dokumenty
-- (alebo strany dokumentu) mu patria a cez čo:
--   direct        priamo (rel_associates_document z objektu),
--   type          cez typ (rel_defines_by_type),
--   zone/group/system  cez členstvo (rel_assigns_to_group),
--   zone          prvok cez priestor v zóne (v_zone_elements, pravidlo element_in_zone, D-089),
--   spatial_zone  cez priestorovú zónu (rel_referenced_in_spatial_structure, aj odvodené),
-- a cez nadradené skupinové uzly: zóna v zóne (rel_assigns_to_group), časť skupiny alebo
-- priestorovej zóny (rel_aggregates), napr. podlaha -> S1.01 -> S1 -> strana 3.
-- Projekt sa nededí: dokumentácia stavby by sa inak opakovala pri každom prvku.
-- IfcDocumentReference (document_reference) sa rozbalí na dokument + stranu.
-- Väzby výkres -> prvok z obsahu PDF (E4) sem nepatria (zdroj 'pdf_link (E4)').
-- =============================================================================

begin;

create view v_object_documents as
with recursive
  -- Člen -> skupinový uzol alebo typ: kto dedí dokumenty nositeľa. Počíta sa raz.
  members (member_id, parent_id, via_space_id) as materialized (
    select g.from_id, g.to_id, null::uuid
    from rel_assigns_to_group g where g.valid_until is null
    union all
    select a.from_id, a.to_id, null
    from rel_aggregates a
    join objects p on p.id = a.to_id and p.object_type in ('group', 'spatial_zone')
    where a.valid_until is null
    union all
    select t.from_id, t.to_id, null
    from rel_defines_by_type t where t.valid_until is null
    union all
    select r.from_id, r.to_id, null
    from rel_referenced_in_spatial_structure r
    join objects p on p.id = r.to_id and p.object_type = 'spatial_zone'
    where r.valid_until is null
    union all
    select ze.element_id, ze.zone_id, ze.via_space_id from v_zone_elements ze
  ),
  -- Od nositeľa dokumentu nadol k členom, kým je uzol skupinový alebo typ. Ide sa od
  -- väzieb dokumentov (163), nie od všetkých objektov.
  walk (object_id, holder_id, via_space_id, depth, path) as (
    select h.id, h.id, null::uuid, 0, array[h.id]
    from objects h
    where h.valid_until is null
      and exists (select 1 from rel_associates_document ad
                  where ad.from_id = h.id and ad.valid_until is null
                    and ad.source <> 'pdf_link (E4)')
    union all
    select m.member_id, w.holder_id, coalesce(m.via_space_id, w.via_space_id), w.depth + 1,
           w.path || m.member_id
    from walk w
    join objects wo on wo.id = w.object_id
      and wo.object_type in ('zone', 'group', 'spatial_zone', 'system', 'asset_type')
    join members m on m.parent_id = w.object_id
    join objects mo on mo.id = m.member_id and mo.valid_until is null
    where w.depth < 6 and not m.member_id = any(w.path)
  )
select w.object_id,
       ob.object_type,
       ob.object_ref,
       coalesce(d.referenced_document_id, ad.to_id) as document_id,
       case when t.object_type = 'document_reference' then ad.to_id end as reference_id,
       case when t.object_type = 'document_reference' then
         coalesce(substring(d.location from '#.*page=([0-9]+)'),
                  substring(d.identification from '^page=([0-9]+)'))::int
       end as page,
       case when w.depth = 0 then 'direct'
            when h.object_type = 'asset_type' then 'type'
            else h.object_type end as via,
       case when w.depth = 0 then null else w.holder_id end as via_id,
       case when w.depth = 0 then null else w.path[array_length(w.path, 1) - 1] end as via_nearest_id,
       w.via_space_id,
       w.depth,
       w.path,
       ad.role,
       ad.source
from walk w
join objects ob on ob.id = w.object_id
join objects h on h.id = w.holder_id
join rel_associates_document ad on ad.from_id = w.holder_id and ad.valid_until is null
  and ad.source <> 'pdf_link (E4)'
join objects t on t.id = ad.to_id and t.valid_until is null
left join documents d on d.id = ad.to_id and t.object_type = 'document_reference';

comment on view v_object_documents is
  'Dokumenty objektu cez vzťahy (D-104 krok 2): via = direct|type|zone|group|system|spatial_zone '
  '(druh nositeľa), via_id = nositeľ dokumentu, via_nearest_id = najbližší nositeľ k objektu, '
  'depth = počet krokov od nositeľa, path = cesta od nositeľa po objekt. Strana pri odkaze na '
  'časť dokumentu (reference_id, page). Projekt sa nededí.';

-- Čítanie len server-side cez service_role (D-026, migrácia 20261016120000).
revoke all on v_object_documents from anon, authenticated;

commit;
