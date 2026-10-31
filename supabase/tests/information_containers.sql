-- D-183 K1: information_containers, container_revisions, podpis vstupu na behoch a kalibráciách, stale.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/information_containers.sql
begin;

-- Revízie modelu ASR (v0, potom v72 v hlavnej rade) a VZT v11.
insert into model_revisions (id, model, revision, parent_revision, is_current, sha256, size_bytes, archive_path, recipe_ref, author, created_at) values
  ('00000000-0000-4000-8000-0000000000c0', 'ASR', 0, null, false, repeat('a', 64), 100, 'ifc/archive/ASR/v000.ifc.gz', null, 'Samuel', '2026-06-30'),
  ('00000000-0000-4000-8000-0000000000c1', 'ASR', 72, 0, true, repeat('b', 64), 200, 'ifc/archive/ASR/v072.ifc.gz', 'recepty/ASR/v072.py@abc123', 'Samuel', '2026-10-18'),
  ('00000000-0000-4000-8000-0000000000c2', 'VZT', 11, null, true, repeat('c', 64), 300, 'ifc/archive/VZT/v011.ifc.gz', null, null, '2026-10-29');

do $$
declare n int; a text; b text; c text; d text;
begin
  select count(*) into n from container_revisions r join information_containers c on c.id = r.container_id where c.model = 'ASR';
  if n is distinct from 2 then raise exception 'ASR: čakal som 2 revízie kontajnera, je %', n; end if;
  select container_type, identification into a, b from information_containers where model = 'ASR';
  if a is distinct from 'IFC' or b is distinct from 'ASR' then raise exception 'kontajner ASR: % %', a, b; end if;
  select string_agg(change_action, ',' order by revision_no) into a
    from container_revisions r join information_containers c on c.id = r.container_id where c.model = 'ASR';
  if a is distinct from 'ADDED,MODIFIED' then raise exception 'ChangeAction ASR: %', a; end if;
  select r.revision, r.commit_sha, r.location, r.status into a, b, c, d
    from container_revisions r where r.model_revision_id = '00000000-0000-4000-8000-0000000000c1';
  if a is distinct from '72' or b is distinct from 'abc123' or c is distinct from 'ifc/archive/ASR/v072.ifc.gz' or d is distinct from 'DRAFT' then
    raise exception 'revízia v72: % % % %', a, b, c, d;
  end if;
  select last_modifying_user, owning_application into a, b from v_container_revisions where model = 'ASR' and revision_no = 72;
  if a is distinct from 'Samuel' or b is not null then raise exception 'v_container_revisions: % %', a, b; end if;
  select count(*) into n from v_container_revisions where model = 'ASR' and is_latest;
  if n is distinct from 1 then raise exception 'is_latest: %', n; end if;
  -- creation_time = prvá revízia kontajnera, last_revision_time = táto revízia
  select count(*) into n from container_revisions r join information_containers c on c.id = r.container_id
   where c.model = 'ASR' and r.revision_no = 72 and r.creation_time = '2026-06-30' and r.last_revision_time = '2026-10-18';
  if n is distinct from 1 then raise exception 'CreationTime / LastRevisionTime v72'; end if;
end $$;

-- Hlavná rada, nemennosť, mazanie len poslednej (D-183 bod 10).
do $$
declare n int;
begin
  begin
    insert into model_revisions (model, revision, parent_revision, sha256, size_bytes, archive_path)
    values ('ASR', 71, 0, repeat('d', 64), 1, 'x');
    raise exception 'nižšia revízia prešla';
  exception when raise_exception then
    if sqlerrm not like '%nie je vyššia%' then raise; end if;
  end;
  begin
    insert into model_revisions (model, revision, parent_revision, sha256, size_bytes, archive_path)
    values ('ASR', 80, 0, repeat('d', 64), 1, 'x');
    raise exception 'vetva mimo hlavnej rady prešla';
  exception when raise_exception then
    if sqlerrm not like '%nadväzovať%' then raise; end if;
  end;
  begin
    update model_revisions set sha256 = repeat('e', 64) where model = 'ASR' and revision = 72;
    raise exception 'prepis sha256 revízie modelu prešiel';
  exception when raise_exception then
    if sqlerrm not like '%nemenná%' then raise; end if;
  end;
  begin
    update container_revisions set sha256 = repeat('e', 64) where revision_no = 72;
    raise exception 'prepis sha256 revízie kontajnera prešiel';
  exception when raise_exception then
    if sqlerrm not like '%nemenná%' then raise; end if;
  end;
  begin
    delete from model_revisions where model = 'ASR' and revision = 0;
    raise exception 'zmazanie revízie zo stredu prešlo';
  exception when raise_exception then
    if sqlerrm not like '%len posledná%' then raise; end if;
  end;
  -- is_current a summary sa meniť smú
  update model_revisions set summary = 'oprava popisu' where model = 'ASR' and revision = 72;
  -- posledná revízia sa zmazať dá (aj s revíziou kontajnera) a potom znova pribudne
  delete from model_revisions where model = 'ASR' and revision = 72;
  select count(*) into n from container_revisions where model_revision_id = '00000000-0000-4000-8000-0000000000c1';
  if n is distinct from 0 then raise exception 'revízia kontajnera po zmazaní revízie modelu ostala'; end if;
end $$;
insert into model_revisions (id, model, revision, parent_revision, is_current, sha256, size_bytes, archive_path, author, created_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'ASR', 72, 0, true, repeat('b', 64), 200, 'ifc/archive/ASR/v072.ifc.gz', 'Samuel', '2026-10-18');

-- Dokument (PDF): revízia pri každom novom sha256, rovnaký obsah nič nepridá.
insert into objects (id, object_type, object_ref, name) values
  ('00000000-0000-4000-8000-0000000000d1', 'document', 'D.1.1.09', 'Pôdorys 2NP'),
  ('00000000-0000-4000-8000-0000000000d2', 'document_reference', 'D.1.1.09#2', 'Strana 2');
insert into documents (id, identification, location, electronic_format, file_sha256) values
  ('00000000-0000-4000-8000-0000000000d1', 'D.1.1.09', 'documents/d1109.pdf', 'application/pdf', repeat('1', 64)),
  ('00000000-0000-4000-8000-0000000000d2', 'D.1.1.09', null, null, repeat('2', 64));
update documents set file_sha256 = repeat('1', 64) where id = '00000000-0000-4000-8000-0000000000d1';
update documents set file_sha256 = repeat('3', 64) where id = '00000000-0000-4000-8000-0000000000d1';

do $$
declare n int; a text;
begin
  select count(*) into n from information_containers where document_id = '00000000-0000-4000-8000-0000000000d2';
  if n is distinct from 0 then raise exception 'odkaz na časť dokumentu nie je kontajner'; end if;
  select container_type into a from information_containers where document_id = '00000000-0000-4000-8000-0000000000d1';
  if a is distinct from 'PDF' then raise exception 'typ kontajnera dokumentu: %', a; end if;
  select string_agg(revision || ':' || change_action || ':' || left(sha256, 1), ',' order by revision_no) into a
    from container_revisions r join information_containers c on c.id = r.container_id
   where c.document_id = '00000000-0000-4000-8000-0000000000d1';
  if a is distinct from '1:ADDED:1,2:MODIFIED:3' then raise exception 'revízie dokumentu: %', a; end if;
end $$;

-- Podpis behov a stale.
insert into ids_runs (id, ids_title, ids_sha256, model_label, model_revisions, checked_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'IDS-A', 'x', 'ASR', '{"ASR": 72}', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000e2', 'IDS-B', 'x', 'ASR', '{}', now());
insert into ids_results (run_id, spec_name, status, ifc_guid) values
  ('00000000-0000-4000-8000-0000000000e1', 'S', 'pass', 'G1'),
  ('00000000-0000-4000-8000-0000000000e2', 'S', 'fail', 'G1');

insert into clash_tests (id, code, name, origin, rules) values
  ('00000000-0000-4000-8000-0000000000f0', 'VZT-NOSNE', 'VZT x nosné', 'default', '[{"id":"VZT-NOSNE","a":{"type":"*"}}]');
insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path) values
  ('VZT', 12, 11, false, repeat('9', 64), 300, 'ifc/archive/VZT/v012.ifc.gz');  -- rovnaká veľkosť ako v11
insert into clash_runs (id, test_id, test_code, rules_snapshot, models, engine, trigger, created_at) values
  -- veľkosť ASR jednoznačná (v72), VZT nejednoznačná (v11 aj v12 majú 300) -> len ASR
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f0', 'VZT-NOSNE', '{}',
   '{"ASR": {"etag": "e", "size": 200}, "VZT": {"etag": "f", "size": 300}}', 'e', 'chat', now() - interval '1 hour'),
  -- revízia z motora má prednosť pred veľkosťou
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f0', 'VZT-NOSNE', '{}',
   '{"ASR": {"etag": "e", "size": 999, "revision": 72}, "VZT": {"etag": "f", "size": 300, "revision": 11}}', 'e', 'chat', now());
insert into clash_results (run_id, clash_key, rule, status, severity, distance, a_guid, a_model, b_guid, b_model) values
  ('00000000-0000-4000-8000-0000000000f2', 'k', 'VZT-NOSNE', 'hard', 'major', -0.01, 'G1', 'VZT', 'G2', 'ASR');

do $$
declare n int; j jsonb; s boolean;
begin
  select model_revisions into j from clash_runs where id = '00000000-0000-4000-8000-0000000000f1';
  if j is distinct from '{"ASR": 72}'::jsonb then raise exception 'clash podľa veľkosti: %', j; end if;
  select model_revisions into j from clash_runs where id = '00000000-0000-4000-8000-0000000000f2';
  if j is distinct from '{"ASR": 72, "VZT": 11}'::jsonb then raise exception 'clash z motora: %', j; end if;
  if engine_model_revisions('{"ASR": 0}') is distinct from '{"ASR": 0}'::jsonb then raise exception 'číslo revízie priamo'; end if;
  if engine_model_revisions(null) is distinct from '{}'::jsonb then raise exception 'null models'; end if;

  select based_on, stale into j, s from v_ids_latest where ids_title = 'IDS-A';
  if j is distinct from '{"ASR": 72}'::jsonb or s is distinct from false then raise exception 'IDS-A aktuálne: % %', j, s; end if;
  select based_on, stale into j, s from v_ids_latest where ids_title = 'IDS-B';
  if j is not null or s is not null then raise exception 'IDS-B neznáme: % %', j, s; end if;
  select stale into s from v_clash_latest limit 1;
  if s is distinct from false then raise exception 'clash aktuálny: %', s; end if;
  select count(*) into n from v_ids_summary where stale = false;
  if n is distinct from 1 then raise exception 'v_ids_summary stale: %', n; end if;
  select count(*) into n from v_clash_summary where based_on = '{"ASR": 72, "VZT": 11}'::jsonb;
  if n is distinct from 1 then raise exception 'v_clash_summary based_on: %', n; end if;
end $$;

-- Nová revízia VZT -> behy nad v11 sú zastarané.
update model_revisions set is_current = false where model = 'VZT';
update model_revisions set is_current = true where model = 'VZT' and revision = 12;
do $$
declare s boolean;
begin
  select stale into s from v_clash_latest limit 1;
  if s is distinct from true then raise exception 'clash po novej revízii VZT: %', s; end if;
  select stale into s from v_ids_latest where ids_title = 'IDS-A';
  if s is distinct from false then raise exception 'IDS nad ASR sa VZT netýka: %', s; end if;
  if revisions_stale('{"XYZ": 1}') is distinct from true then raise exception 'neznámy model nie je aktuálny'; end if;
  if model_revisions_at('2026-10-20') is distinct from '{"ASR": 72}'::jsonb then raise exception 'revízie k času: %', model_revisions_at('2026-10-20'); end if;
end $$;

-- Kalibrácie `_georef`: pečiatka pri zápise, prenos pri tej istej kalibrácii, nová pri inej.
insert into objects (id, object_type, object_ref, name, properties) values
  ('00000000-0000-4000-8000-0000000000d3', 'document', 'D.1.1.10', 'Pôdorys 3NP',
   '{"_georef": {"version": 2, "calibrations": [{"page": 1, "page_size": [10, 10], "storey_guid": "S", "storey_z": 3, "affine": [1,0,0,0,1,0], "calibration": [{"pdf_pt": [0,0], "ifc_m": [0,0]}], "source": "auto"}]}}');
insert into documents (id, file_sha256) values ('00000000-0000-4000-8000-0000000000d3', repeat('4', 64));

do $$
declare g jsonb; c jsonb;
begin
  -- dokument pri vložení objektu ešte nemal sha256 -> pečiatka bez sha256, revízie aktuálne
  select properties -> '_georef' -> 'calibrations' -> 0 into c from objects where id = '00000000-0000-4000-8000-0000000000d3';
  if c -> 'model_revisions' is distinct from '{"ASR": 72, "VZT": 12}'::jsonb then raise exception 'pečiatka pri vložení: %', c; end if;

  -- viewer pošle tú istú kalibráciu bez neznámych kľúčov a zmení len priehľadnosť -> pečiatka sa prenesie
  update objects set properties = jsonb_set(properties, '{_georef}',
    '{"version": 2, "calibrations": [{"page": 1, "page_size": [10, 10], "storey_guid": "S", "storey_z": 3, "affine": [1,0,0,0,1,0], "calibration": [{"pdf_pt": [0,0], "ifc_m": [0,0]}], "source": "auto", "opacity": 0.3}]}')
   where id = '00000000-0000-4000-8000-0000000000d3';
  select properties -> '_georef' -> 'calibrations' -> 0 into c from objects where id = '00000000-0000-4000-8000-0000000000d3';
  if c -> 'model_revisions' is distinct from '{"ASR": 72, "VZT": 12}'::jsonb or (c ->> 'opacity')::numeric is distinct from 0.3 then
    raise exception 'prenos pečiatky: %', c;
  end if;

  -- nová revízia VZT v13 a nová kalibrácia (iná affine) -> nová pečiatka so sha256 dokumentu
  insert into model_revisions (model, revision, parent_revision, is_current, sha256, size_bytes, archive_path)
  values ('VZT', 13, 12, false, repeat('8', 64), 301, 'x');
  update model_revisions set is_current = false where model = 'VZT' and revision = 12;
  update model_revisions set is_current = true where model = 'VZT' and revision = 13;
  -- host stavia novú kalibráciu ako nový objekt (bez pečiatky), iná affine = iná kalibrácia
  update objects set properties = jsonb_set(properties, '{_georef}',
    '{"version": 2, "calibrations": [{"page": 1, "page_size": [10, 10], "storey_guid": "S", "storey_z": 3, "affine": [2,0,0,0,2,0], "calibration": [{"pdf_pt": [0,0], "ifc_m": [0,0]}], "source": "auto"}]}')
   where id = '00000000-0000-4000-8000-0000000000d3';
  select properties -> '_georef' -> 'calibrations' -> 0 into c from objects where id = '00000000-0000-4000-8000-0000000000d3';
  if c -> 'model_revisions' is distinct from '{"ASR": 72, "VZT": 13}'::jsonb or c ->> 'document_sha256' is distinct from repeat('4', 64) then
    raise exception 'nová kalibrácia: %', c;
  end if;

  -- spätné doplnenie: revízie platné v čase calibrated_at; bez času sa nič nevymýšľa
  g := georef_stamp('{"version": 2, "calibrations": [{"page": 1, "affine": [1,0,0,0,1,0], "calibrated_at": "2026-10-20T10:00:00Z"}, {"page": 2, "affine": [1,0,0,0,1,0]}]}',
                    null, '00000000-0000-4000-8000-0000000000d3', true);
  if g -> 'calibrations' -> 0 -> 'model_revisions' is distinct from '{"ASR": 72}'::jsonb then raise exception 'spätne k času: %', g; end if;
  if g -> 'calibrations' -> 1 ? 'model_revisions' then raise exception 'spätne bez času: %', g; end if;

  -- v1 (celý _georef je jedna kalibrácia)
  g := georef_stamp('{"version": 1, "page": 1, "affine": [1,0,0,0,1,0], "storey_guid": "S", "storey_z": 0}', null, null);
  if g -> 'model_revisions' is distinct from '{"ASR": 72, "VZT": 13}'::jsonb then raise exception 'v1: %', g; end if;
end $$;

-- Práva.
do $$
declare t text;
begin
  foreach t in array array['ifc_application', 'ifc_actor', 'information_containers', 'container_revisions', 'v_container_revisions',
                           'v_ids_latest', 'v_clash_latest'] loop
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') then
      raise exception 'anon/authenticated majú práva na %', t;
    end if;
    if not has_table_privilege('service_role', t, 'select') then
      raise exception 'service_role nemá právo na %', t;
    end if;
  end loop;
end $$;

rollback;
