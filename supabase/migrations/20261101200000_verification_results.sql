-- D-185 (overovač výmer voči geometrii): uložené behy overenia výmer IfcSpace k revízii modelu.
-- APLIKOVANÉ na produkciu 1. 11. (Samuel "áno", orchestrátor).
-- Beh zapisuje host (`ifc_measure verify=true save=true`, lib/verify/store.ts, service_role). Výsledok nesie podpis vstupu
-- `model_revisions` {model: revízia} (D-183 bod 11); pri novej revízii modelu je `stale` (nikdy sa neprepisuje ani nemaže).
-- Výklad D-183 bod 6 (Samuel 1. 11.): vypočítaná hodnota, rozdiel, stav a kotvy na kóty nie sú geometria ani odtlačok tvaru,
-- ale výsledok behu. Do IFC sa nič nezapisuje; nesúlad ide autorovi cez BCF.
-- Aditívne, bez zmeny existujúcich objektov. Závisí od `revisions_stale(jsonb)` (20261030120000_information_containers.sql).
-- Rollback: drop view if exists v_verification_latest; drop table if exists verification_results; drop table if exists verification_runs;

create table if not exists verification_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope text not null default 'IfcSpace',                       -- trieda overovaných prvkov (zatiaľ len IfcSpace)
  registry_version integer not null,                            -- lib/verify/quantity-methods.ts REGISTRY_VERSION
  engine text not null,                                         -- verzia motora (@ifc-lite/...)
  model_revisions jsonb not null default '{}'::jsonb check (jsonb_typeof(model_revisions) = 'object'),  -- {model: revízia}
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),                   -- {green, yellow, red, grey}
  author text
);
create index if not exists idx_verification_runs_created on verification_runs (created_at desc);

create table if not exists verification_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references verification_runs (id) on delete cascade,
  model text not null,
  revision integer,                                             -- revízia modelu prvku (z model_revisions behu)
  global_id text not null,                                      -- IFC GlobalId overovaného prvku
  element_name text,
  target text not null,                                         -- Pset.Veličina, napr. Qto_SpaceBaseQuantities.Height
  recipe text not null,                                         -- recept s verziou z registra, napr. space.height.own@1
  status text not null check (status in ('green', 'yellow', 'red', 'grey')),
  file_value double precision,                                  -- hodnota zo súboru (m, m2, m3)
  computed_value double precision,                              -- hodnota z geometrie
  method text not null,                                         -- čo sa meria (text z registra)
  definition text,                                              -- doslovná definícia zo schémy
  spec_ref text,                                                -- repo@commit:súbor#veličina
  tolerance text,                                               -- použitá tolerancia (text s číslom)
  formula text,                                                 -- vzorec s dosadenými číslami
  note text,
  distinct_heights jsonb check (distinct_heights is null or jsonb_typeof(distinct_heights) = 'array'),
  anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(anchors) = 'array')  -- [{global_id, role, z_m?}]
);
create index if not exists idx_verification_results_run on verification_results (run_id);
create index if not exists idx_verification_results_element on verification_results (model, global_id, recipe);

-- Posledný výsledok každého receptu na prvku, s podpisom a príznakom zastarania (ako v_ids_latest, v_clash_latest).
create or replace view v_verification_latest as
  select distinct on (r.model, r.global_id, r.recipe)
         r.id, r.run_id, u.created_at as checked_at, r.model, r.revision, r.global_id, r.element_name,
         r.target, r.recipe, r.status, r.file_value, r.computed_value, r.method, r.definition, r.spec_ref,
         r.tolerance, r.formula, r.note, r.distinct_heights, r.anchors, u.registry_version, u.engine,
         nullif(u.model_revisions, '{}'::jsonb) as based_on, revisions_stale(u.model_revisions) as stale
  from verification_results r
  join verification_runs u on u.id = r.run_id
  order by r.model, r.global_id, r.recipe, u.created_at desc, r.id;

-- Práva ako pri ostatných behoch (D-183 K1): anon/authenticated nič, zapisuje a číta host cez service_role.
revoke all on verification_runs, verification_results, v_verification_latest from anon, authenticated;
