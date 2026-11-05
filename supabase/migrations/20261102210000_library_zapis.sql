-- Port of the requirements library to TS, step 3 (assetin-library V30, Q70; AIM D-186): write from the editor in AIM.
-- APPLIED to production 2. 11. 2026 (orchestrator, version with p_projekcie as an object). The write in AIM is additionally behind the env gate
-- LIBRARY_WRITE_ENABLED (off by default, switched on at Samuel's word).
--
-- The `library` schema is not exposed in PostgREST; the host (service_role) calls two RPCs in `public`:
--   library_texty(p_kniznica)  = library head with text (the whole library for the loader on save),
--   library_zapis(...)         = library.zapis_revizie (all or nothing, sha256 check = AS409 conflict)
--                                and in the same transaction the recomputed projection of the written files
--                                (`library.projekcia`, derived; computed by the TS engine, like sklad_db._uloz_projekciu).
-- EXECUTE only service_role; anon / authenticated none (D-026). Rollback: drop function of both.

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
begin
  if coalesce(trim(p_autor), '') = '' then
    raise exception 'zápis do knižnice potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  -- projekcie sú objekt {cieľová cesta: projekcia}: párujú sa podľa cesty, nie podľa poradia výstupu
  if jsonb_typeof(p_projekcie) <> 'object' then
    raise exception 'p_projekcie: objekt {cesta: projekcia}' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_zapisy) z
    where not (p_projekcie ? coalesce(z ->> 'nova_cesta', z ->> 'cesta'))
  ) then
    raise exception 'p_projekcie: chýba projekcia pre zapisovaný súbor' using errcode = '22023';
  end if;
  v_out := library.zapis_revizie(p_kniznica, trim(p_autor), p_sprava, p_zdroj, p_schema_verzia, p_zapisy);
  for v_z in select * from jsonb_array_elements(v_out) loop
    v_p := p_projekcie -> (v_z ->> 'cesta');
    insert into library.projekcia (subor_id, rev, frontmatter, data, odkazy, diagnostiky, engine)
      select s.id, (v_z ->> 'rev')::integer, v_p -> 'frontmatter', v_p -> 'data',
             coalesce(v_p -> 'odkazy', '[]'::jsonb), coalesce(v_p -> 'diagnostiky', '[]'::jsonb), p_engine
      from library.subor s join library.kniznica k on k.id = s.kniznica_id
      where k.kod = p_kniznica and s.cesta = v_z ->> 'cesta'
    on conflict (subor_id) do update set
      rev = excluded.rev, frontmatter = excluded.frontmatter, data = excluded.data,
      odkazy = excluded.odkazy, diagnostiky = excluded.diagnostiky, engine = excluded.engine,
      vypocitana = now();
  end loop;
  return v_out;
end
$$;

revoke all on function public.library_texty(text) from public, anon, authenticated;
revoke all on function public.library_zapis(text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.library_texty(text) to service_role;
grant execute on function public.library_zapis(text, text, text, text, text, jsonb, jsonb, text) to service_role;
