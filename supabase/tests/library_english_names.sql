-- Test of migration 20261105190000_library_english_names.sql (run after applying, in a transaction with rollback).
begin;
-- Twins give the same rows as the old functions.
set local role service_role;
select (select count(*) from public.library_head_list('assetin')) = (select count(*) from public.library_hlava_zoznam('assetin')) as list_same;
select (select count(*) from public.library_texts('assetin')) = (select count(*) from public.library_texty('assetin')) as texts_same;
reset role;
-- Privileges: only service_role.
select has_function_privilege('anon', 'public.library_head_list(text)', 'execute') = false as anon_no_list,
       has_function_privilege('authenticated', 'public.library_write(text, text, text, text, text, jsonb, jsonb, text)', 'execute') = false as auth_no_write,
       has_function_privilege('service_role', 'library.publish_ids(uuid, jsonb, uuid)', 'execute') as service_publish;
rollback;
