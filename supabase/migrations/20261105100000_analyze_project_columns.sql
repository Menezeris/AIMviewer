-- D-189 follow-up: planner statistics for the project columns of 20261104233000_multi_project.sql.
--
-- The multi-project migration added objects.project_id with a constant DEFAULT (a catalog-only change)
-- and updated only 58 rows of objects, below the autovacuum threshold. So objects had no statistics for
-- project_id, and ifc_guid_aliases had none at all. With project_id = <OCB> the planner then expected
-- about 0.5 % of the rows instead of all of them and joined the CTEs of rel_contained_in_spatial_structure
-- in nested loops: the app's queries (#417) took 37 s on a restore of production and timed out (57014)
-- in production. After ANALYZE the same queries take 0.1 s.
--
-- ANALYZE changes only planner statistics, no data and no schema. It may run inside a transaction.
-- Rollback: none needed.

analyze public.objects;
analyze public.relationships;
analyze public.ifc_guid_history;
analyze public.ifc_guid_aliases;
analyze public.information_containers;
analyze public.model_revisions;
analyze public.container_revisions;
analyze public.ifc_rev_imports;
analyze public.ifc_rev_objects;
analyze public.ifc_rev_property_sets;
analyze public.ifc_rev_relationships;
analyze public.model_tasks;
analyze public.saved_views;
analyze public.clash_tests;
analyze public.clash_runs;
analyze public.ids_documents;
analyze public.ids_runs;
analyze public.derivation_runs;
analyze public.verification_runs;
analyze public.icdd_imports;
analyze public.drawing_link_overrides;
analyze public.mcp_call_log;
