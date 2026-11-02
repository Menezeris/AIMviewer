-- Port knižnice požiadaviek do TS, krok 1 (assetin-library V30, Q70; AIM D-186): read-only prehliadač knižnice.
-- APLIKOVANÉ na produkciu 2. 11. (Samuel "áno", orchestrátor).
--
-- Schéma `library` nie je vystavená v PostgREST (db_schema = public, graphql_public) a rolám anon / authenticated
-- do nej prístup nepatrí. Host (service_role, serverová API route) preto číta hlavu knižnice cez dve RPC v `public`:
--   library_hlava_zoznam(p_kniznica) = súbory hlavy bez textu (cesta, note_id, typ, rev, sha256, autor, ...),
--   library_hlava_subor(p_kniznica, p_cesta) = jeden súbor hlavy s textom.
-- Len čítanie (stable, security invoker), pevný search_path, EXECUTE len service_role (AGENTS.md D-026, D-059).
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
