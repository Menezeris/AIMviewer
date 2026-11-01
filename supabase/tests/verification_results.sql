-- D-185: verification_runs, verification_results a v_verification_latest (pripravená migrácia
-- supabase/pending/20261101200000_verification_results.sql).
-- Spustenie na lokálnej DB s aplikovanými migráciami a pripravenou migráciou (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/pending/20261101200000_verification_results.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/verification_results.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- aktuálne revízie: ASR v79 (bez ostatných modelov stačí jeden riadok)
delete from model_revisions where model = 'ZZTEST';

do $$
declare
  cur integer;
  run_old uuid;
  run_new uuid;
  n integer;
  r record;
begin
  -- stĺpcové kontroly
  begin
    insert into verification_runs (registry_version, engine, model_revisions) values (1, 'e', '[]');
    raise exception 'FAIL: model_revisions musí byť objekt';
  exception when check_violation then null;
  end;
  insert into verification_runs (id, registry_version, engine, model_revisions, counts, created_at)
    values ('00000000-0000-4000-8000-0000000000b1', 1, 'e', '{"ASR": -1}', '{"green": 1}', now() - interval '1 hour')
    returning id into run_old;
  begin
    insert into verification_results (run_id, model, global_id, target, recipe, status, method)
      values (run_old, 'ASR', 'g', 'Qto_SpaceBaseQuantities.Height', 'space.height.own@1', 'blue', 'm');
    raise exception 'FAIL: status bez kontroly';
  exception when check_violation then null;
  end;
  begin
    insert into verification_results (run_id, model, global_id, target, recipe, status, method, anchors)
      values (run_old, 'ASR', 'g', 'Qto_SpaceBaseQuantities.Height', 'space.height.own@1', 'green', 'm', '{}');
    raise exception 'FAIL: anchors musí byť pole';
  exception when check_violation then null;
  end;

  -- starý beh nad neexistujúcou revíziou -1 (stale = true), nový nad aktuálnou revíziou ASR (stale = false)
  select (model_revisions_at(null) ->> 'ASR')::int into cur;
  insert into verification_results (run_id, model, revision, global_id, target, recipe, status, file_value, computed_value, method, anchors)
    values (run_old, 'ASR', -1, 'g1', 'Qto_SpaceBaseQuantities.Height', 'space.height.own@1', 'red', 3.95, 3.90, 'm', '[]');
  insert into verification_runs (id, registry_version, engine, model_revisions, counts)
    values ('00000000-0000-4000-8000-0000000000b2', 1, 'e',
            case when cur is null then '{}'::jsonb else jsonb_build_object('ASR', cur) end, '{"green": 1}')
    returning id into run_new;
  insert into verification_results (run_id, model, revision, global_id, target, recipe, status, file_value, computed_value, method,
                                    distinct_heights, anchors)
    values (run_new, 'ASR', cur, 'g1', 'Qto_SpaceBaseQuantities.Height', 'space.height.own@1', 'green', 3.95, 3.95, 'm',
            '[3.05, 2.6]', '[{"global_id": "g1", "role": "teleso miestnosti", "z_m": 4.85}]');

  select count(*) into n from v_verification_latest where global_id = 'g1';
  if n <> 1 then raise exception 'FAIL: v_verification_latest má % riadkov pre g1 (čakané 1)', n; end if;
  select * into r from v_verification_latest where global_id = 'g1';
  if r.run_id <> run_new or r.status <> 'green' then raise exception 'FAIL: najnovší beh nie je posledný (%, %)', r.run_id, r.status; end if;
  if cur is not null and r.stale is distinct from false then raise exception 'FAIL: aktuálna revízia nie je stale=false (%)', r.stale; end if;
  if cur is null and r.stale is not null then raise exception 'FAIL: neznámy podpis má byť stale=null (%)', r.stale; end if;

  -- starý beh sám: stale = true
  delete from verification_runs where id = run_new;
  select * into r from v_verification_latest where global_id = 'g1';
  if r.run_id <> run_old or r.stale is distinct from true then raise exception 'FAIL: beh nad revíziou -1 nie je stale (%)', r.stale; end if;

  -- kaskáda: zmazanie behu zmaže výsledky
  delete from verification_runs where id = run_old;
  select count(*) into n from verification_results where global_id = 'g1';
  if n <> 0 then raise exception 'FAIL: kaskáda nezmazala výsledky (%)', n; end if;

  -- práva: anon a authenticated nič
  if has_table_privilege('anon', 'verification_runs', 'select') or has_table_privilege('authenticated', 'verification_results', 'insert')
     or has_table_privilege('anon', 'v_verification_latest', 'select') then
    raise exception 'FAIL: anon/authenticated majú práva';
  end if;
  raise notice 'OK verification_results';
end $$;

rollback;
