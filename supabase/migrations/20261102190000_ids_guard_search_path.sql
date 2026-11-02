-- Triggery katalógu IDS majú vlastný search_path (Samuel 2. 11. "áno"). APLIKOVANÉ na produkciu 2. 11.
-- Dôvod: library.publikuj_ids (assetin-library V29) beží so search_path = "" a strážne funkcie s nekvalifikovanými
-- menami tabuliek vtedy padli na 42P01. Pre ostatné volania sa správanie nemení.
-- Rollback: alter function ... reset search_path;
alter function public.ids_document_versions_guard() set search_path = public;
alter function public.ids_documents_origin_guard() set search_path = public;
