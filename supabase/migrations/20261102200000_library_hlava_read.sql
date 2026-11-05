-- Port of the requirements library to TS, step 1 (assetin-library V30, Q70; AIM D-186): read-only library browser.
-- APPLIED to production 2. 11. (Samuel "yes", orchestrator).
--
-- The `library` schema is not exposed in PostgREST (db_schema = public, graphql_public) and the anon / authenticated roles
-- have no access to it. The host (service_role, server API route) therefore reads the library head through two RPCs in `public`:
--   library_hlava_zoznam(p_kniznica) = head files without text (path, note_id, type, rev, sha256, author, ...),
--   library_hlava_subor(p_kniznica, p_cesta) = one head file with text.
-- Read only (stable, security invoker), fixed search_path, EXECUTE only service_role (AGENTS.md D-026, D-059).
-- Rollback: drop function public.library_hlava_zoznam(text); drop function public.library_hlava_subor(text, text);

create or replace function public.library_hlava_zoznam(p_kniznica text default null)
returns table (
  kniznica text,
  cesta text,
  note_id text,
  typ text,
  rev integer,
  sha256 text,
  autor text,
  vytvorena timestamptz,
  zdroj text,
  dlzka integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.kniznica, h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.autor, h.vytvorena, h.zdroj, length(h.text)
  from library.hlava h
  where p_kniznica is null or h.kniznica = p_kniznica
  order by h.kniznica, h.cesta
$$;

create or replace function public.library_hlava_subor(p_kniznica text, p_cesta text)
returns table (
  kniznica text,
  cesta text,
  note_id text,
  typ text,
  rev integer,
  sha256 text,
  autor text,
  vytvorena timestamptz,
  zdroj text,
  text text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.kniznica, h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.autor, h.vytvorena, h.zdroj, h.text
  from library.hlava h
  where h.kniznica = p_kniznica and h.cesta = p_cesta
$$;

revoke all on function public.library_hlava_zoznam(text) from public, anon, authenticated;
revoke all on function public.library_hlava_subor(text, text) from public, anon, authenticated;
grant execute on function public.library_hlava_zoznam(text) to service_role;
grant execute on function public.library_hlava_subor(text, text) to service_role;
