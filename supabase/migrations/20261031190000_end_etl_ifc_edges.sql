-- D-183 K3 step 3 (Samuel 31. 10.: "end it"): ending the old graph ETL edges that the views already read
-- from the revision copy. The file is deliberately in `supabase/pending/`, not in `supabase/migrations/`: deployment does not run it.
-- When Samuel says yes, move it (git mv) to `supabase/migrations/` with the current time in the name and deploy.
--
-- What it does: edges of six types (rel_aggregates, rel_contained_in_spatial_structure, rel_defines_by_type,
-- rel_assigns_to_group, rel_associates_document, rel_associates_classification) with the file ETL source
-- (`etl`, `etl:<model>`, exactly per `rel_is_aim_layer`) get `valid_until = now()`. Nothing is deleted.
-- The views have not read them since migrations 20261031120000 and 20261031150000 and ETL has neither written nor
-- closed them since 20261031180000 (`etl/manifest.py`, `FROM_REVISION_COPY`), so without this step they stay "active" forever.
-- AIM layer edges (pdf_link, doc_upload, seed, derive:*) and the other ETL types (referenced, space_boundary,
-- actors, document tree and classification) do not change.
--
-- Counts in production 31. 10. (active, which the step ends):
--   rel_aggregates                      etl:ASR   122
--   rel_contained_in_spatial_structure  etl:ASR   766, etl:VZT  166
--   rel_defines_by_type                 etl:ASR   735, etl:VZT 1 075
--   rel_assigns_to_group                etl:ASR   391, etl:VZT 1 084
--   rel_associates_document             etl:ASR   248, etl:VZT    9
--   rel_associates_classification       etl:ASR   608
--   total 5 204 (ASR 2 870, VZT 2 334). Already ended ETL edges of these types: 1 747 (etl without model 1 542, etl:ASR
--   documents 178, etl:VZT 27); in total 6 951 inactive ETL rows of these types would remain in the table.
--
-- Why end rather than delete (recommendation): relationships is a time table (valid_from/valid_until, D-010, D-086),
-- the re-ETL history has never been deleted so far; ending is reversible (valid_until = null) and frees the partial unique
-- indexes "one active parent" (uniq_active_aggregate/contained/defines_by_type) that would otherwise block the AIM
-- layer edges of those types. Deleting (variant below) saves only ~7 000 small rows and is irreversible.
--
-- Reverse (restore the state before the step): update relationships set valid_until = null
--   where valid_until = '<run time>' and rel_type in (...) and not rel_is_aim_layer(source);

begin;

do $$
declare n int; expected int := 5204;
begin
  update relationships set valid_until = now()
  where valid_until is null
    and not rel_is_aim_layer(source)
    and rel_type in ('rel_aggregates', 'rel_contained_in_spatial_structure', 'rel_defines_by_type',
                     'rel_assigns_to_group', 'rel_associates_document', 'rel_associates_classification');
  get diagnostics n = row_count;
  raise notice 'D-183 K3 krok 3: ukončených hrán ETL %, očakávané % (31. 10.; iný počet = medzitým re-ETL/nový prvok, skontrolovať)', n, expected;
end $$;

commit;

-- Variant DELETE (only if Samuel explicitly says delete, instead of the block above):
--   delete from relationships
--   where not rel_is_aim_layer(source)
--     and rel_type in ('rel_aggregates', 'rel_contained_in_spatial_structure', 'rel_defines_by_type',
--                      'rel_assigns_to_group', 'rel_associates_document', 'rel_associates_classification');
--   -- 6 951 rows (5 204 active + 1 747 ended) as of 31. 10.
