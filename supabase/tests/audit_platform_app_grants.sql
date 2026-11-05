-- D-196: platform_app may run the audit trigger and writer, nothing more. Local database with the migrations
-- applied (never production): psql -v ON_ERROR_STOP=1 -f supabase/tests/audit_platform_app_grants.sql
begin;
do $$
begin
  if not has_schema_privilege('platform_app', 'audit', 'usage') then raise exception 'no usage on audit'; end if;
  if not has_function_privilege('platform_app', 'audit.log_row()', 'execute') then raise exception 'no execute on log_row'; end if;
  if not has_function_privilege('platform_app', 'audit.write(text, text, uuid, text, jsonb, jsonb, text)', 'execute') then
    raise exception 'no execute on write';
  end if;
  if has_function_privilege('platform_app', 'audit.write_run(text, jsonb, uuid)', 'execute') then
    raise exception 'write_run must not be granted';
  end if;
  if has_table_privilege('platform_app', 'audit.log', 'select') or has_table_privilege('platform_app', 'audit.log', 'insert')
     or has_table_privilege('platform_app', 'audit.log', 'update') or has_table_privilege('platform_app', 'audit.log', 'delete') then
    raise exception 'platform_app holds a right on audit.log';
  end if;
end $$;

-- A write as platform_app to a table with the audit trigger is logged with its role.
create temp table t196 (id uuid primary key default gen_random_uuid(), name text);
grant all on t196 to platform_app;
create trigger audit_log_ins_del after insert or delete on t196 for each row execute function audit.log_row('id');
set local role platform_app;
select set_config('app.source', 'fork', true);
insert into t196 (name) values ('x');
reset role;
do $$
begin
  if not exists (select 1 from audit.log where db_role = 'platform_app' and source = 'fork' and op = 'INSERT') then
    raise exception 'platform_app write not logged';
  end if;
end $$;
rollback;
