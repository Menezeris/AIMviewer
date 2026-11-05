-- =============================================================================
-- TRANSITIONAL backward-compat views (expand/contract) - D-048 zero-downtime cutover
-- =============================================================================
-- Old deployed code (main) queries the original edge names. After D-048 is applied to
-- the cloud it would break (tables renamed/split). These views expose the old
-- names over the new IFC-canonical tables (READ-ONLY - the app is read-only),
-- so that:
--   • the cloud can be migrated at any time without breaking the live viewer (main),
--   • the branch preview build passes (new code reads the real tables),
--   • after the new code is deployed (merge → main) the cleanup migration drops these views.
--
-- NOT part of the target schema - it is a temporary shim. Drop after the cutover.
-- =============================================================================

begin;

-- rel_located_in = union of the split spatial edges (without `role`, as originally)
create view rel_located_in as
  select id, from_id, to_id, valid_from, valid_until, source from rel_aggregates
  union all
  select id, from_id, to_id, valid_from, valid_until, source from rel_contained_in_spatial_structure;

-- pure 1:1 renames - same columns, select * is enough
create view rel_defined_by_type   as select * from rel_defines_by_type;
create view rel_has_document       as select * from rel_associates_document;
create view rel_has_classification as select * from rel_associates_classification;
create view rel_responsible_for    as select * from rel_assigns_to_actor;

commit;
