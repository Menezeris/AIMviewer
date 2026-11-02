-- D-185 UI (fajočky overenia výmer v paneli vlastností): bunky vzorca a vysvetlenie receptu pri výsledku overenia.
-- PRIPRAVENÉ, NESPUSTENÉ (supabase/pending): aplikuje orchestrátor so Samuelovým slovom, potom presun do migrations.
-- Aditívne: dva nové stĺpce vo verification_results, v_verification_latest dostane tie isté stĺpce na konci
-- (create or replace view smie stĺpce len pridať na koniec). Staré riadky ostanú s NULL; viewer vtedy ukáže vzorec textom.
-- Kým migrácia nie je v DB, host (lib/verify/store.ts) uloží beh bez týchto stĺpcov a nič sa nestratí z výpočtu.
-- Rollback: create or replace view nejde odobrať stĺpce, preto drop view + pôvodná definícia z
--   20261101200000_verification_results.sql; potom alter table verification_results drop column inputs, drop column explanation;

alter table verification_results
  add column if not exists inputs jsonb check (inputs is null or jsonb_typeof(inputs) = 'object'),  -- {expression?, cells: [{key, label, value, unit, global_id?}], file_meta?: {method_of_measurement?, formula?}}
  add column if not exists explanation text;                                                       -- ako sa recept počíta, 1 až 2 vety (register metód)

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
