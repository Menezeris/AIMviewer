-- Test of migration 20261102200000_library_hlava_read.sql (run after applying, in a transaction with rollback).
begin;
-- service_role reads the list and the file
set local role service_role;
select count(*) > 0 as ma_subory from public.library_head_list('assetin');
select cesta, length(text) > 0 as ma_text from public.library_head_file('assetin', 'KNIZNICA.md');
reset role;
-- anon and authenticated must not
select has_function_privilege('anon', 'public.library_head_list(text)', 'execute') = false as anon_bez_prava,
       has_function_privilege('authenticated', 'public.library_head_file(text, text)', 'execute') = false as auth_bez_prava;
rollback;
