-- D-079 — Odobratie práv rolám anon/authenticated v schéme public
--
-- Živý príkazový kanál (Supabase Realtime Broadcast) potrebuje v prehliadači
-- anon (publishable) kľúč. RLS je vypnuté (D-025) a Supabase štandardne dáva
-- rolám anon/authenticated ALL na tabuľky v public — anon kľúč by tak umožnil
-- komukoľvek čítať aj zapisovať celú DB cez PostgREST. Appka číta výhradne cez
-- service_role (D-026), takže odobratie nič nerozbije; anon kľúču ostane len
-- Realtime broadcast na verejné kanály a čítanie verejných bucketov.
--
-- POVINNÉ PORADIE: táto migrácia na prod PRED nastavením
-- NEXT_PUBLIC_SUPABASE_ANON_KEY na Verceli.
--
-- Idempotentné (REVOKE/GRANT sa dá spustiť opakovane).

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- service_role (appka, D-026) a postgres (ETL, D-031) si práva ponechajú explicitne.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Budúce objekty vytvorené rolou postgres (migrácie, ETL) už anon/authenticated nedostanú.
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
