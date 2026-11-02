-- Test migrácie 20261102200000_library_hlava_read.sql (spustiť po aplikácii, v transakcii s rollback).
begin;
-- service_role číta zoznam aj súbor
set local role service_role;
select count(*) > 0 as ma_subory from public.library_hlava_zoznam('assetin');
select cesta, length(text) > 0 as ma_text from public.library_hlava_subor('assetin', 'KNIZNICA.md');
reset role;
-- anon a authenticated nesmú
select has_function_privilege('anon', 'public.library_hlava_zoznam(text)', 'execute') = false as anon_bez_prava,
       has_function_privilege('authenticated', 'public.library_hlava_subor(text, text)', 'execute') = false as auth_bez_prava;
rollback;
