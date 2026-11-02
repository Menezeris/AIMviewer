-- Test migrácie 20261102210000_library_zapis.sql (po aplikácii, v transakcii s rollback; nič neostane).
begin;
set local role service_role;
-- texty: celá hlava
select count(*) > 0 as ma_texty from public.library_texty('assetin');
-- zápis so zlou očakávanou verziou = AS409, nič sa nezapíše
do $$
begin
  perform public.library_zapis('assetin', 'test', null, 'editor', '1.5',
    jsonb_build_array(jsonb_build_object('cesta', 'KNIZNICA.md', 'text', 'x', 'ocakavana', repeat('0', 64))),
    jsonb_build_array(jsonb_build_object('frontmatter', null, 'data', null, 'odkazy', '[]'::jsonb, 'diagnostiky', '[]'::jsonb)),
    'test');
  raise exception 'očakávaný konflikt AS409';
exception when sqlstate 'AS409' then null;
end $$;
reset role;
select has_function_privilege('anon', 'public.library_zapis(text,text,text,text,text,jsonb,jsonb,text)', 'execute') = false as anon_bez_prava;
rollback;
