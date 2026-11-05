-- Test of migration 20261105190000_library_english_names.sql (applied 5 Nov; run in a transaction with rollback).
-- After 20261105200000_library_drop_slovak_names.sql the old names are gone; the twins carry the behaviour.
begin;
set local role service_role;
select count(*) > 0 as list_has_files from public.library_head_list('assetin');
select count(*) > 0 as texts_has_files from public.library_texts('assetin');
select cesta, length(text) > 0 as has_text from public.library_head_file('assetin', 'KNIZNICA.md');
reset role;
-- Privileges: only service_role.
select has_function_privilege('anon', 'public.library_head_list(text)', 'execute') = false as anon_no_list,
       has_function_privilege('authenticated', 'public.library_write(text, text, text, text, text, jsonb, jsonb, text)', 'execute') = false as auth_no_write,
       has_function_privilege('service_role', 'library.publish_ids(uuid, jsonb, uuid)', 'execute') as service_publish;
-- After the cleanup migration: no old Slovak library RPC function is left.
select count(*) = 0 as old_names_gone from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('library_hlava_zoznam', 'library_hlava_subor', 'library_texty', 'library_zapis', 'library_vydaj', 'library_vydanie_export')
     or (n.nspname = 'library' and p.proname = 'publikuj_ids');
rollback;
