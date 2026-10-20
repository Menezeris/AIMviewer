-- =============================================================================
-- D-104 - Klasifikácia dokumentu (typ informácie ISO 19650)
-- =============================================================================
-- Aditívna migrácia (AGENTS.md: migrácie sa nemažú ani needitujú).
--
-- IFC nemá na IfcDocumentInformation atribút pre druh dokumentu; druh je klasifikácia
-- (ASR v77: systém "ISO 19650 typ informácie", kódy DR, CA, RP, SH, SP). Dokument nie je
-- IfcRoot, takže IfcRelAssociatesClassification naň nedosiahne: väzba je
-- IfcExternalReferenceRelationship (resource, ako rel_document_information_relationship).
-- to_id vedie na classification_references ako pri rel_associates_classification.
-- =============================================================================

begin;

-- relationship_types podľa manifestu (python -m etl.manifest)
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

-- Čítanie len server-side cez service_role (D-026, migrácia 20261016120000).
revoke all on rel_external_reference_relationship from anon, authenticated;

commit;
