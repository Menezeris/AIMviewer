-- D-189: library release into the catalog of one project, added next to the old signatures.
--
-- library_vydaj(..., p_project) and library.publikuj_ids(..., p_project) write the IDS of a release into the
-- catalog of that project. The old 8-argument library_vydaj and 2-argument publikuj_ids stay until the
-- cleanup migration 20261105120000 drops them, so the deployed app (old call) and the new app (call with
-- p_project) both work while the cleanup PR is merged and deployed (LIBRARY_RELEASE_ENABLED is on).
-- PostgREST picks the function by the named arguments of the call.
--
-- Additive: no existing object changes. Rollback: drop function public.library_vydaj(text, text, text, text,
-- text, jsonb, jsonb, jsonb, uuid); drop function library.publikuj_ids(uuid, jsonb, uuid).

set lock_timeout = '10s';

-- Also created by the cleanup migration (create or replace, same body).
create or replace function public.project_required(p_project uuid, p_caller text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_project is null then
    raise exception '%: p_project is required (D-189)', p_caller;
  end if;
  return p_project;
end $$;

-- same library can be released into several projects.
create function library.publikuj_ids(p_vydanie uuid, p_polozky jsonb, p_project uuid)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
    v_vyd     library.vydanie%rowtype;
    v_kod     text;
    v_zdroj   text;
    v_commit  text;
    v_p       jsonb;
    v_doc     public.ids_documents%rowtype;
    v_sha     text;
    v_posl    record;
    v_verzia  integer;
    v_zmena   text;
    v_kody    text[] := '{}';
    v_out     jsonb := '[]'::jsonb;
begin
    perform public.project_required(p_project, 'publikuj_ids');
    select * into v_vyd from library.vydanie where id = p_vydanie;
    if not found then
        raise exception 'release % does not exist', p_vydanie using errcode = 'AS404';
    end if;
    if exists (select 1 from library.vydanie_ids where vydanie_id = p_vydanie) then
        raise exception 'release % is already published', p_vydanie using errcode = 'AS409';
    end if;
    select kod into v_kod from library.kniznica where id = v_vyd.kniznica_id;
    v_zdroj := 'db:library/' || v_kod;
    v_commit := v_vyd.kod || '@' || encode(v_vyd.manifest_sha256, 'hex');

    for v_p in select * from jsonb_array_elements(p_polozky) loop
        if coalesce(v_p ->> 'code', '') = '' or coalesce(v_p ->> 'xml', '') = '' then
            raise exception 'each IDS needs a code and an XML' using errcode = '22023';
        end if;
        v_kody := v_kody || (v_p ->> 'code');
        v_sha := encode(sha256(convert_to(v_p ->> 'xml', 'UTF8')), 'hex');

        select * into v_doc from public.ids_documents
            where project_id = p_project and code = v_p ->> 'code' for update;
        if found and v_doc.origin <> 'library' then
            raise exception 'IDS code % is taken by a non-library document', v_p ->> 'code'
                using errcode = 'AS409', detail = to_jsonb(array[v_p ->> 'code'])::text;
        end if;
        if found and v_doc.library_source <> v_zdroj then
            raise exception 'IDS code % belongs to another library (%)', v_p ->> 'code', v_doc.library_source
                using errcode = 'AS409', detail = to_jsonb(array[v_p ->> 'code'])::text;
        end if;
        if not found then
            insert into public.ids_documents (code, title, origin, library_source, status, created_by, project_id)
                values (v_p ->> 'code', left(v_p ->> 'title', 200), 'library', v_zdroj, 'active', v_vyd.autor, p_project)
                returning * into v_doc;
            v_zmena := 'nove';
        else
            update public.ids_documents
                set title = left(v_p ->> 'title', 200), status = 'active', updated_at = now()
                where id = v_doc.id;
            v_zmena := 'nova_verzia';
        end if;

        select version, sha256 into v_posl from public.ids_document_versions
            where document_id = v_doc.id order by version desc limit 1;
        if v_posl.sha256 is not distinct from v_sha then
            v_verzia := v_posl.version;
            v_zmena := 'bez_zmeny';
        else
            v_verzia := coalesce(v_posl.version, 0) + 1;
            insert into public.ids_document_versions (
                document_id, version, xml, sha256, ids_version, audit, author, source, note,
                library_repo, library_path, library_commit, library_code
            ) values (
                v_doc.id, v_verzia, v_p ->> 'xml', v_sha, coalesce(v_p ->> 'ids_version', '1.0'),
                v_p -> 'audit', v_vyd.autor, 'import', 'vydanie ' || v_vyd.kod || ' knižnice ' || v_kod,
                v_zdroj, v_p ->> 'library_path', v_commit, v_p ->> 'code'
            );
        end if;

        insert into library.vydanie_ids (vydanie_id, code, document_id, version, sha256, zmena)
            values (p_vydanie, v_p ->> 'code', v_doc.id, v_verzia, v_sha, v_zmena);
        v_out := v_out || jsonb_build_object(
            'code', v_p ->> 'code', 'document_id', v_doc.id, 'version', v_verzia, 'sha256', v_sha, 'zmena', v_zmena
        );
    end loop;

    -- IDS of this library in this project that the release no longer produces: archived, nothing is deleted
    with arch as (
        update public.ids_documents
            set status = 'archived', updated_at = now()
            where project_id = p_project and origin = 'library' and library_source = v_zdroj
              and status <> 'archived' and not (code = any (v_kody))
            returning code
    )
    select v_out || coalesce(jsonb_agg(jsonb_build_object('code', code, 'zmena', 'archivovane')), '[]'::jsonb)
        into v_out from arch;
    return v_out;
end
$function$;

create function public.library_vydaj(
  p_kniznica text,
  p_kod text,
  p_autor text,
  p_sprava text,
  p_schema_verzia text,
  p_diagnostiky jsonb,
  p_ocakavane jsonb,
  p_polozky jsonb,
  p_project uuid
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
  perform public.project_required(p_project, 'library_vydaj');
  if coalesce(trim(p_autor), '') = '' then
    raise exception 'vydanie potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_polozky) <> 'array' then
    raise exception 'p_polozky: zoznam IDS' using errcode = '22023';
  end if;
  v_id := library.vytvor_vydanie(p_kniznica, p_kod, trim(p_autor), p_sprava, p_schema_verzia, p_diagnostiky, p_ocakavane);
  if jsonb_array_length(p_polozky) > 0 then
    v_ids := library.publikuj_ids(v_id, p_polozky, p_project);
  end if;
  return jsonb_build_object('vydanie_id', v_id, 'ids', v_ids);
end
$$;

-- ---------------------------------------------------------------------------

-- Grants (D-026, D-079): only service_role.
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.project_required(uuid, text)'::regprocedure,
    'public.library_vydaj(text, text, text, text, text, jsonb, jsonb, jsonb, uuid)'::regprocedure,
    'library.publikuj_ids(uuid, jsonb, uuid)'::regprocedure]
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

reset lock_timeout;
