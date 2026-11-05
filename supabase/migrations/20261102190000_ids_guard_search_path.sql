-- IDS catalog triggers have their own search_path (Samuel 2. 11. "yes"). APPLIED to production 2. 11.
-- Reason: library.publikuj_ids (assetin-library V29) runs with search_path = "" and guard functions with unqualified
-- table names then failed with 42P01. Behavior does not change for other calls.
-- Rollback: alter function ... reset search_path;
alter function public.ids_document_versions_guard() set search_path = public;
alter function public.ids_documents_origin_guard() set search_path = public;
