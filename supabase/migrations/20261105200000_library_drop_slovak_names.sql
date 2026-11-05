-- D-194 phase 4b, step 3 of 3 (D-189 pattern): drop the old Slovak library RPC functions. Their English twins were added by
-- 20261105190000_library_english_names.sql (applied 5 Nov) and the app has called only the new names since PR #465.
--
-- NOT APPLIED. Needs Samuel's explicit yes (relayed under D-193). No data change (functions only), so no data backup is needed.
--
-- Pre-check (read-only), all must hold before applying:
--   1. the seven new functions exist (public.library_head_list, library_head_file, library_texts, library_write, library_release,
--      library_release_export; library.publish_ids);
--   2. no other function body, view or trigger references the old names (checked on production 5 Nov: none);
--   3. the app version that calls the new names is deployed (PR #465 live).
-- Post-check: none of the seven old names exists; the seven new ones still exist; supabase/tests/library_english_names.sql passes.
-- Rollback: recreate the old functions from the migrations 20261102200000_library_hlava_read.sql, 20261102210000_library_zapis.sql,
--   20261102230500_library_vydaj.sql, 20261105115915_library_release_project.sql and the library.publikuj_ids definition in
--   20261105120000_multi_project_cleanup.sql, or re-run their `create or replace function` blocks (grants: EXECUTE only service_role).

drop function public.library_hlava_zoznam(text);
drop function public.library_hlava_subor(text, text);
drop function public.library_texty(text);
drop function public.library_zapis(text, text, text, text, text, jsonb, jsonb, text);
drop function public.library_vydaj(text, text, text, text, text, jsonb, jsonb, jsonb, uuid);
drop function public.library_vydanie_export(uuid, text);
drop function library.publikuj_ids(uuid, jsonb, uuid);
