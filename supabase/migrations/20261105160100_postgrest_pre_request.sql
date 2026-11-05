-- D-196 (R12, decision E): PostgREST runs public.aim_pre_request() before every request, which copies the
-- headers x-aim-person-id / x-aim-source of a service_role request into app.person_id / app.source for the
-- transaction log. Separate from 20261105160000 because it changes the API: applied after that migration,
-- with the app sending the headers (lib/audit/context.ts). Undo: alter role authenticator reset
-- pgrst.db_pre_request; notify pgrst, 'reload config';

do $$
begin
  if to_regprocedure('public.aim_pre_request()') is null then
    raise exception 'D-196: public.aim_pre_request() is missing (apply 20261105160000 first)';
  end if;
end $$;

alter role authenticator set pgrst.db_pre_request = 'public.aim_pre_request';
notify pgrst, 'reload config';
