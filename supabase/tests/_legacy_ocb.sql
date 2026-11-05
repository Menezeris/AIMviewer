-- Test helper (D-189 cleanup), included with \ir right after "begin;" by the SQL tests written before
-- multi-project. Those tests insert rows without project_id, model revisions without container_id and
-- the revision copy without model_revision_id. The cleanup migration removed the defaults and triggers
-- that filled them; writers in the app and the ETL name all three themselves.
--
-- For the including test only (everything is rolled back with it), this puts back:
--   * OCB as the default project_id;
--   * container_id of a model revision from (project_id, model);
--   * model_revision_id of the revision copy from (model, revision).
-- Production has none of this. supabase/tests/multi_project.sql does not include it and checks that a
-- missing project or id is rejected.

do $$
declare t text;
begin
  foreach t in array array[
    'objects', 'information_containers', 'model_revisions', 'model_tasks', 'saved_views', 'clash_tests',
    'clash_runs', 'ids_documents', 'ids_runs', 'derivation_runs', 'verification_runs', 'icdd_imports',
    'drawing_link_overrides', 'ifc_guid_aliases'
  ] loop
    execute format('alter table public.%I alter column project_id set default %L', t,
                   '9e2dfcba-437b-43d3-a925-0dd29f195b38');
  end loop;
end $$;

create function public.test_legacy_container() returns trigger language plpgsql as $$
begin
  if new.container_id is null then
    new.container_id := container_for_model(new.project_id, new.model);
  end if;
  return new;
end $$;
-- "trg_a..." fires before trg_model_revisions_container, which checks the id.
create trigger trg_a_test_legacy_container before insert on public.model_revisions
  for each row execute function public.test_legacy_container();

create function public.test_legacy_model_revision() returns trigger language plpgsql as $$
begin
  if new.model_revision_id is null then
    select id into strict new.model_revision_id from model_revisions
     where model = new.model and revision = new.revision;
  end if;
  return new;
end $$;
create trigger trg_a_test_legacy_model_revision before insert on public.ifc_rev_imports
  for each row execute function public.test_legacy_model_revision();
create trigger trg_a_test_legacy_model_revision before insert on public.ifc_rev_objects
  for each row execute function public.test_legacy_model_revision();
create trigger trg_a_test_legacy_model_revision before insert on public.ifc_rev_property_sets
  for each row execute function public.test_legacy_model_revision();
create trigger trg_a_test_legacy_model_revision before insert on public.ifc_rev_relationships
  for each row execute function public.test_legacy_model_revision();
