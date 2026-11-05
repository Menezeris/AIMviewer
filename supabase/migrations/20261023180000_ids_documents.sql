-- D-162 (#285): IDS as documents with versions, from chat and from the viewer.
-- Additive migration. XML is the carrier (Studio JSON is not stored, it is derived from XML), versions are
-- immutable. `origin = library` is a snapshot from the library (read-only, changed only by import),
-- `origin = chat` is a working IDS whose carrier is AIM (editing a library one = new IDS
-- `chat` with `derived_from`). An IDS is not a document from IFC (D-104), so it is not in `objects`.
-- No run is binding today: `ids_runs.binding` is a flag for the future (D-086).
-- anon/authenticated get no rights on new objects (default privileges, migration 20261016120000).

begin;

create table ids_documents (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  title               text not null check (length(title) between 1 and 200),
  origin              text not null check (origin in ('library', 'chat')),
  library_source      text,                                  -- repo@commit:path, only for library
  derived_from        uuid,                                  -- FK to the version of the library snapshot (below)
  status              text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ids_documents_library_source_check
    check ((origin = 'library') = (library_source is not null)),
  constraint ids_documents_derived_check
    check (derived_from is null or origin = 'chat')
);

create table ids_document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references ids_documents(id) on delete cascade,
  version      integer not null check (version >= 1),
  xml          text not null,                                -- carrier
  sha256       text not null,
  ids_version  text,                                         -- ids:info/version
  audit        jsonb,                                        -- summary of audit and lint at write time
  author       text,
  source       text not null check (source in ('chat', 'viewer', 'import')),
  note         text,
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);
create index on ids_document_versions (document_id, version desc);

alter table ids_documents
  add constraint ids_documents_derived_from_fkey
  foreign key (derived_from) references ids_document_versions(id) on delete set null;

-- Versions are immutable; the library snapshot arrives only by import, chat and viewer write only `chat` IDS.
create function ids_document_versions_guard() returns trigger language plpgsql as $$
declare doc_origin text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'verzie IDS sú nemenné (nová verzia = nový riadok)';
  end if;
  select origin into doc_origin from ids_documents where id = new.document_id;
  if doc_origin = 'library' and new.source <> 'import' then
    raise exception 'knižničná snímka IDS je len na čítanie (create derived_from)';
  end if;
  if doc_origin = 'chat' and new.source = 'import' then
    raise exception 'import patrí len knižničnej snímke IDS';
  end if;
  return new;
end $$;
create trigger ids_document_versions_guard
  before insert or update on ids_document_versions
  for each row execute function ids_document_versions_guard();

-- The origin of an IDS does not change after creation.
create function ids_documents_origin_guard() returns trigger language plpgsql as $$
begin
  if new.origin <> old.origin then
    raise exception 'pôvod IDS sa nemení (library | chat)';
  end if;
  return new;
end $$;
create trigger ids_documents_origin_guard
  before update on ids_documents
  for each row execute function ids_documents_origin_guard();

comment on table ids_documents is
  'D-162: jedno IDS (origin library = snímka z knižnice len na čítanie, chat = pracovné s derived_from).';
comment on table ids_document_versions is
  'D-162: nemenná verzia IDS, XML je nositeľ.';

revoke all on ids_documents, ids_document_versions from anon, authenticated;
grant all on ids_documents, ids_document_versions to service_role;

-- Runs: link to the IDS version (null for old runs), engine, trigger and the binding flag.
alter table ids_runs
  add column ids_version_id uuid references ids_document_versions(id) on delete set null,
  add column engine  text not null default 'ifctester' check (engine in ('ifctester', 'ifc-lite')),
  add column binding boolean not null default false,
  add column trigger text not null default 'etl' check (trigger in ('etl', 'chat', 'viewer'));
create index on ids_runs (ids_version_id, model_label, checked_at desc);

-- Latest run of each IDS x model pair. IDS key: document (versions of one IDS are not mixed
-- with others), for runs without `ids_version_id` `ids_title` as before. Existing columns stay,
-- new ones are at the end.
create or replace view v_ids_latest as
  with latest as (
    select distinct on (coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label)
           r.*, d.code as ids_code, v.version as ids_doc_version
    from ids_runs r
    left join ids_document_versions v on v.id = r.ids_version_id
    left join ids_documents d on d.id = v.document_id
    order by coalesce(v.document_id::text, 't:' || r.ids_title), r.model_label, r.checked_at desc, r.id
  )
  select r.id, l.id as run_id, l.ids_title, l.model_label, l.checked_at,
         r.spec_identifier, r.spec_name, r.status, r.reasons,
         r.object_id, o.object_ref, o.name, coalesce(o.ifc_type, r.ifc_type) as ifc_type, r.ifc_guid,
         l.ids_code, l.ids_doc_version, l.engine, l.binding
  from latest l
  join ids_results r on r.run_id = l.id
  left join objects o on o.id = r.object_id;

create or replace view v_ids_summary as
  select ids_title, model_label, checked_at, spec_identifier, spec_name,
         count(*) filter (where ifc_guid is not null)                     as elements,
         count(*) filter (where ifc_guid is not null and status = 'pass') as passed,
         count(*) filter (where status = 'fail')                          as failed,
         (array_agg(reasons[1]) filter (where status = 'fail'))[1]        as example_reason,
         ids_code, ids_doc_version, engine, binding
  from v_ids_latest
  group by ids_title, model_label, checked_at, spec_identifier, spec_name,
           ids_code, ids_doc_version, engine, binding;

commit;
