-- Port knižnice požiadaviek do TS, krok 6 (assetin-library V30, Q70; AIM D-186): vydanie knižnice z editora v AIM.
-- APLIKOVANÉ na produkciu 2. 11. 2026 (orchestrátor; definície funkcií overené md5 voči tomuto súboru). Vydanie v AIM je navyše za env bránou
-- LIBRARY_RELEASE_ENABLED (predvolene vypnutá, zapína sa na Samuelovo slovo; rola vydavateľa).
--
-- Schéma `library` nie je v PostgREST vystavená; host (service_role) volá dve RPC v `public`:
--   library_vydaj(...)          = library.vytvor_vydanie (snímka hlavy, kontrola sha256 každého súboru = AS409)
--                                 a library.publikuj_ids (IDS do public.ids_documents) v JEDNEJ transakcii,
--                                 ako assetin/db/vydanie.py; AIM nikdy neuvidí IDS bez vydania.
--   library_vydanie_export(...) = cesta zipu exportu v Storage, zapísaná raz po úspešnom nahratí.
-- Bucket `library-exports` (súkromný) pre export vydania (Q64 a); zip nahráva len server (service_role).
-- EXECUTE len service_role; anon / authenticated nič (D-026). service_role má EXECUTE na library.vytvor_vydanie
-- a library.publikuj_ids a UPDATE na library.vydanie (overené 2. 11.), preto security invoker.
-- Rollback: drop function oboch; delete from storage.buckets where id = 'library-exports' (ak je prázdny).

create or replace function public.library_vydaj(
  p_kniznica text,
  p_kod text,
  p_autor text,
  p_sprava text,
  p_schema_verzia text,
  p_diagnostiky jsonb,
  p_ocakavane jsonb,
  p_polozky jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
  v_ids jsonb := '[]'::jsonb;
begin
  if coalesce(trim(p_autor), '') = '' then
    raise exception 'vydanie potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_polozky) <> 'array' then
    raise exception 'p_polozky: zoznam IDS' using errcode = '22023';
  end if;
  v_id := library.vytvor_vydanie(p_kniznica, p_kod, trim(p_autor), p_sprava, p_schema_verzia, p_diagnostiky, p_ocakavane);
  if jsonb_array_length(p_polozky) > 0 then
    v_ids := library.publikuj_ids(v_id, p_polozky);
  end if;
  return jsonb_build_object('vydanie_id', v_id, 'ids', v_ids);
end
$$;

create or replace function public.library_vydanie_export(p_vydanie uuid, p_cesta text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update library.vydanie set export_cesta = p_cesta where id = p_vydanie and export_cesta is null
$$;

insert into storage.buckets (id, name, public)
values ('library-exports', 'library-exports', false)
on conflict (id) do nothing;

revoke all on function public.library_vydaj(text, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.library_vydanie_export(uuid, text) from public, anon, authenticated;
grant execute on function public.library_vydaj(text, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.library_vydanie_export(uuid, text) to service_role;
