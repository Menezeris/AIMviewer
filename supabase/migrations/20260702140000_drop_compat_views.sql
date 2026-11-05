-- =============================================================================
-- Cleanup after the D-048 cutover - dropping the transitional backward-compat views
-- =============================================================================
-- New code (deployed to main) reads the IFC-canonical tables directly. The transitional views
-- with the old names (20260702130000) are no longer used by anyone → we drop them.
-- This completes expand/contract and the schema is in its target state.
-- =============================================================================

begin;

drop view if exists rel_located_in;
drop view if exists rel_defined_by_type;
drop view if exists rel_has_document;
drop view if exists rel_has_classification;
drop view if exists rel_responsible_for;

commit;
