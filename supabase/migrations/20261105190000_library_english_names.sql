-- D-194 phase 4b, step 1 of 3 (D-189 pattern): English twins of the library RPC functions. ADDITIVE: the old functions stay,
-- nothing is dropped. Step 2 = the app switches to the new names (code PR, merged only after this migration is applied).
-- Step 3 = a cleanup migration drops the old names.
--
-- NOT APPLIED. Needs Samuel's explicit yes (relayed under D-193); no data change, so no extra backup is needed.
--
-- Twins (same bodies, same security: invoker, search_path = '', EXECUTE only service_role; behaviour identical):
--   public.library_hlava_zoznam(p_kniznica)             -> public.library_head_list(p_library)
--   public.library_hlava_subor(p_kniznica, p_cesta)     -> public.library_head_file(p_library, p_path)
--   public.library_texty(p_kniznica)                    -> public.library_texts(p_library)
--   public.library_zapis(...)                           -> public.library_write(...)
--   public.library_vydaj(...)                           -> public.library_release(...)
--   public.library_vydanie_export(p_vydanie, p_cesta)   -> public.library_release_export(p_release, p_path)
--   library.publikuj_ids(p_vydanie, p_polozky, p_project) -> library.publish_ids(p_release, p_items, p_project)
-- Parameter names are English; returned column names and the jsonb keys are the library data contract and stay.
-- The internal functions library.zapis_revizie and library.vytvor_vydanie and the library.* tables stay (data contract).
-- library_release calls library.publish_ids, so the old library_vydaj/publikuj_ids pair can be dropped as a unit.
-- Rollback: drop the seven new functions (nothing depends on them until step 2).

create or replace function public.library_head_list(p_library text default null)
returns table (
  kniznica text, cesta text, note_id text, typ text, rev integer, sha256 text,
  autor text, vytvorena timestamptz, zdroj text, dlzka integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.kniznica, h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.autor, h.vytvorena, h.zdroj, length(h.text)
  from library.hlava h
  where p_library is null or h.kniznica = p_library
  order by h.kniznica, h.cesta
$$;

create or replace function public.library_head_file(p_library text, p_path text)
returns table (
  kniznica text, cesta text, note_id text, typ text, rev integer, sha256 text,
  autor text, vytvorena timestamptz, zdroj text, text text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.kniznica, h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.autor, h.vytvorena, h.zdroj, h.text
  from library.hlava h
  where h.kniznica = p_library and h.cesta = p_path
$$;

create or replace function public.library_texts(p_library text)
returns table (cesta text, note_id text, typ text, rev integer, sha256 text, text text)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.cesta, h.note_id, h.typ, h.rev, h.sha256, h.text
  from library.hlava h
  where h.kniznica = p_library
  order by h.cesta
$$;

create or replace function public.library_release_export(p_release uuid, p_path text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update library.vydanie set export_cesta = p_path where id = p_release and export_cesta is null
$$;

create or replace function library.publish_ids(p_release uuid, p_items jsonb, p_project uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
    perform public.project_required(p_project, 'publish_ids');
    select * into v_vyd from library.vydanie where id = p_release;
    if not found then
        raise exception 'release % does not exist', p_release using errcode = 'AS404';
    end if;
    if exists (select 1 from library.vydanie_ids where vydanie_id = p_release) then
        raise exception 'release % is already published', p_release using errcode = 'AS409';
    end if;
    select kod into v_kod from library.kniznica where id = v_vyd.kniznica_id;
    v_zdroj := 'db:library/' || v_kod;
    v_commit := v_vyd.kod || '@' || encode(v_vyd.manifest_sha256, 'hex');

    for v_p in select * from jsonb_array_elements(p_items) loop
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
            values (p_release, v_p ->> 'code', v_doc.id, v_verzia, v_sha, v_zmena);
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
$$;

create or replace function public.library_release(
  p_library text, p_code text, p_author text, p_message text, p_schema_version text,
  p_diagnostics jsonb, p_expected jsonb, p_items jsonb, p_project uuid
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
  perform public.project_required(p_project, 'library_release');
  if coalesce(trim(p_author), '') = '' then
    raise exception 'vydanie potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_polozky: zoznam IDS' using errcode = '22023';
  end if;
  v_id := library.vytvor_vydanie(p_library, p_code, trim(p_author), p_message, p_schema_version, p_diagnostics, p_expected);
  if jsonb_array_length(p_items) > 0 then
    v_ids := library.publish_ids(v_id, p_items, p_project);
  end if;
  return jsonb_build_object('vydanie_id', v_id, 'ids', v_ids);
end
$$;

create or replace function public.library_write(
  p_library text, p_author text, p_message text, p_source text, p_schema_version text,
  p_writes jsonb, p_projections jsonb, p_engine text
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
  if coalesce(trim(p_author), '') = '' then
    raise exception 'zápis do knižnice potrebuje autora (meno v editore)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_projections) <> 'object' then
    raise exception 'p_projekcie: objekt {cesta: projekcia}' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_writes) z
    where not (p_projections ? coalesce(z ->> 'nova_cesta', z ->> 'cesta'))
  ) then
    raise exception 'p_projekcie: chýba projekcia pre zapisovaný súbor' using errcode = '22023';
  end if;
  v_out := library.zapis_revizie(p_library, trim(p_author), p_message, p_source, p_schema_version, p_writes);
  for v_z in select * from jsonb_array_elements(v_out) loop
    v_p := p_projections -> (v_z ->> 'cesta');
    insert into library.projekcia (subor_id, rev, frontmatter, data, odkazy, diagnostiky, engine)
      select s.id, (v_z ->> 'rev')::integer, v_p -> 'frontmatter', v_p -> 'data',
             coalesce(v_p -> 'odkazy', '[]'::jsonb), coalesce(v_p -> 'diagnostiky', '[]'::jsonb), p_engine
      from library.subor s join library.kniznica k on k.id = s.kniznica_id
      where k.kod = p_library and s.cesta = v_z ->> 'cesta'
    on conflict (subor_id) do update set
      rev = excluded.rev, frontmatter = excluded.frontmatter, data = excluded.data,
      odkazy = excluded.odkazy, diagnostiky = excluded.diagnostiky, engine = excluded.engine,
      vypocitana = now();
  end loop;
  return v_out;
end
$$;

-- Privileges as on the old functions: only service_role (AGENTS.md D-026).
revoke all on function public.library_head_list(text) from public, anon, authenticated;
revoke all on function public.library_head_file(text, text) from public, anon, authenticated;
revoke all on function public.library_texts(text) from public, anon, authenticated;
revoke all on function public.library_release_export(uuid, text) from public, anon, authenticated;
revoke all on function library.publish_ids(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.library_release(text, text, text, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.library_write(text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.library_head_list(text) to service_role;
grant execute on function public.library_head_file(text, text) to service_role;
grant execute on function public.library_texts(text) to service_role;
grant execute on function public.library_release_export(uuid, text) to service_role;
grant execute on function library.publish_ids(uuid, jsonb, uuid) to service_role;
grant execute on function public.library_release(text, text, text, text, text, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.library_write(text, text, text, text, text, jsonb, jsonb, text) to service_role;
