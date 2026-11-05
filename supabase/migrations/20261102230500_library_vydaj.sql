-- Port of the requirements library to TS, step 6 (assetin-library V30, Q70; AIM D-186): library release from the editor in AIM.
-- APPLIED to production 2. 11. 2026 (orchestrator; function definitions verified by md5 against this file). The release in AIM is additionally behind the env gate
-- LIBRARY_RELEASE_ENABLED (off by default, switched on at Samuel's word; releaser role).
--
-- The `library` schema is not exposed in PostgREST; the host (service_role) calls two RPCs in `public`:
--   library_vydaj(...)          = library.vytvor_vydanie (head snapshot, sha256 check of every file = AS409)
--                                 and library.publikuj_ids (IDS into public.ids_documents) in ONE transaction,
--                                 like assetin/db/vydanie.py; AIM never sees an IDS without a release.
--   library_vydanie_export(...) = export zip path in Storage, written once after a successful upload.
-- Bucket `library-exports` (private) for the release export (Q64 a); the zip is uploaded only by the server (service_role).
-- EXECUTE only service_role; anon / authenticated none (D-026). service_role has EXECUTE on library.vytvor_vydanie
-- and library.publikuj_ids and UPDATE on library.vydanie (verified 2. 11.), hence security invoker.
-- Rollback: drop function of both; delete from storage.buckets where id = 'library-exports' (if empty).

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
