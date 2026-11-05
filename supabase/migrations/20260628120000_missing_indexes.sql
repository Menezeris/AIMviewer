-- =============================================================================
-- Missing indexes on FK columns of edges (D-009).
-- =============================================================================
-- Reason: the initial migration indexed only from_id on most tables.
-- These to_id indexes cover real query patterns:
--   • rel_has_classification(to_id): v_asset_classifications JOIN (D-023)
--   • rel_has_document(to_id): fetchFloorDrawings WHERE to_id IN (...)
--   • rel_member_of(to_id): fetchOrganizationImpl WHERE to_id = ?
--   • ifc_guid_history(object_id): fetchGuidHistory WHERE object_id = ?
--     (uniq_active_guid covers only WHERE valid_until IS NULL)
--
-- Optional partial index for the E4 hot path (pdf_link auto-linking, D-041).
-- =============================================================================

create index if not exists idx_rel_has_classification_to_id
  on rel_has_classification (to_id);

create index if not exists idx_rel_has_document_to_id
  on rel_has_document (to_id);

create index if not exists idx_rel_member_of_to_id
  on rel_member_of (to_id);

create index if not exists idx_ifc_guid_history_object_id
  on ifc_guid_history (object_id);

-- E4 auto-linking: from_id WHERE source = 'pdf_link (E4)' - fetchElementDrawings hot path
create index if not exists idx_rel_has_document_e4_from
  on rel_has_document (from_id)
  where source = 'pdf_link (E4)';
