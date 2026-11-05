-- =============================================================================
-- D-104 - Document classification (information type, ISO 19650)
-- =============================================================================
-- Additive migration (AGENTS.md: migrations are neither deleted nor edited).
--
-- IFC has no attribute on IfcDocumentInformation for the kind of document; the kind is a classification
-- (ASR v77: system "ISO 19650 typ informácie", codes DR, CA, RP, SH, SP). A document is not
-- an IfcRoot, so IfcRelAssociatesClassification cannot reach it: the link is an
-- IfcExternalReferenceRelationship (resource, like rel_document_information_relationship).
-- to_id leads to classification_references as with rel_associates_classification.
-- =============================================================================

begin;

-- relationship_types per the manifest (python -m etl.manifest)
insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('rel_external_reference_relationship', 'IfcExternalReferenceRelationship', null, false, 'to',
   array['document'], array[]::text[], true,
   'rel', 'resource', false,
   'Klasifikácia dokumentu (D-104), napr. typ informácie ISO 19650. to_id → classification_references. IFC resource, nie IfcRel.')
on conflict (rel_type) do nothing;

create view rel_external_reference_relationship as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'rel_external_reference_relationship';

-- Read only server-side via service_role (D-026, migration 20261016120000).
revoke all on rel_external_reference_relationship from anon, authenticated;

commit;
