-- D-188: schema platform in the shared DB for the Assetin platform (repo AIMforked, fork of Archives).
-- APPLIED to production 4. 11. (Samuel "I authorize the build", via Supabase MCP apply_migration).
-- The fork has its own DB role platform_app, owns only the schemas platform and platform_pgboss and does not see or write
-- AIM data (public, library): public tables have RLS without policies (D-079) and the role gets
-- no grant on them. USAGE on public is granted only for extension types and functions.
-- The role has no password; it is set outside git at fork deployment. connection limit 20 is a hard cap
-- on fork connections (the DB has max_connections 60, budget in AIMforked PLATFORM.md section 4).
-- CREATE on the database: drizzle and pg-boss both call "create schema if not exists" and Postgres checks
-- the privilege before the existence of the schema; the role may thus create only its own new schemas.
-- Rollback: drop schema platform_pgboss cascade; drop schema platform cascade;
--   drop text search configuration public.simple_unaccent; drop owned by platform_app; drop role platform_app;
--   (vector stays, nothing in AIM uses it)

create extension if not exists vector with schema public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_app') then
    create role platform_app login noinherit connection limit 20;
  end if;
end $$;

alter role platform_app set search_path = platform, public;
grant platform_app to postgres;

create schema if not exists platform authorization platform_app;
create schema if not exists platform_pgboss authorization platform_app;
revoke all on schema platform, platform_pgboss from public, anon, authenticated;

grant usage on schema public to platform_app;

do $$
begin
  execute format('grant create on database %I to platform_app', current_database());
end $$;

-- Fork fulltext: queries use public.simple_unaccent (same definition as in the fork's migration
-- 0000_db_setup; its migrations create their own copy in platform).
do $$
begin
  create text search configuration public.simple_unaccent (copy = pg_catalog.simple);
  alter text search configuration public.simple_unaccent
    alter mapping for asciiword, asciihword, hword_asciipart, hword, hword_part, word
    with public.unaccent, simple;
exception
  when unique_violation then
    null;
end $$;
