-- Port knižnice požiadaviek do TS, krok 3 (assetin-library V30, Q70; AIM D-186): zápis z editora v AIM.
-- NESPUSTENÉ (pending): aplikuje orchestrátor po schválení. Zápis v AIM je navyše za env bránou
-- LIBRARY_WRITE_ENABLED (predvolene vypnutá, zapína sa na Samuelovo slovo).
--
-- Schéma `library` nie je v PostgREST vystavená; host (service_role) volá dve RPC v `public`:
--   library_texty(p_kniznica)  = hlava knižnice s textom (celá knižnica pre loader pri uložení),
--   library_zapis(...)         = library.zapis_revizie (všetko alebo nič, kontrola sha256 = AS409 konflikt)
--                                a v tej istej transakcii prepočítaná projekcia zapísaných súborov
--                                (`library.projekcia`, odvodené; počíta TS engine, ako sklad_db._uloz_projekciu).
-- EXECUTE len service_role; anon / authenticated nič (D-026). Rollback: drop function oboch.

create or replace function public.library_texty(p_kniznica text)
returns table (cesta text, note_id text, typ text, rev integer, sha256 text, text text)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.text
  from library.hlava h
  where h.kniznica = p_kniznica
  order by h.cesta
$$;

create or replace function public.library_zapis(
  p_kniznica text,
  p_autor text,
  p_sprava text,
  p_zdroj text,
  p_schema_verzia text,
  p_zapisy jsonb,
  p_projekcie jsonb,
  p_engine text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_out jsonb;
  v_z   jsonb;
  v_p   jsonb;
  v_i   integer := 0;
begin
  if coalesce(trim(p_autor), '') = '' then
    raise exception 'zápis do knižnice potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_projekcie) <> 'array' or jsonb_array_length(p_projekcie) <> jsonb_array_length(p_zapisy) then
    raise exception 'p_projekcie: jedna projekcia na každý zápis' using errcode = '22023';
  end if;
  v_out := library.zapis_revizie(p_kniznica, trim(p_autor), p_sprava, p_zdroj, p_schema_verzia, p_zapisy);
  for v_z in select * from jsonb_array_elements(v_out) loop
    v_p := p_projekcie -> v_i;
    insert into library.projekcia (subor_id, rev, frontmatter, data, odkazy, diagnostiky, engine)
      select s.id, (v_z ->> 'rev')::integer, v_p -> 'frontmatter', v_p -> 'data',
             coalesce(v_p -> 'odkazy', '[]'::jsonb), coalesce(v_p -> 'diagnostiky', '[]'::jsonb), p_engine
      from library.subor s join library.kniznica k on k.id = s.kniznica_id
      where k.kod = p_kniznica and s.cesta = v_z ->> 'cesta'
    on conflict (subor_id) do update set
      rev = excluded.rev, frontmatter = excluded.frontmatter, data = excluded.data,
      odkazy = excluded.odkazy, diagnostiky = excluded.diagnostiky, engine = excluded.engine,
      vypocitana = now();
    v_i := v_i + 1;
  end loop;
  return v_out;
end
$$;

revoke all on function public.library_texty(text) from public, anon, authenticated;
revoke all on function public.library_zapis(text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.library_texty(text) to service_role;
grant execute on function public.library_zapis(text, text, text, text, text, jsonb, jsonb, text) to service_role;
