-- Test pending migrácie 20261102230500_library_vydaj.sql (po aplikácii, v transakcii s rollback; nič neostane).
begin;
set local role service_role;
-- bez autora = 22023
do $$
begin
  perform public.library_vydaj('assetin', 'test-0', ' ', null, '1.5', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
  raise exception 'očakávaná chyba 22023';
exception when sqlstate '22023' then null;
end $$;
-- iná očakávaná verzia súboru = AS409, vydanie nevznikne
do $$
begin
  perform public.library_vydaj('assetin', 'test-1', 'test', null, '1.5', '{}'::jsonb,
    jsonb_build_object('KNIZNICA.md', repeat('0', 64)), '[]'::jsonb);
  raise exception 'očakávaný konflikt AS409';
exception when sqlstate 'AS409' then null;
end $$;
select count(*) = 0 as nevzniklo from library.vydanie where kod = 'test-1';
-- presná hlava a žiadne IDS: vydanie vznikne, katalóg IDS ostane bez zmeny (publikuj_ids sa nevolá)
do $$
declare
  v_ocak jsonb; v_out jsonb; v_pred integer; v_po integer;
begin
  select jsonb_object_agg(h.cesta, h.sha256) into v_ocak from library.hlava h where h.kniznica = 'assetin';
  select count(*) into v_pred from public.ids_documents where origin = 'library' and status = 'active';
  v_out := public.library_vydaj('assetin', 'test-2', 'test', null, '1.5', '{"E":0}'::jsonb, v_ocak, '[]'::jsonb);
  select count(*) into v_po from public.ids_documents where origin = 'library' and status = 'active';
  if v_out ->> 'vydanie_id' is null or v_out -> 'ids' <> '[]'::jsonb then raise exception 'zlý výstup %', v_out; end if;
  if v_pred <> v_po then raise exception 'vydanie bez IDS zmenilo katalóg (% -> %)', v_pred, v_po; end if;
  perform public.library_vydanie_export((v_out ->> 'vydanie_id')::uuid, 'assetin/test-2.zip');
  if (select export_cesta from library.vydanie where id = (v_out ->> 'vydanie_id')::uuid) <> 'assetin/test-2.zip' then
    raise exception 'export_cesta sa nezapísala';
  end if;
end $$;
rollback;
