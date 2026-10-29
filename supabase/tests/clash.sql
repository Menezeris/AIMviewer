-- D-164: clash_tests, clash_runs, clash_results, clash_reviews + v_clash_latest / v_clash_summary.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/clash.sql
begin;

-- Graf AIM: dva prvky s GUID, jeden v systéme VZT-01.
insert into objects (id, object_type, object_ref, name) values
  ('00000000-0000-4000-8000-0000000000e1', 'asset', 'T.01', 'Potrubie'),
  ('00000000-0000-4000-8000-0000000000e2', 'asset', 'T.02', 'Stena'),
  ('00000000-0000-4000-8000-0000000000e3', 'system', 'SYS.01', 'VZT-01');
insert into ifc_guid_history (object_id, ifc_guid) values
  ('00000000-0000-4000-8000-0000000000e1', 'GUID-DUCT-1'),
  ('00000000-0000-4000-8000-0000000000e2', 'GUID-WALL-1');
insert into relationships (rel_type, from_id, to_id) values
  ('rel_assigns_to_group', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e3');

insert into clash_tests (id, code, name, origin, rules, settings) values
  ('00000000-0000-4000-8000-0000000000a1', 'VZT-NOSNE', 'VZT x nosné', 'default',
   '[{"id":"VZT-NOSNE","a":{"type":"*","model":"VZT"},"b":{"type":"IfcWall*","model":"ASR"}}]', '{"mode":"hard"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'MOJ-TEST', 'Môj test', 'chat',
   '[{"id":"MOJ-TEST","a":{"type":"IfcDuct*"}}]', '{}');

insert into clash_runs (id, test_id, test_code, rules_snapshot, models, engine, trigger, created_at) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'VZT-NOSNE', '{}', '{"VZT":3,"ASR":7}', 'e', 'chat', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'VZT-NOSNE', '{}', '{"VZT":4,"ASR":7}', 'e', 'chat', now() - interval '1 hours'),
  ('00000000-0000-4000-8000-0000000000b3', null, null, '{}', '{}', 'e', 'chat', now());

insert into clash_results (run_id, clash_key, rule, status, severity, distance, a_guid, a_model, b_guid, b_model, storey, center) values
  -- starší beh: dve kolízie
  ('00000000-0000-4000-8000-0000000000b1', 'VZT-NOSNE VZT:GUID-DUCT-1 ASR:GUID-WALL-1', 'VZT-NOSNE', 'hard', 'major', -0.05, 'GUID-DUCT-1', 'VZT', 'GUID-WALL-1', 'ASR', '2NP', '[1,2,3]'),
  ('00000000-0000-4000-8000-0000000000b1', 'VZT-NOSNE VZT:GUID-DUCT-2 ASR:GUID-WALL-1', 'VZT-NOSNE', 'hard', 'minor', -0.01, 'GUID-DUCT-2', 'VZT', 'GUID-WALL-1', 'ASR', '2NP', null),
  -- posledný beh: jedna z nich a jedna nová
  ('00000000-0000-4000-8000-0000000000b2', 'VZT-NOSNE VZT:GUID-DUCT-1 ASR:GUID-WALL-1', 'VZT-NOSNE', 'hard', 'major', -0.04, 'GUID-DUCT-1', 'VZT', 'GUID-WALL-1', 'ASR', '2NP', null),
  ('00000000-0000-4000-8000-0000000000b2', 'VZT-NOSNE VZT:GUID-DUCT-3 ASR:GUID-WALL-9', 'VZT-NOSNE', 'clearance', 'info', 0.02, 'GUID-DUCT-3', 'VZT', 'GUID-WALL-9', 'ASR', '3NP', null),
  -- ad hoc beh
  ('00000000-0000-4000-8000-0000000000b3', 'adhoc A B', 'adhoc', 'hard', 'minor', -0.01, 'A', 'VZT', 'B', 'ASR', null, null);

-- Stav kolízie je kľúčovaný testom a kľúčom kolízie, preto prežije beh (v poslednom behu je tá istá kolízia).
insert into clash_reviews (test_id, clash_key, status, comment) values
  ('00000000-0000-4000-8000-0000000000a1', 'VZT-NOSNE VZT:GUID-DUCT-1 ASR:GUID-WALL-1', 'accepted', 'prechod je zámerný');

do $$
declare n int; s text; c text; sys text; ref text;
begin
  -- v_clash_latest: len posledný beh testu (2 riadky), ad hoc beh tu nie je
  select count(*) into n from v_clash_latest;
  if n <> 2 then raise exception 'v_clash_latest: čakal som 2 riadky, je %', n; end if;
  select count(*) into n from v_clash_latest where run_id = '00000000-0000-4000-8000-0000000000b1' or test_code is null;
  if n <> 0 then raise exception 'v_clash_latest obsahuje starý alebo ad hoc beh'; end if;
  -- review sa pripojí ku kolízii posledného behu cez clash_key; bez review je open
  select review_status, review_comment into s, c from v_clash_latest where a_guid = 'GUID-DUCT-1';
  if s <> 'accepted' or c <> 'prechod je zámerný' then raise exception 'review: % / %', s, c; end if;
  select review_status into s from v_clash_latest where a_guid = 'GUID-DUCT-3';
  if s <> 'open' then raise exception 'kolízia bez review: %', s; end if;
  -- graf AIM: object_ref cez aktívny GUID a systém prvku
  select a_object_ref, b_object_ref, a_system into ref, c, sys from v_clash_latest where a_guid = 'GUID-DUCT-1';
  if ref <> 'T.01' or c <> 'T.02' or sys <> 'VZT-01' then raise exception 'graf: % % %', ref, c, sys; end if;
  select a_object_ref into ref from v_clash_latest where a_guid = 'GUID-DUCT-3';
  if ref is not null then raise exception 'prvok mimo grafu má object_ref'; end if;
  -- riadok sa neduplikuje, keď má prvok viac systémov
  insert into objects (id, object_type, object_ref, name) values ('00000000-0000-4000-8000-0000000000e4', 'system', 'SYS.02', 'AAA-druhy');
  insert into relationships (rel_type, from_id, to_id) values
    ('rel_assigns_to_group', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e4');
  select count(*) into n from v_clash_latest where a_guid = 'GUID-DUCT-1';
  if n <> 1 then raise exception 'viac systémov duplikuje kolíziu: %', n; end if;
  -- v_clash_summary po pravidle, podlaží a stave
  select clashes into n from v_clash_summary where storey = '2NP' and review_status = 'accepted';
  if n <> 1 then raise exception 'v_clash_summary 2NP accepted: %', n; end if;
  select clearance into n from v_clash_summary where storey = '3NP';
  if n <> 1 then raise exception 'v_clash_summary 3NP clearance: %', n; end if;
  -- BCF téma: odkaz sa zobrazí s číslom, zmazanie témy odkaz len zruší
  insert into model_tasks (id, model, title) values ('00000000-0000-4000-8000-0000000000d1', 'VZT', 'Kolízia');
  update clash_reviews set bcf_topic_id = '00000000-0000-4000-8000-0000000000d1';
  select count(*) into n from v_clash_latest where bcf_topic_number is not null;
  if n <> 1 then raise exception 'číslo BCF témy vo view: %', n; end if;
  delete from model_tasks where id = '00000000-0000-4000-8000-0000000000d1';
  select count(*) into n from clash_reviews where bcf_topic_id is null;
  if n <> 1 then raise exception 'zmazanie témy má odkaz zrušiť'; end if;
end $$;

do $$
declare n int;
begin
  -- kód testu je jedinečný a má tvar; pravidlá sú neprázdne pole
  begin
    insert into clash_tests (code, name, origin, rules) values ('MOJ-TEST', 'x', 'chat', '[{}]');
    raise exception 'duplicitný kód prešiel';
  exception when unique_violation then null;
  end;
  begin
    insert into clash_tests (code, name, origin, rules) values ('zlý kód', 'x', 'chat', '[{}]');
    raise exception 'zlý tvar kódu prešiel';
  exception when check_violation then null;
  end;
  begin
    insert into clash_tests (code, name, origin, rules) values ('PRAZDNE', 'x', 'chat', '[]');
    raise exception 'test bez pravidiel prešiel';
  exception when check_violation then null;
  end;
  begin
    insert into clash_tests (code, name, origin, rules) values ('INY-PRIVOD', 'x', 'import', '[{}]');
    raise exception 'neznámy pôvod prešiel';
  exception when check_violation then null;
  end;
  -- hodnoty review a kolízie sú obmedzené
  begin
    insert into clash_reviews (test_id, clash_key, status) values ('00000000-0000-4000-8000-0000000000a2', 'k', 'zrušené');
    raise exception 'neznámy stav review prešiel';
  exception when check_violation then null;
  end;
  begin
    insert into clash_results (run_id, clash_key, rule, status, severity, distance, a_guid, a_model, b_guid, b_model)
    values ('00000000-0000-4000-8000-0000000000b3', 'k', 'r', 'touch', 'minor', 0, 'a', 'm', 'b', 'n');
    raise exception 'status touch prešiel';
  exception when check_violation then null;
  end;
  -- jeden stav na (test, kolíziu)
  begin
    insert into clash_reviews (test_id, clash_key) values ('00000000-0000-4000-8000-0000000000a1', 'VZT-NOSNE VZT:GUID-DUCT-1 ASR:GUID-WALL-1');
    raise exception 'duplicitný review prešiel';
  exception when unique_violation then null;
  end;
  -- zmazanie behu zmaže kolízie, review ostane (patrí testu)
  delete from clash_runs where id = '00000000-0000-4000-8000-0000000000b1';
  select count(*) into n from clash_results where run_id = '00000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'kolízie zmazaného behu ostali'; end if;
  select count(*) into n from clash_reviews where test_id = '00000000-0000-4000-8000-0000000000a1';
  if n <> 1 then raise exception 'review zmizol so starým behom'; end if;
  -- zmazanie testu zmaže jeho behy, kolízie aj review
  delete from clash_tests where id = '00000000-0000-4000-8000-0000000000a1';
  select count(*) into n from clash_runs where test_id = '00000000-0000-4000-8000-0000000000a1';
  if n <> 0 then raise exception 'behy zmazaného testu ostali'; end if;
  select count(*) into n from clash_reviews where test_id = '00000000-0000-4000-8000-0000000000a1';
  if n <> 0 then raise exception 'review zmazaného testu ostal'; end if;
  select count(*) into n from clash_results where run_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'kolízie behov zmazaného testu ostali'; end if;
end $$;

-- Práva: anon a authenticated nové objekty nevidia, service_role áno
do $$
declare t text;
begin
  foreach t in array array['clash_tests', 'clash_runs', 'clash_results', 'clash_reviews', 'v_clash_latest', 'v_clash_summary'] loop
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') then
      raise exception 'anon/authenticated majú práva na %', t;
    end if;
    if not has_table_privilege('service_role', t, 'select') then
      raise exception 'service_role nemá právo na %', t;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'clash_results', 'insert') then
    raise exception 'service_role nemá právo zapisovať kolízie';
  end if;
end $$;

rollback;
