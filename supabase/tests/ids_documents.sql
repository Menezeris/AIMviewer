-- D-162: ids_documents, ids_document_versions, ids_runs + v_ids_latest / v_ids_summary.
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/ids_documents.sql
begin;

insert into ids_documents (id, code, title, origin, library_source) values
  ('00000000-0000-4000-8000-0000000000a1', 'LIB-1', 'Knižnica 1', 'library', 'assetin-library@abc:zadanie/x.md'),
  ('00000000-0000-4000-8000-0000000000a2', 'CHAT-1', 'Chat 1', 'chat', null);

insert into ids_document_versions (id, document_id, version, xml, sha256, source) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 1, '<ids/>', 'h1', 'import'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2', 1, '<ids/>', 'h2', 'chat'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a2', 2, '<ids/>', 'h3', 'viewer');

do $$
declare n int;
begin
  -- verzia jedného IDS je jedinečná
  begin
    insert into ids_document_versions (document_id, version, xml, sha256, source)
    values ('00000000-0000-4000-8000-0000000000a2', 2, '<ids/>', 'x', 'chat');
    raise exception 'duplicitná verzia prešla';
  exception when unique_violation then null;
  end;
  -- verzie sú nemenné
  begin
    update ids_document_versions set xml = '<changed/>' where id = '00000000-0000-4000-8000-0000000000b2';
    raise exception 'úprava verzie prešla';
  exception when raise_exception then
    if sqlerrm not like 'verzie IDS sú nemenné%' then raise; end if;
  end;
  -- knižničná snímka je len na čítanie: nová verzia z chatu nejde, import áno
  begin
    insert into ids_document_versions (document_id, version, xml, sha256, source)
    values ('00000000-0000-4000-8000-0000000000a1', 2, '<ids/>', 'x', 'chat');
    raise exception 'zápis do knižničnej snímky prešiel';
  exception when raise_exception then
    if sqlerrm not like 'knižničná snímka%' then raise; end if;
  end;
  insert into ids_document_versions (document_id, version, xml, sha256, source)
  values ('00000000-0000-4000-8000-0000000000a1', 2, '<ids/>', 'x', 'import');
  -- import do chat IDS nejde
  begin
    insert into ids_document_versions (document_id, version, xml, sha256, source)
    values ('00000000-0000-4000-8000-0000000000a2', 3, '<ids/>', 'x', 'import');
    raise exception 'import do chat IDS prešiel';
  exception when raise_exception then
    if sqlerrm not like 'import patrí%' then raise; end if;
  end;
  -- pôvod sa nemení; library bez zdroja ani chat so zdrojom nejde
  begin
    update ids_documents set origin = 'library' where code = 'CHAT-1';
    raise exception 'zmena pôvodu prešla';
  exception when check_violation or raise_exception then null;
  end;
  begin
    insert into ids_documents (code, title, origin) values ('LIB-2', 'x', 'library');
    raise exception 'library bez library_source prešlo';
  exception when check_violation then null;
  end;
  -- derived_from len pre chat
  begin
    insert into ids_documents (code, title, origin, library_source, derived_from)
    values ('LIB-3', 'x', 'library', 's', '00000000-0000-4000-8000-0000000000b1');
    raise exception 'derived_from na library prešlo';
  exception when check_violation then null;
  end;
  insert into ids_documents (code, title, origin, derived_from)
  values ('CHAT-2', 'Odvodené', 'chat', '00000000-0000-4000-8000-0000000000b1');
  -- kód je jedinečný a má tvar
  begin
    insert into ids_documents (code, title, origin) values ('CHAT-1', 'x', 'chat');
    raise exception 'duplicitný kód prešiel';
  exception when unique_violation then null;
  end;
  begin
    insert into ids_documents (code, title, origin) values ('zlý kód', 'x', 'chat');
    raise exception 'zlý tvar kódu prešiel';
  exception when check_violation then null;
  end;
end $$;

-- Behy: starý (bez verzie) zostáva viditeľný, nové sa kľúčujú dokumentom a majú engine, binding.
insert into ids_runs (id, ids_title, ids_sha256, model_label, checked_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'Spoločný názov', 'o', 'ASR', now() - interval '3 hours');
insert into ids_runs (id, ids_title, ids_sha256, model_label, checked_at, ids_version_id, engine, trigger) values
  ('00000000-0000-4000-8000-0000000000c2', 'Spoločný názov', 'a', 'ASR', now() - interval '2 hours', '00000000-0000-4000-8000-0000000000b2', 'ifc-lite', 'chat'),
  ('00000000-0000-4000-8000-0000000000c3', 'Spoločný názov', 'b', 'ASR', now() - interval '1 hours', '00000000-0000-4000-8000-0000000000b3', 'ifc-lite', 'chat'),
  ('00000000-0000-4000-8000-0000000000c4', 'Spoločný názov', 'c', 'ASR', now(), '00000000-0000-4000-8000-0000000000b1', 'ifc-lite', 'viewer');
insert into ids_results (run_id, spec_identifier, spec_name, ifc_guid, status, reasons) values
  ('00000000-0000-4000-8000-0000000000c1', 'S', 'staré', 'g0', 'pass', '{}'),
  ('00000000-0000-4000-8000-0000000000c2', 'S', 'v1 chat', 'g1', 'pass', '{}'),
  ('00000000-0000-4000-8000-0000000000c3', 'S', 'v2 chat', 'g2', 'fail', '{dôvod}'),
  ('00000000-0000-4000-8000-0000000000c4', 'S', 'knižnica', 'g3', 'pass', '{}');

do $$
declare n int; b boolean; e text; c text;
begin
  -- tri dokumenty s rovnakým názvom: starý beh bez verzie, chat IDS (jeho posledná verzia), knižnica
  select count(distinct run_id) into n from v_ids_latest;
  if n <> 3 then raise exception 'posledných behov: čakal som 3, je %', n; end if;
  -- chat IDS: posledný beh je z verzie 2 (nie z 1), starý beh ostáva samostatne viditeľný
  select spec_name, ids_doc_version::text into e, c from v_ids_latest where ids_code = 'CHAT-1';
  if e <> 'v2 chat' or c <> '2' then raise exception 'chat IDS: % / %', e, c; end if;
  select count(*) into n from v_ids_latest where ids_code is null and spec_name = 'staré';
  if n <> 1 then raise exception 'starý beh bez ids_version_id zmizol'; end if;
  select engine, binding into e, b from v_ids_latest where spec_name = 'knižnica';
  if e <> 'ifc-lite' or b then raise exception 'engine/binding: % %', e, b; end if;
  -- starý beh dostal predvolené hodnoty
  select engine, binding into e, b from v_ids_latest where spec_name = 'staré';
  if e <> 'ifctester' or b then raise exception 'predvolené engine/binding: % %', e, b; end if;
  -- súhrn nesie nové stĺpce
  select count(*) into n from v_ids_summary where ids_code = 'CHAT-1' and failed = 1;
  if n <> 1 then raise exception 'v_ids_summary chat IDS: %', n; end if;
  -- zmazanie dokumentu zmaže verzie, beh ostane (bez väzby)
  delete from ids_documents where code = 'CHAT-1';
  select count(*) into n from ids_runs where id in ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3') and ids_version_id is null;
  if n <> 2 then raise exception 'behy po zmazaní dokumentu: %', n; end if;
end $$;

-- Práva: anon a authenticated nové tabuľky nevidia
do $$
begin
  if has_table_privilege('anon', 'ids_documents', 'select') or has_table_privilege('authenticated', 'ids_document_versions', 'select') then
    raise exception 'anon/authenticated majú práva na IDS tabuľky';
  end if;
  if not has_table_privilege('service_role', 'ids_document_versions', 'insert') then
    raise exception 'service_role nemá právo na IDS verzie';
  end if;
end $$;

rollback;
