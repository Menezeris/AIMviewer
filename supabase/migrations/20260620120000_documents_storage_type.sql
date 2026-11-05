-- =============================================================================
-- AIM Platform - migration: documents.storage_type (D-032 / D-036, E3)
-- =============================================================================
-- Additive migration (CLAUDE.md: migrations are never deleted or edited).
--
-- Adds `documents.storage_type` - how the Viewer/Export should handle `location`
-- without parsing the URL scheme (D-032):
--   * supabase   - file uploaded to our Storage bucket `documents/`;
--                  `location` = public URL.
--   * external   - link to a foreign system (SharePoint/web/BIM server) as-is.
--   * unresolved - the document exists (e.g. from IFC), the file is not available.
--
-- TEXT validated in the app/ETL (not CHECK) - line of D-018 (extending the type = additive).
-- Default 'unresolved' is safe for existing rows (no file yet).
-- =============================================================================

alter table documents
  add column if not exists storage_type text not null default 'unresolved';

comment on column documents.storage_type is
  'supabase | external | unresolved — ako narábať s location (D-032/D-036).';
