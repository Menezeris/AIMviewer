-- D-188: schéma platform v zdieľanej DB pre platformu Assetin (repo AIMforked, fork Archives).
-- APLIKOVANÉ na produkciu 4. 11. (Samuel "povoľujem stavbu", cez Supabase MCP apply_migration).
-- Fork má vlastnú DB rolu platform_app, vlastní len schémy platform a platform_pgboss a do AIM dát
-- (public, library) nevidí ani nezapisuje: tabuľky public majú RLS bez politík (D-079) a rola na ne
-- nedostane žiadny grant. USAGE na public dostane len kvôli typom a funkciám rozšírení.
-- Rola nemá heslo; nastaví sa mimo gitu až pri nasadení forku. connection limit 20 je tvrdý strop
-- pripojení forku (DB má max_connections 60, rozpočet v AIMforked PLATFORM.md §4).
-- CREATE na databázu: drizzle aj pg-boss volajú "create schema if not exists" a Postgres kontroluje
-- právo skôr než existenciu schémy; rola tak smie zakladať len vlastné nové schémy.
-- Rollback: drop schema platform_pgboss cascade; drop schema platform cascade;
--   drop text search configuration public.simple_unaccent; drop owned by platform_app; drop role platform_app;
--   (vector ostáva, nič v AIM ho nepoužíva)

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

-- Fulltext forku: dotazy používajú public.simple_unaccent (rovnaká definícia ako v migrácii
-- 0000_db_setup forku; jeho migrácie si do platform vytvoria vlastnú kópiu).
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
