-- D-196 (R12, PR 4 support): the fork's migrator puts the audit triggers on the platform tables (D-188,
-- AIMforked PR 4); the fork connects as platform_app, so that role must be able to run the trigger function
-- and the log writer. Nothing else: no select on audit.log, no rights on the log itself (append-only, §2.25).
-- Grant list confirmed by the PR 4 session (session_01RqBVf44bcxyjaGuHRqacFH) on 5 Nov.
-- Needs 20261105160000 (schema audit) applied first.
--
-- Corrected 5 Nov after the production apply: the objects in schema audit belong to audit_owner, and after
-- 20261105160000 postgres holds only the automatic ADMIN grant on it (no SET, no INHERIT), so a GRANT run as
-- postgres is skipped with a warning and grants nothing. On production the orchestrator ran the grants as
-- audit_owner by hand (#60); this file now does the same: a temporary grant with SET and without INHERIT,
-- the grants as audit_owner, and the temporary grant revoked again. The guards fail the migration if the
-- grants did not take effect or postgres can still use audit_owner.

do $$
begin
  if to_regnamespace('audit') is null then
    raise exception 'D-196: schema audit is missing (apply 20261105160000 first)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'platform_app') then
    raise exception 'D-196: role platform_app is missing (D-188)';
  end if;
end $$;

grant audit_owner to postgres with set true, inherit false;
set role audit_owner;

grant usage on schema audit to platform_app;
grant execute on function audit.log_row() to platform_app;
grant execute on function audit.write(text, text, uuid, text, jsonb, jsonb, text) to platform_app;

reset role;
revoke audit_owner from postgres;

do $$
begin
  if not has_schema_privilege('platform_app', 'audit', 'usage')
     or not has_function_privilege('platform_app', 'audit.log_row()', 'execute')
     or not has_function_privilege('platform_app', 'audit.write(text, text, uuid, text, jsonb, jsonb, text)', 'execute') then
    raise exception 'D-196: the platform_app grants did not take effect';
  end if;
  if has_table_privilege('platform_app', 'audit.log', 'select') then
    raise exception 'D-196: platform_app must not read audit.log';
  end if;
  if not (select rolsuper from pg_roles where rolname = 'postgres')
     and (pg_has_role('postgres', 'audit_owner', 'SET') or pg_has_role('postgres', 'audit_owner', 'USAGE')) then
    raise exception 'D-196: postgres can still use audit_owner';
  end if;
end $$;
