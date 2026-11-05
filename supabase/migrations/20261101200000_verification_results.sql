-- D-185 (area verifier against geometry): stored runs of the IfcSpace area verification for a model revision.
-- APPLIED to production 1. 11. (Samuel "yes", orchestrator).
-- The run is written by the host (`ifc_measure verify=true save=true`, lib/verify/store.ts, service_role). The result carries the input signature
-- `model_revisions` {model: revision} (D-183 point 11); on a new model revision it is `stale` (never overwritten or deleted).
-- Interpretation of D-183 point 6 (Samuel 1. 11.): the computed value, difference, status and dimension anchors are not geometry nor a shape fingerprint,
-- but the result of a run. Nothing is written into IFC; a mismatch goes to the author via BCF.
-- Additive, without changing existing objects. Depends on `revisions_stale(jsonb)` (20261030120000_information_containers.sql).
-- Rollback: drop view if exists v_verification_latest; drop table if exists verification_results; drop table if exists verification_runs;

create table if not exists verification_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope text not null default 'IfcSpace',                       -- class of the verified elements (only IfcSpace for now)
  registry_version integer not null,                            -- lib/verify/quantity-methods.ts REGISTRY_VERSION
  engine text not null,                                         -- engine version (@ifc-lite/...)
  model_revisions jsonb not null default '{}'::jsonb check (jsonb_typeof(model_revisions) = 'object'),  -- {model: revision}
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),                   -- {green, yellow, red, grey}
  author text
);
create index if not exists idx_verification_runs_created on verification_runs (created_at desc);

create table if not exists verification_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs (id) on delete cascade,
  model text not null,
  revision integer,                                             -- model revision of the element (from the run's model_revisions)
  global_id text not null,                                      -- IFC GlobalId of the verified element
  element_name text,
  target text not null,                                         -- Pset.Quantity, e.g. Qto_SpaceBaseQuantities.Height
  recipe text not null,                                         -- recipe with a version from the registry, e.g. space.height.own@1
  status text not null check (status in ('green', 'yellow', 'red', 'grey')),
  file_value double precision,                                  -- value from the file (m, m2, m3)
  computed_value double precision,                              -- value from geometry
  method text not null,                                         -- what is measured (text from the registry)
  definition text,                                              -- literal definition from the schema
  spec_ref text,                                                -- repo@commit:file#quantity
  tolerance text,                                               -- tolerance used (text with a number)
  formula text,                                                 -- formula with the numbers substituted
  note text,
  distinct_heights jsonb check (distinct_heights is null or jsonb_typeof(distinct_heights) = 'array'),
  anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(anchors) = 'array')  -- [{global_id, role, z_m?}]
);
create index if not exists idx_verification_results_run on verification_results (run_id);
create index if not exists idx_verification_results_element on verification_results (model, global_id, recipe);

-- Latest result of each recipe on an element, with signature and a staleness flag (like v_ids_latest, v_clash_latest).
create or replace view v_verification_latest as
  select distinct on (r.model, r.global_id, r.recipe)
         r.id, r.run_id, u.created_at as checked_at, r.model, r.revision, r.global_id, r.element_name,
         r.target, r.recipe, r.status, r.file_value, r.computed_value, r.method, r.definition, r.spec_ref,
         r.tolerance, r.formula, r.note, r.distinct_heights, r.anchors, u.registry_version, u.engine,
         nullif(u.model_revisions, '{}'::jsonb) as based_on, revisions_stale(u.model_revisions) as stale
  from verification_results r
  join verification_runs u on u.id = r.run_id
  order by r.model, r.global_id, r.recipe, u.created_at desc, r.id;

-- Rights as with the other runs (D-183 K1): anon/authenticated none, the host writes and reads via service_role.
revoke all on verification_runs, verification_results, v_verification_latest from anon, authenticated;
