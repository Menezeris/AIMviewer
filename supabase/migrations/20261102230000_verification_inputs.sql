-- D-185 UI (area verification ticks in the properties panel): formula cells and a recipe explanation with the verification result.
-- APPLIED to production 2. 11. (Samuel "yes", orchestrator).
-- Additive: two new columns in verification_results, v_verification_latest gets the same columns at the end
-- (create or replace view may only add columns at the end). Old rows stay with NULL; the viewer then shows the formula as text.
-- Until the migration is in the DB, the host (lib/verify/store.ts) saves the run without these columns and nothing is lost from the computation.
-- Rollback: create or replace view cannot remove columns, so drop view + the original definition from
--   20261101200000_verification_results.sql; then alter table verification_results drop column inputs, drop column explanation;

alter table verification_results
  add column if not exists inputs jsonb check (inputs is null or jsonb_typeof(inputs) = 'object'),  -- {expression?, cells: [{key, label, value, unit, global_id?}], file_meta?: {method_of_measurement?, formula?}}
  add column if not exists explanation text;                                                       -- how the recipe is computed, 1 to 2 sentences (method registry)

create or replace view v_verification_latest as
  select distinct on (r.model, r.global_id, r.recipe)
         r.id, r.run_id, u.created_at as checked_at, r.model, r.revision, r.global_id, r.element_name,
         r.target, r.recipe, r.status, r.file_value, r.computed_value, r.method, r.definition, r.spec_ref,
         r.tolerance, r.formula, r.note, r.distinct_heights, r.anchors, u.registry_version, u.engine,
         nullif(u.model_revisions, '{}'::jsonb) as based_on, revisions_stale(u.model_revisions) as stale,
         r.inputs, r.explanation
  from verification_results r
  join verification_runs u on u.id = r.run_id
  order by r.model, r.global_id, r.recipe, u.created_at desc, r.id;

revoke all on verification_results, v_verification_latest from anon, authenticated;
