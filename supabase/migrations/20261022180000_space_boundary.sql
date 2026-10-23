-- =============================================================================
-- D-156 — Hranice priestorov: rel_space_boundary a v_space_elements (relation = 'boundary')
-- =============================================================================
-- Aditívna migrácia (AGENTS.md: migrácie sa nemažú ani needitujú), bez straty dát.
--
-- Dvere (a iné prvky) môžu byť s miestnosťou spojené len IfcRelSpaceBoundary, pričom
-- v štruktúre ležia na podlaží. `v_space_elements` ich vynechával (issue #245: otáčavé
-- dvere DD01.08.0001 chýbali v lobby 1.01), takže dotaz "dvere miestnosti" mlčky dal
-- nesprávne "nie je spojené". ETL (etl/transform.py `_collect_space_boundaries`) odteraz
-- hranice ukladá ako hranu `rel_space_boundary` prvok -> priestor (jedna hrana na pár,
-- `role` = PhysicalOrVirtualBoundary: physical | virtual | notdefined). Plní ju re-ETL.
--
-- Pohľad `v_space_elements` dostane tretiu vetvu `relation = 'boundary'`. Stĺpce a ich
-- poradie ostávajú (CREATE OR REPLACE VIEW), pribudnú len riadky. Bez duplicít: pár
-- (priestor, prvok) sa vypíše raz, s prednosťou contained > referenced > boundary, takže
-- prvok, ktorý je v miestnosti aj ju ohraničuje, ostáva ako doteraz.
-- =============================================================================

begin;

insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('rel_space_boundary', 'IfcRelSpaceBoundary',
   'IfcRelConnects', true, 'to',
   array['asset'], array['space'], false,
   'rel', 'ifcrel', false,
   'Prvok ohraničuje priestor (IfcRelSpaceBoundary, D-156); role = PhysicalOrVirtualBoundary '
   '(physical|virtual|notdefined). Prvok nemusí byť v priestore ani naň odkazovať cez '
   'rel_referenced_in_spatial_structure.')
on conflict (rel_type) do nothing;

create view rel_space_boundary as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_space_boundary';

-- D-079: nový pohľad nesmie byť čitateľný anon kľúčom (service_role ho dostane z default privileges).
revoke all on rel_space_boundary from anon, authenticated;

-- "čo ohraničuje túto miestnosť" = čítanie po to_id; "ktoré miestnosti ohraničuje prvok" po from_id.
create index idx_relationships_boundary_to on relationships (to_id)
  where rel_type = 'rel_space_boundary';
create index idx_relationships_boundary_from on relationships (from_id)
  where rel_type = 'rel_space_boundary';

create or replace view v_space_elements as
  select c.to_id as space_id, s.object_ref as space_ref, s.name as space_name,
         sp.long_name as space_long_name,
         c.from_id as element_id, e.object_ref as element_ref, e.name as element_name,
         e.ifc_type as element_ifc_type, e.predefined_type as element_predefined_type,
         'contained'::text as relation, null::text as role, c.source
  from rel_contained_in_spatial_structure c
  join objects s on s.id = c.to_id and s.object_type = 'space'
  left join spaces sp on sp.id = s.id
  join objects e on e.id = c.from_id
  where c.valid_until is null
  union all
  select r.to_id, s.object_ref, s.name, sp.long_name,
         r.from_id, e.object_ref, e.name, e.ifc_type, e.predefined_type,
         'referenced', r.role, r.source
  from rel_referenced_in_spatial_structure r
  join objects s on s.id = r.to_id and s.object_type = 'space'
  left join spaces sp on sp.id = s.id
  join objects e on e.id = r.from_id
  where r.valid_until is null
  union all
  select b.to_id, s.object_ref, s.name, sp.long_name,
         b.from_id, e.object_ref, e.name, e.ifc_type, e.predefined_type,
         'boundary', b.role, b.source
  from rel_space_boundary b
  join objects s on s.id = b.to_id and s.object_type = 'space'
  left join spaces sp on sp.id = s.id
  join objects e on e.id = b.from_id
  where b.valid_until is null
    and not exists (
      select 1 from rel_contained_in_spatial_structure c
      where c.from_id = b.from_id and c.to_id = b.to_id and c.valid_until is null)
    and not exists (
      select 1 from rel_referenced_in_spatial_structure r
      where r.from_id = b.from_id and r.to_id = b.to_id and r.valid_until is null);

commit;
