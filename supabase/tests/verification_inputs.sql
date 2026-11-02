-- D-185 UI: stĺpce inputs a explanation (migrácia supabase/migrations/20261102230000_verification_inputs.sql, aplikovaná 2. 11.).
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/verification_inputs.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

do $$
declare
  run_id uuid;
  r record;
begin
  insert into verification_runs (registry_version, engine, model_revisions) values (3, 'e', '{}') returning id into run_id;
  begin
    insert into verification_results (run_id, model, global_id, target, recipe, status, method, inputs)
      values (run_id, 'ZZTEST', 'g', 'Qto_SpaceBaseQuantities.Height', 'space.height.slabs@2', 'green', 'm', '[]');
    raise exception 'FAIL: inputs musí byť objekt';
  exception when check_violation then null;
  end;
  insert into verification_results (run_id, model, global_id, target, recipe, status, method)
    values (run_id, 'ZZTEST', 'g0', 'Qto_SpaceBaseQuantities.Height', 'space.height.slabs@2', 'green', 'm');
  insert into verification_results (run_id, model, global_id, target, recipe, status, method, inputs, explanation)
    values (run_id, 'ZZTEST', 'g1', 'Qto_SpaceBaseQuantities.Height', 'space.height.slabs@2', 'green', 'm',
            '{"expression": "A - B", "cells": [{"key": "A", "label": "spodok dosky nad", "value": 8.8, "unit": "m"}]}', 'Výška miestnosti...');
  select * into r from v_verification_latest where model = 'ZZTEST' and global_id = 'g1';
  if r.inputs ->> 'expression' is distinct from 'A - B' or r.explanation is distinct from 'Výška miestnosti...' then
    raise exception 'FAIL: pohľad nevracia inputs / explanation';
  end if;
  select * into r from v_verification_latest where model = 'ZZTEST' and global_id = 'g0';
  if r.inputs is not null or r.explanation is not null then raise exception 'FAIL: starý riadok bez buniek má mať NULL'; end if;
  if has_table_privilege('anon', 'v_verification_latest', 'select') then raise exception 'FAIL: anon číta pohľad'; end if;
  raise notice 'verification_inputs: OK';
end $$;

rollback;
