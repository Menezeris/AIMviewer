-- Test of migration 20261102210000_library_zapis.sql (after applying, in a transaction with rollback; nothing remains).
begin;
\ir _legacy_ocb.sql
set local role service_role;
-- texts: the whole head
select count(*) > 0 as ma_texty from public.library_texts('assetin');
-- write with a wrong expected version = AS409, nothing is written
do $$
begin
  perform public.library_write('assetin', 'test', null, 'editor', '1.5',
    jsonb_build_array(jsonb_build_object('cesta', 'KNIZNICA.md', 'text', 'x', 'ocakavana', repeat('0', 64))),
    jsonb_build_object('KNIZNICA.md', jsonb_build_object('frontmatter', null, 'data', null, 'odkazy', '[]'::jsonb, 'diagnostiky', '[]'::jsonb)),
    'test');
  raise exception 'očakávaný konflikt AS409';
exception when sqlstate 'AS409' then null;
end $$;
-- missing projection for the written file = 22023, nothing is written
do $$
begin
  perform public.library_write('assetin', 'test', null, 'editor', '1.5',
    jsonb_build_array(jsonb_build_object('cesta', 'KNIZNICA.md', 'text', 'x', 'ocakavana', repeat('0', 64))),
    jsonb_build_object('ina/cesta.md', '{}'::jsonb), 'test');
  raise exception 'očakávaná chyba 22023';
exception when sqlstate '22023' then null;
end $$;
-- two files in one write: the projection of each belongs to its path (output order does not matter)
do $$
declare
  a text; b text; ta text; tb text; v jsonb;
begin
  select h.cesta into a from library.hlava h where h.kniznica = 'assetin' order by h.cesta limit 1;
  select h.sha256 into ta from library.hlava h where h.kniznica = 'assetin' and h.cesta = a;
  select h.cesta into b from library.hlava h where h.kniznica = 'assetin' order by h.cesta desc limit 1;
  select h.sha256 into tb from library.hlava h where h.kniznica = 'assetin' and h.cesta = b;
  v := public.library_write('assetin', 'test', null, 'editor', '1.5',
    jsonb_build_array(
      jsonb_build_object('cesta', b, 'text', (select text from library.hlava where kniznica = 'assetin' and cesta = b), 'ocakavana', tb),
      jsonb_build_object('cesta', a, 'text', (select text from library.hlava where kniznica = 'assetin' and cesta = a), 'ocakavana', ta)),
    jsonb_build_object(a, jsonb_build_object('odkazy', '[]'::jsonb, 'diagnostiky', '[]'::jsonb, 'data', jsonb_build_object('znacka', 'A')),
                       b, jsonb_build_object('odkazy', '[]'::jsonb, 'diagnostiky', '[]'::jsonb, 'data', jsonb_build_object('znacka', 'B'))),
    'test');
  if (select p.data ->> 'znacka' from library.projekcia p join library.subor s on s.id = p.subor_id where s.cesta = a) <> 'A'
     or (select p.data ->> 'znacka' from library.projekcia p join library.subor s on s.id = p.subor_id where s.cesta = b) <> 'B' then
    raise exception 'projekcia nepatrí svojej ceste';
  end if;
end $$;
reset role;
select has_function_privilege('anon', 'public.library_write(text,text,text,text,text,jsonb,jsonb,text)', 'execute') = false as anon_bez_prava;
rollback;
