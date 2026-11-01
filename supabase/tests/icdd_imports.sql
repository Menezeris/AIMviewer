-- D-181: icdd_imports a icdd_apply_import (pripravená migrácia supabase/pending/20261101140000_icdd_imports.sql).
-- Spustenie na lokálnej DB s aplikovanými migráciami a pripravenou migráciou (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/pending/20261101140000_icdd_imports.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/icdd_imports.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

-- uzly: prvok, dokument, druhý dokument
insert into objects (id, object_type, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'asset', 'VV.01.01.001'),
  ('00000000-0000-4000-8000-0000000000d1', 'document', 'D.1.1.09'),
  ('00000000-0000-4000-8000-0000000000d2', 'document', 'D.1.1.10');
insert into documents (id, storage_type) values
  ('00000000-0000-4000-8000-0000000000d1', 'unresolved'),
  ('00000000-0000-4000-8000-0000000000d2', 'unresolved');
-- živá väzba AIM vrstvy, ktorú cudzí nástroj zmení (d1 -> d2), a väzba zo súboru (etl), ktorú import nesmie uzavrieť
insert into relationships (id, rel_type, from_id, to_id, role, source) values
  ('00000000-0000-4000-8000-0000000000e1', 'rel_associates_document', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'document', 'pdf_link (E4)'),
  ('00000000-0000-4000-8000-0000000000e2', 'rel_associates_document', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'document', 'etl:ASR');

insert into icdd_imports (id, version_id, container_sha256, file_name, same_as_aim, payloads, counts, aim_state_sha256, changes)
values ('00000000-0000-4000-8000-0000000000f1', '2026-11-01_ASR-v079_VZT-v011_D44', repeat('a', 64), 'AIM_x.icdd', true,
        '{"ASR_v079.ifc": "aa"}', '{"add": 1, "close": 1}', repeat('c', 64), '[]');

do $$
declare
  r icdd_imports;
begin
  -- stĺpcové kontroly
  begin
    insert into icdd_imports (version_id, container_sha256, aim_state_sha256) values ('v', 'xyz', repeat('c', 64));
    raise exception 'FAIL: sha256 bez kontroly';
  exception when check_violation then null;
  end;
  begin
    insert into icdd_imports (version_id, container_sha256, aim_state_sha256) values ('v', repeat('b', 64), 'nie');
    raise exception 'FAIL: aim_state_sha256 bez kontroly';
  exception when check_violation then null;
  end;
  begin
    insert into icdd_imports (version_id, container_sha256, aim_state_sha256, status) values ('v', repeat('b', 64), repeat('c', 64), 'applied');
    raise exception 'FAIL: applied bez applied_at';
  exception when check_violation then null;
  end;
  begin
    insert into icdd_imports (version_id, container_sha256, aim_state_sha256, status) values ('v', repeat('b', 64), repeat('c', 64), 'done');
    raise exception 'FAIL: neznámy status';
  exception when check_violation then null;
  end;
  begin
    insert into icdd_imports (version_id, container_sha256, aim_state_sha256, findings) values ('v', repeat('b', 64), repeat('c', 64), '{}');
    raise exception 'FAIL: findings nie je pole';
  exception when check_violation then null;
  end;
  if has_table_privilege('anon', 'icdd_imports', 'select') then raise exception 'FAIL: anon číta icdd_imports'; end if;
  if has_function_privilege('anon', 'icdd_apply_import(uuid, text, jsonb)', 'execute') then raise exception 'FAIL: anon spustí icdd_apply_import'; end if;

  -- brána: iný stav AIM
  begin
    perform icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('d', 64), '[]');
    raise exception 'FAIL: zápis pri inom stave AIM';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- neznáma operácia
  begin
    perform icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('c', 64), '[{"op": "delete", "id": "00000000-0000-4000-8000-0000000000e1"}]');
    raise exception 'FAIL: neznáma operácia prešla';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- väzbu zo súboru IFC (etl) import neuzavrie; celá transakcia sa vráti
  begin
    perform icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('c', 64),
      '[{"op": "close", "id": "00000000-0000-4000-8000-0000000000e2"}]');
    raise exception 'FAIL: uzavretá väzba zo súboru';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select valid_until from relationships where id = '00000000-0000-4000-8000-0000000000e2') is not null then raise exception 'FAIL: etl väzba uzavretá'; end if;
  -- duplicitná živá väzba sa nevloží
  begin
    perform icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('c', 64),
      '[{"op": "add", "from_id": "00000000-0000-4000-8000-0000000000a1", "to_id": "00000000-0000-4000-8000-0000000000d1"}]');
    raise exception 'FAIL: duplicitná väzba vložená';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- zmena väzby: uzavrieť e1, vložiť a1 -> d2
  r := icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('c', 64),
    '[{"op": "close", "id": "00000000-0000-4000-8000-0000000000e1"},
      {"op": "add", "from_id": "00000000-0000-4000-8000-0000000000a1", "to_id": "00000000-0000-4000-8000-0000000000d2"}]');
  if r.status <> 'applied' or r.applied_at is null then raise exception 'FAIL: stav po zápise %', r.status; end if;
  if r.closed_ids <> array['00000000-0000-4000-8000-0000000000e1'::uuid] then raise exception 'FAIL: closed_ids %', r.closed_ids; end if;
  if cardinality(r.written_ids) <> 1 then raise exception 'FAIL: written_ids %', r.written_ids; end if;
  if (select valid_until from relationships where id = '00000000-0000-4000-8000-0000000000e1') is null then raise exception 'FAIL: e1 neuzavretá'; end if;
  if (select source from relationships where id = r.written_ids[1]) <> 'icdd:2026-11-01_ASR-v079_VZT-v011_D44' then raise exception 'FAIL: source'; end if;
  if (select to_id from relationships where id = r.written_ids[1]) <> '00000000-0000-4000-8000-0000000000d2' then raise exception 'FAIL: to_id'; end if;
  -- druhý zápis toho istého importu nejde
  begin
    perform icdd_apply_import('00000000-0000-4000-8000-0000000000f1', repeat('c', 64), '[]');
    raise exception 'FAIL: druhý zápis';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- importovaná väzba je AIM vrstva (pohľad rel_associates_document ju vidí)
  if not exists (select 1 from rel_associates_document where id = r.written_ids[1]) then raise exception 'FAIL: väzba nie je v pohľade'; end if;
end $$;

rollback;
