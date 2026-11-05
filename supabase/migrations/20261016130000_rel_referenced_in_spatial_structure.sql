-- =============================================================================
-- D-080 - Derived spatial placement: rel_referenced_in_spatial_structure
-- =============================================================================
-- Additive migration (AGENTS.md: migrations are never deleted or edited).
--
-- An element of the federation (e.g. an HVAC outlet from VZT.ifc) lies in a space (IfcSpace from
-- ASR.ifc), but the source files cannot say so: the element is natively placed
-- only on the floor and IfcRelContainedInSpatialStructure is EXCLUSIVE for an element
-- (IfcElement.ContainedInStructure SET[0:1]). For "the element is also located
-- in another spatial structure" IFC has the non-exclusive
-- IfcRelReferencedInSpatialStructure (ReferencedInStructures SET[0:?]) -
-- we adopt it verbatim (IFC-first, D-046), hence namespace 'rel', not 'aim'.
--
-- The edges are populated by the deriver `python -m etl.derive spatial_reference` (geometry,
-- source='derive:spatial_reference'); role = 'inside' (element entirely within the body of
-- the space) | 'partial' (element intersects the body). Source IFC files are never overwritten.
-- =============================================================================

begin;

insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('rel_referenced_in_spatial_structure', 'IfcRelReferencedInSpatialStructure',
   'IfcRelConnects', true, 'to',
   array['asset'], array['space', 'floor', 'building', 'site'], false,
   'rel', 'ifcrel', false,
   'Prvok sa nachádza (aj) v priestorovej štruktúre — neexkluzívne, popri natívnom containmente (D-080). '
   'Odvodené geometriou naprieč súbormi federácie; role inside|partial.')
on conflict (rel_type) do nothing;

create view rel_referenced_in_spatial_structure as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_referenced_in_spatial_structure';

-- "what is in this room" = read by to_id.
create index idx_relationships_referenced_to on relationships (to_id)
  where rel_type = 'rel_referenced_in_spatial_structure';
create index idx_relationships_referenced_from on relationships (from_id)
  where rel_type = 'rel_referenced_in_spatial_structure';

-- Content of a space in one query (LLM/viewer): native containment from the file
-- + derived references. `relation` says where the link comes from.
create view v_space_elements as
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
  where r.valid_until is null;

commit;
