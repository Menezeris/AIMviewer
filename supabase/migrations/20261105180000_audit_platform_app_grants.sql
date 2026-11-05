-- D-196 (R12, PR 4 support): the fork's migrator puts the audit triggers on the platform tables (D-188,
-- AIMforked PR 4); the fork connects as platform_app, so that role must be able to run the trigger function
-- and the log writer. Nothing else: no select on audit.log, no rights on the log itself (append-only, §2.25).
-- Grant list confirmed by the PR 4 session (session_01RqBVf44bcxyjaGuHRqacFH) on 5 Nov.
-- Needs 20261105160000 (schema audit) applied first.

do $$
begin
  if to_regnamespace('audit') is null then
    raise exception 'D-196: schema audit is missing (apply 20261105160000 first)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'platform_app') then
    raise exception 'D-196: role platform_app is missing (D-188)';
  end if;
end $$;

grant usage on schema audit to platform_app;
grant execute on function audit.log_row() to platform_app;
grant execute on function audit.write(text, text, uuid, text, jsonb, jsonb, text) to platform_app;
