-- =============================================================================
-- D-156 - Space boundaries: rel_space_boundary and v_space_elements (relation = 'boundary')
-- =============================================================================
-- Additive migration (AGENTS.md: migrations are neither deleted nor edited), without data loss.
--
-- Doors (and other elements) may be linked to a room only by IfcRelSpaceBoundary, while
-- in the structure they sit on the floor. `v_space_elements` left them out (issue #245: the swing
-- door DD01.08.0001 was missing in lobby 1.01), so the query "doors of the room" silently gave
-- a wrong "not linked". ETL (etl/transform.py `_collect_space_boundaries`) from now on
-- stores the boundaries as the edge `rel_space_boundary` element -> space (one edge per pair,
-- `role` = PhysicalOrVirtualBoundary: physical | virtual | notdefined). Filled by a re-ETL.
--
-- The view `v_space_elements` gets a third branch `relation = 'boundary'`. Columns and their
-- order stay (CREATE OR REPLACE VIEW), only rows are added. No duplicates: a pair
-- (space, element) is output once, with precedence contained > referenced > boundary, so an
-- element that is in the room and also bounds it stays as before.
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

-- D-079: the new view must not be readable with the anon key (service_role gets it from default privileges).
revoke all on rel_space_boundary from anon, authenticated;

-- "what bounds this room" = read by to_id; "which rooms an element bounds" by from_id.
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
