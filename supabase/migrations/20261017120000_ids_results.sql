-- =============================================================================
-- D-081 — Výsledky kontroly modelu voči IDS (knižnica požiadaviek → ifctester)
-- =============================================================================
-- Aditívna migrácia. IDS pochádza z knižnice požiadaviek (assetin-library),
-- do AIMviewera sa nekopíruje; ukladá sa len pôvod (cesta/commit, ids:info,
-- SHA-256) a výsledok. IFC na výsledok kontroly koncept nemá (BCF je výmenný
-- formát nálezov) → deklarovaná extenzia (SCHEMA §5).
-- =============================================================================

begin;

create table ids_runs (
  id             uuid primary key default gen_random_uuid(),
  ids_title      text not null,          -- ids:info/title
  ids_version    text,                   -- ids:info/version
  ids_sha256     text not null,          -- obsah IDS súboru (rovnaký súbor = rovnaký hash)
  ids_source     text,                   -- odkiaľ IDS je (napr. assetin-library@<commit>:<cesta>)
  model_label    text not null,          -- ASR / VZT (model federácie)
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
  spec_identifier    text,               -- identifikátor špecifikácie = ID poznámky v knižnici (IU-O-space…)
  spec_name          text not null,
  spec_description   text,
  spec_instructions  text,
  object_id          uuid references objects(id) on delete cascade,  -- null = prvok nie je v DB / riadok špecifikácie
  ifc_guid           text,               -- null = výsledok celej špecifikácie (napr. povinná, ale nič sa na ňu nevzťahuje)
  ifc_type           text,
  status             text not null check (status in ('pass', 'fail')),
  reasons            text[] not null default '{}'
);
create index on ids_results (run_id);
create index on ids_results (object_id);

-- Výsledky posledného behu každej dvojice IDS × model (LLM, 3D).
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

-- Prehľad plnenia po špecifikáciách (posledný beh).
create view v_ids_summary as
  select ids_title, model_label, checked_at, spec_identifier, spec_name,
         count(*) filter (where ifc_guid is not null)                     as elements,
         count(*) filter (where ifc_guid is not null and status = 'pass') as passed,
         count(*) filter (where status = 'fail')                          as failed,
         (array_agg(reasons[1]) filter (where status = 'fail'))[1]        as example_reason
  from v_ids_latest
  group by ids_title, model_label, checked_at, spec_identifier, spec_name;

commit;
