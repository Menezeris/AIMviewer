-- D-196 (R2, R12, PR 2): the transaction log. One append-only table audit.log for every write to the AIM
-- graph tables in public, written by triggers; the person comes from the session setting app.person_id,
-- the writer from app.source. IfcOwnerHistory is derived from the log (plan 7.3 point 5).
--
--   * Role audit_owner (NOLOGIN) owns schema audit, the log, its partitions and the SECURITY DEFINER writer.
--     No role holds insert, update, delete or truncate on the log; the only way in is audit.write() /
--     audit.write_run(), and a guard trigger rejects update, delete and truncate even for the owner.
--   * audit.log is partitioned by month (24 months from Nov 2026, plus a default partition);
--     audit.ensure_partitions(months) adds more.
--   * audit.log_row() (invoker) is the row trigger: it skips an UPDATE that changes nothing but updated_at
--     (the ETL's no-op rewrites, decision G), and hands the row to audit.write() with the writing role.
--   * Person: app.person_id (uuid, may be unset until shared sign-in, step 5); source: app.source.
--     public.aim_pre_request() copies the request headers x-aim-person-id and x-aim-source into them for
--     PostgREST requests made with the service_role key; the ETL sets them per connection.
--   * public.ifc_owner_history(table, row_id) and public.v_ifc_owner_history: IfcOwnerHistory attributes
--     derived from the log (CreationDate, OwningUser, OwningApplication, ChangeAction, LastModifiedDate,
--     LastModifyingUser, LastModifyingApplication).
-- Logged tables: decision F (D-196 point 7). Not logged: ifc_rev_*, run results, mcp_call_log,
-- ifc_guid_history, bcf_topic_counters.
-- The PostgREST setting (pgrst.db_pre_request) is in a separate migration, 20261105160100, so this one
-- can be rehearsed and applied without touching the API.
-- Test: supabase/tests/audit_log.sql.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'audit_owner') then
    create role audit_owner nologin noinherit;
  end if;
end $$;

-- Membership only for this migration (to create objects owned by audit_owner); revoked at the end.
grant audit_owner to postgres;

create schema audit authorization audit_owner;
revoke all on schema audit from public;

set role audit_owner;

create table audit.log (
  id          bigint generated always as identity,
  at          timestamptz not null default clock_timestamp(),
  txid        bigint not null default txid_current(),
  person_id   uuid,                 -- IfcPerson node of the writer (app.person_id), NULL when unknown
  db_role     text not null,        -- role that ran the statement (service_role, postgres, platform_app)
  source      text,                 -- app.source: 'app', 'app:<route>', 'etl:<run>', 'fork', 'mcp' ...
  table_name  text not null,        -- schema-qualified, e.g. public.objects
  row_id      text,                 -- primary key value(s), '/'-joined for composite keys
  project_id  uuid,                 -- project of the row (column, or the objects row for 1:1 suffixes)
  op          text not null,        -- INSERT | UPDATE | DELETE | RUN (one summary row per ETL run)
  before      jsonb,
  after       jsonb,
  primary key (id, at),
  constraint log_op check (op in ('INSERT', 'UPDATE', 'DELETE', 'RUN'))
) partition by range (at);

comment on table audit.log is
  'D-196: append-only transaction log of the AIM graph (R2, R12); IfcOwnerHistory is derived from it';

create index log_at on audit.log (at);
create index log_row on audit.log (table_name, row_id, at);
create index log_project on audit.log (project_id, at);

-- Guard: nothing changes or removes a log row, not even the owner (PR 2 test 6).
create function audit.reject_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit.log is append-only (D-196): % rejected', tg_op;
end;
$$;

create trigger log_no_update_delete before update or delete on audit.log
  for each row execute function audit.reject_change();

-- Monthly partitions from the month of p_from, p_months ahead. A TRUNCATE trigger on each partition, because
-- truncating a partition directly does not fire the parent's statement trigger.
create function audit.ensure_partitions(p_months int default 24, p_from date default date_trunc('month', now())::date)
returns int
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  m date; n int := 0; part text;
begin
  for i in 0 .. p_months - 1 loop
    m := (date_trunc('month', p_from) + make_interval(months => i))::date;
    part := 'log_' || to_char(m, 'YYYY_MM');
    if to_regclass('audit.' || part) is null then
      execute format('create table audit.%I partition of audit.log for values from (%L) to (%L)',
                     part, m, (m + interval '1 month')::date);
      execute format('create trigger log_no_truncate before truncate on audit.%I '
                     'for each statement execute function audit.reject_change()', part);
      execute format('revoke all on audit.%I from public', part);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create table audit.log_default partition of audit.log default;
create trigger log_no_truncate before truncate on audit.log_default
  for each statement execute function audit.reject_change();
create trigger log_no_truncate before truncate on audit.log
  for each statement execute function audit.reject_change();

select audit.ensure_partitions(24, date '2026-11-01');

-- The only writers of the log. SECURITY DEFINER as audit_owner; person and source come from the session.
-- Without app.source the connection's application_name is the source (the ETL sets PGAPPNAME per run).
create function audit.write(p_table text, p_row_id text, p_project uuid, p_op text,
                            p_before jsonb, p_after jsonb, p_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  v_person text := nullif(current_setting('app.person_id', true), '');
begin
  if p_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'audit.write: op % not allowed', p_op;
  end if;
  insert into audit.log (person_id, db_role, source, table_name, row_id, project_id, op, before, after)
  values (case when v_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then v_person::uuid end,
          coalesce(p_role, session_user), coalesce(nullif(current_setting('app.source', true), ''),
                   nullif(current_setting('application_name', true), '')),
          p_table, p_row_id, p_project, p_op, p_before, p_after);
end;
$$;

-- One summary row per ETL run (decision G): the counts and the file, row changes are logged by the triggers.
create function audit.write_run(p_run text, p_summary jsonb, p_project uuid default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, audit
as $$
declare
  v_person text := nullif(current_setting('app.person_id', true), '');
begin
  insert into audit.log (person_id, db_role, source, table_name, row_id, project_id, op, before, after)
  values (case when v_person ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then v_person::uuid end,
          session_user, coalesce(nullif(current_setting('app.source', true), ''),
                   nullif(current_setting('application_name', true), '')),
          'etl', p_run, p_project, 'RUN', null, p_summary);
end;
$$;

reset role;

-- Row trigger (invoker: current_user is the writing role). TG_ARGV: primary key columns, optionally
-- followed by '@objects' when the project is that of the objects row with the same id (1:1 suffixes).
create function audit.log_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_key text := ''; v_project uuid; v_suffix boolean := false;
  i int;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  -- An update that only touches updated_at is a no-op rewrite: not logged.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  v_row := coalesce(v_new, v_old);
  for i in 0 .. tg_nargs - 1 loop
    if tg_argv[i] = '@objects' then
      v_suffix := true;
    else
      v_key := v_key || case when v_key = '' then '' else '/' end || coalesce(v_row ->> tg_argv[i], '');
    end if;
  end loop;
  if v_row ? 'project_id' then
    v_project := (v_row ->> 'project_id')::uuid;
  elsif v_suffix then
    select o.project_id into v_project from public.objects o where o.id = (v_row ->> 'id')::uuid;
  end if;
  perform audit.write(tg_table_schema || '.' || tg_table_name, v_key, v_project, tg_op, v_old, v_new,
                      current_user::text);
  return null;
end;
$$;

alter function audit.log_row() owner to audit_owner;

-- Rights: the writing roles may run the trigger function and the writers; they may read the log (for
-- IfcOwnerHistory); nobody holds insert, update, delete or truncate on it.
revoke all on all functions in schema audit from public;
grant usage on schema audit to postgres, service_role;
grant execute on function audit.log_row() to postgres, service_role;
grant execute on function audit.write(text, text, uuid, text, jsonb, jsonb, text) to postgres, service_role;
grant execute on function audit.write_run(text, jsonb, uuid) to postgres, service_role;
grant select on audit.log to postgres, service_role;
revoke insert, update, delete, truncate, references, trigger on audit.log from postgres, service_role;

-- Triggers on the graph tables (decision F).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('objects', 'id'), ('documents', 'id,@objects'), ('spaces', 'id,@objects'), ('floors', 'id,@objects'),
      ('persons', 'id,@objects'), ('captures', 'id,@objects'), ('capture_media', 'id,@objects'),
      ('relationships', 'id'), ('classification_systems', 'id'), ('classification_references', 'id'),
      ('information_containers', 'id'), ('container_revisions', 'id'), ('model_revisions', 'id'),
      ('model_tasks', 'id'), ('model_task_documents', 'id'), ('saved_views', 'id'),
      ('ids_documents', 'id'), ('ids_document_versions', 'id'), ('ids_document_models', 'id'),
      ('clash_tests', 'id'), ('clash_reviews', 'test_id,clash_key'), ('drawing_link_overrides', 'id'),
      ('ifc_guid_aliases', 'id'), ('relationship_types', 'rel_type'), ('entity_types', 'ifc_class')
    ) as v(tbl, args)
  loop
    execute format(
      'create trigger audit_log_ins_del after insert or delete on public.%I '
      'for each row execute function audit.log_row(%s)',
      t.tbl, (select string_agg(quote_literal(a), ', ') from unnest(string_to_array(t.args, ',')) a));
    execute format(
      'create trigger audit_log_upd after update on public.%I '
      'for each row when (old.* is distinct from new.*) execute function audit.log_row(%s)',
      t.tbl, (select string_agg(quote_literal(a), ', ') from unnest(string_to_array(t.args, ',')) a));
  end loop;
end $$;

-- PostgREST pre-request (R12, decision E): a request made with the service_role key (only the AIM server
-- holds it) may name the person and the source in headers; any other request records its role only.
-- Never fails: a bad header leaves the setting empty instead of breaking the API.
create function public.aim_pre_request()
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_headers json; v_role text; v_person text; v_source text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_role := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
  exception when others then
    v_headers := null; v_role := null;
  end;
  if v_role = 'service_role' then
    v_person := v_headers ->> 'x-aim-person-id';
    v_source := left(v_headers ->> 'x-aim-source', 200);
  end if;
  if v_person is null or v_person !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_person := '';
  end if;
  perform set_config('app.person_id', v_person, true);
  perform set_config('app.source', coalesce(v_source, 'api:' || coalesce(v_role, 'unknown')), true);
end;
$$;

revoke all on function public.aim_pre_request() from public;
grant execute on function public.aim_pre_request() to anon, authenticated, service_role;

-- IfcOwnerHistory of one row, derived from the log (plan 7.3 point 5). Invoker: the caller needs select on
-- audit.log (postgres, service_role). OwningUser and LastModifyingUser are
-- IfcPerson node ids (NULL until shared sign-in); the applications are the sources.
create function public.ifc_owner_history(p_table text, p_row_id text)
returns table (
  creation_date timestamptz, owning_user uuid, owning_application text,
  change_action text, last_modified_date timestamptz, last_modifying_user uuid,
  last_modifying_application text, project_id uuid
)
language sql
stable
set search_path = pg_catalog, audit
as $$
  with h as (
    select l.* from audit.log l
     where l.table_name = case when p_table like '%.%' then p_table else 'public.' || p_table end
       and l.row_id = p_row_id and l.op <> 'RUN'
  ), first_ins as (
    select * from h where op = 'INSERT' order by at, id limit 1
  ), last_ch as (
    select * from h order by at desc, id desc limit 1
  )
  select f.at, f.person_id, coalesce(f.source, f.db_role),
         case l.op when 'INSERT' then 'ADDED' when 'UPDATE' then 'MODIFIED' when 'DELETE' then 'DELETED' end,
         case when l.op <> 'INSERT' then l.at end,
         case when l.op <> 'INSERT' then l.person_id end,
         case when l.op <> 'INSERT' then coalesce(l.source, l.db_role) end,
         l.project_id
    from last_ch l left join first_ins f on true;
$$;

revoke all on function public.ifc_owner_history(text, text) from public, anon, authenticated;
grant execute on function public.ifc_owner_history(text, text) to postgres, service_role;

-- The same for every logged row (for export and reports).
create view public.v_ifc_owner_history as
select table_name, row_id, project_id,
       min(at) filter (where op = 'INSERT') as creation_date,
       (array_agg(person_id order by at, id) filter (where op = 'INSERT'))[1] as owning_user,
       (array_agg(coalesce(source, db_role) order by at, id) filter (where op = 'INSERT'))[1] as owning_application,
       case (array_agg(op order by at desc, id desc))[1]
         when 'INSERT' then 'ADDED' when 'UPDATE' then 'MODIFIED' when 'DELETE' then 'DELETED' end as change_action,
       max(at) filter (where op <> 'INSERT') as last_modified_date,
       (array_agg(person_id order by at desc, id desc) filter (where op <> 'INSERT'))[1] as last_modifying_user,
       (array_agg(coalesce(source, db_role) order by at desc, id desc) filter (where op <> 'INSERT'))[1]
         as last_modifying_application
  from audit.log
 where op <> 'RUN'
 group by table_name, row_id, project_id;

revoke all on public.v_ifc_owner_history from anon, authenticated;

revoke audit_owner from postgres;

analyze audit.log;
