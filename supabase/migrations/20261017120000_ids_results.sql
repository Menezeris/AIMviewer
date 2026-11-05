-- =============================================================================
-- D-081 - Results of checking the model against IDS (requirements library → ifctester)
-- =============================================================================
-- Additive migration. The IDS comes from the requirements library (assetin-library),
-- it is not copied into AIMviewer; only the origin (path/commit, ids:info,
-- SHA-256) and the result are stored. IFC has no concept for the result of a check (BCF is an exchange
-- format for findings) → declared extension (SCHEMA §5).
-- =============================================================================

begin;

create table ids_runs (
  id             uuid primary key default gen_random_uuid(),
  ids_title      text not null,          -- ids:info/title
  ids_version    text,                   -- ids:info/version
  ids_sha256     text not null,          -- content of the IDS file (same file = same hash)
  ids_source     text,                   -- where the IDS comes from (e.g. assetin-library@<commit>:<path>)
  model_label    text not null,          -- ASR / VZT (federation model)
  model_file     text,
  specs_total    int not null default 0,
  specs_passed   int not null default 0,
  results_total  int not null default 0,
  results_failed int not null default 0,
  checked_at     timestamptz not null default now()
);
create index on ids_runs (ids_title, model_label, checked_at desc);

create table ids_results (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references ids_runs(id) on delete cascade,
  spec_identifier    text,               -- specification identifier = note ID in the library (IU-O-space...)
  spec_name          text not null,
  spec_description   text,
  spec_instructions  text,
  object_id          uuid references objects(id) on delete cascade,  -- null = the element is not in the DB / specification row
  ifc_guid           text,               -- null = result of the whole specification (e.g. required, but nothing applies to it)
  ifc_type           text,
  status             text not null check (status in ('pass', 'fail')),
  reasons            text[] not null default '{}'
);
create index on ids_results (run_id);
create index on ids_results (object_id);

-- Results of the latest run of each IDS × model pair (LLM, 3D).
create view v_ids_latest as
  with latest as (
    select distinct on (ids_title, model_label) *
    from ids_runs order by ids_title, model_label, checked_at desc
  )
  select r.id, l.id as run_id, l.ids_title, l.model_label, l.checked_at,
         r.spec_identifier, r.spec_name, r.status, r.reasons,
         r.object_id, o.object_ref, o.name, coalesce(o.ifc_type, r.ifc_type) as ifc_type, r.ifc_guid
  from latest l
  join ids_results r on r.run_id = l.id
  left join objects o on o.id = r.object_id;

-- Overview of compliance by specification (latest run).
create view v_ids_summary as
  select ids_title, model_label, checked_at, spec_identifier, spec_name,
         count(*) filter (where ifc_guid is not null)                     as elements,
         count(*) filter (where ifc_guid is not null and status = 'pass') as passed,
         count(*) filter (where status = 'fail')                          as failed,
         (array_agg(reasons[1]) filter (where status = 'fail'))[1]        as example_reason
  from v_ids_latest
  group by ids_title, model_label, checked_at, spec_identifier, spec_name;

commit;
