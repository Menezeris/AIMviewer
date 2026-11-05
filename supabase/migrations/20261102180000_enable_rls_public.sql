-- Defense in depth (2. 11., Samuel "yes"): RLS enabled on all public tables.
-- anon and authenticated have had no grants on tables or views since 20261016120000; the host, ETL and engine
-- work via service_role / postgres, which have BYPASSRLS, so behavior does not change. No policies are added:
-- if someone returned a grant by mistake, RLS without a policy still lets nothing through. New tables: in the migration also
-- `alter table ... enable row level security` (rule in AGENTS.md).
-- Rollback: alter table <t> disable row level security; for each table below.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;
