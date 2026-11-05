-- D-079 - Revoking privileges from the anon/authenticated roles in the public schema
--
-- The live command channel (Supabase Realtime Broadcast) needs the anon
-- (publishable) key in the browser. RLS is off (D-025) and Supabase by default gives the
-- anon/authenticated roles ALL on tables in public - the anon key would thus allow
-- anyone to read and write the whole DB via PostgREST. The app reads exclusively via
-- service_role (D-026), so the revoke breaks nothing; the anon key keeps only
-- Realtime broadcast on public channels and reading of public buckets.
--
-- REQUIRED ORDER: this migration on prod BEFORE setting
-- NEXT_PUBLIC_SUPABASE_ANON_KEY on Vercel.
--
-- Idempotent (REVOKE/GRANT can be run repeatedly).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- service_role (the app, D-026) and postgres (ETL, D-031) keep their privileges explicitly.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Future objects created by the postgres role (migrations, ETL) will no longer get anon/authenticated.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
