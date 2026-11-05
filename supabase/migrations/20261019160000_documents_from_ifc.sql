-- =============================================================================
-- D-104 step 1 - Documents from IFC: attributes, documentation tree, references to a part
-- =============================================================================
-- Additive migration (AGENTS.md: migrations are neither deleted nor edited).
--
-- 1) `documents` gets the IfcDocumentInformation attributes that ASR carries and that were so far
--    discarded (SCHEMA §5: "they will be added additively when needed"), and
--    `referenced_document_id` for IfcDocumentReference (object_type
--    `document_reference`, a part of a document, e.g. a page of the assembly schedule).
-- 2) Documentation tree (PD -> part -> file) from IfcDocumentInformationRelationship:
--    a new rel_type, resource like rel_member_of (D-048), direction part -> parent.
-- 3) rel_associates_document may also lead to `document_reference`.
-- =============================================================================

begin;

alter table documents
  add column creation_time timestamptz,
  add column last_revision_time timestamptz,
  add column electronic_format text,
  add column referenced_document_id uuid references objects(id) on delete set null;

comment on column documents.creation_time is 'IfcDocumentInformation.CreationTime (D-104).';
comment on column documents.last_revision_time is 'IfcDocumentInformation.LastRevisionTime (D-104).';
comment on column documents.electronic_format is 'IfcDocumentInformation.ElectronicFormat, MIME typ (D-104).';
comment on column documents.referenced_document_id is
  'IfcDocumentReference.ReferencedDocument: dokument, ktorého časť odkaz označuje (D-104). '
  'Vyplnené len pri object_type = document_reference.';

create index idx_documents_referenced on documents (referenced_document_id)
  where referenced_document_id is not null;

-- 2) relationship_types per the manifest (python -m etl.manifest)
insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('rel_document_information_relationship', 'IfcDocumentInformationRelationship', null, false, 'to',
   array['document'], array['document'], false,
   'rel', 'resource', false,
   'Strom dokumentácie (D-104): časť → nadradený dokument; role = RelationshipType (napr. SUBDOCUMENT). IFC resource, nie IfcRel.')
on conflict (rel_type) do nothing;

update relationship_types set
  to_object_types = array['document', 'document_reference'],
  description = 'Väzba objekt → dokument (D-014) alebo jeho časť (IfcDocumentReference, D-104); role=''drawing'' pre E4.'
where rel_type = 'rel_associates_document';

create view rel_document_information_relationship as
  select id, from_id, to_id, role, valid_from, valid_until, source
  from relationships where rel_type = 'rel_document_information_relationship';

create index idx_relationships_document_part_to on relationships (to_id)
  where rel_type = 'rel_document_information_relationship';

-- Read only server-side via service_role (D-026, migration 20261016120000).
revoke all on rel_document_information_relationship from anon, authenticated;

commit;
