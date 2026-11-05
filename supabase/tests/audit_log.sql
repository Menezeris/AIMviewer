-- D-196 (R2, R12, PR 2): transaction log audit.log, its triggers, the pre-request function and
-- IfcOwnerHistory. Run on a local database with the migrations applied (never production):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/audit_log.sql
-- Needs the OCB project node (as multi_project.sql). Everything is rolled back.
begin;

do $$
declare
  p constant uuid := '9e2dfcba-437b-43d3-a925-0dd29f195b38';
  person constant uuid := '11111111-2222-3333-4444-555555555555';
  o uuid; s uuid; r uuid; n int; l record; h record; t0 timestamptz;
begin
  perform set_config('app.person_id', person::text, true);
  perform set_config('app.source', 'test:audit', true);
  t0 := clock_timestamp();

  -- 1. INSERT is logged with after, person, source, role, project and the row id.
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196A.W', 'wall', 'IfcWall', p) returning id into o;
  select * into l from audit.log where table_name = 'public.objects' and row_id = o::text and op = 'INSERT';
  if l is null then raise exception 'insert not logged'; end if;
  if l.person_id is distinct from person or l.source <> 'test:audit' or l.project_id is distinct from p
     or l.before is not null or l.after ->> 'name' <> 'wall' or l.db_role is null then
    raise exception 'insert row wrong: %', row_to_json(l);
  end if;

  -- 2. UPDATE logs before and after; an update that only touches updated_at is not logged.
  update objects set name = 'wall 2' where id = o;
  select * into l from audit.log where table_name = 'public.objects' and row_id = o::text and op = 'UPDATE';
  if l.before ->> 'name' <> 'wall' or l.after ->> 'name' <> 'wall 2' then
    raise exception 'update row wrong: %', row_to_json(l);
  end if;
  update objects set name = 'wall 2' where id = o;                      -- identical row
  update objects set updated_at = now() + interval '1 s' where id = o;  -- only updated_at
  select count(*) into n from audit.log where table_name = 'public.objects' and row_id = o::text and op = 'UPDATE';
  if n <> 1 then raise exception 'no-op updates logged: % update rows', n; end if;

  -- 3. Suffix table takes the project of its objects row; composite keys are '/'-joined.
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('space', 'T196A.S', 'space', 'IfcSpace', p) returning id into s;
  insert into spaces (id) values (s);
  select * into l from audit.log where table_name = 'public.spaces' and row_id = s::text;
  if l.project_id is distinct from p then raise exception 'suffix project not resolved: %', row_to_json(l); end if;

  -- 4. Relationship edge and its DELETE (before kept, after null).
  insert into relationships (rel_type, from_id, to_id, source) values ('rel_space_boundary', o, s, 'test')
    returning id into r;
  delete from relationships where id = r;
  select * into l from audit.log where table_name = 'public.relationships' and row_id = r::text and op = 'DELETE';
  if l.before ->> 'rel_type' <> 'rel_space_boundary' or l.after is not null or l.project_id is distinct from p then
    raise exception 'delete row wrong: %', row_to_json(l);
  end if;

  -- 5. Unknown person: an invalid or empty app.person_id is stored as NULL, the role is still recorded.
  perform set_config('app.person_id', 'not-a-uuid', true);
  update objects set name = 'wall 3' where id = o;
  select * into l from audit.log where table_name = 'public.objects' and row_id = o::text and op = 'UPDATE'
   order by id desc limit 1;
  if l.person_id is not null or l.db_role is null then raise exception 'invalid person stored: %', row_to_json(l); end if;
  perform set_config('app.person_id', person::text, true);

  -- 6. Append-only: update, delete and truncate are rejected, also for the owner.
  begin
    update audit.log set source = 'x' where table_name = 'public.objects' and row_id = o::text;
    raise exception 'update of the log succeeded';
  exception when raise_exception then
    if sqlerrm not like 'audit.log is append-only%' then raise; end if;
  end;
  begin
    delete from audit.log where table_name = 'public.objects' and row_id = o::text;
    raise exception 'delete of the log succeeded';
  exception when raise_exception then
    if sqlerrm not like 'audit.log is append-only%' then raise; end if;
  end;
  begin
    truncate audit.log_2026_11;
    raise exception 'truncate of a partition succeeded';
  exception when raise_exception then
    if sqlerrm not like 'audit.log is append-only%' then raise; end if;
  end;

  -- 7. Rights: no role holds insert, update, delete or truncate on the log; anon/authenticated nothing.
  -- (postgres is checked only where it is not a superuser, as in Supabase; locally it is one)
  select count(*) into n
    from (values ('postgres'), ('service_role'), ('anon'), ('authenticated')) r(role),
         unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
   where not (select rolsuper from pg_roles where rolname = r.role)
     and has_table_privilege(r.role, 'audit.log', priv);
  if n <> 0 then raise exception 'a role holds a write right on audit.log: %', n; end if;
  if has_schema_privilege('anon', 'audit', 'usage') or has_schema_privilege('authenticated', 'audit', 'usage') then
    raise exception 'anon/authenticated can use schema audit';
  end if;
  if (select tableowner from pg_tables where schemaname = 'audit' and tablename = 'log') <> 'audit_owner' then
    raise exception 'audit.log not owned by audit_owner';
  end if;
  if pg_has_role('postgres', 'audit_owner', 'member') and not (select rolsuper from pg_roles where rolname = 'postgres') then
    raise exception 'postgres still a member of audit_owner';
  end if;

  -- 8. IfcOwnerHistory: creation from the first insert, last change from the last write.
  select * into h from ifc_owner_history('objects', o::text);
  if h.creation_date < t0 or h.owning_user is distinct from person or h.owning_application <> 'test:audit'
     or h.change_action <> 'MODIFIED' or h.last_modified_date is null or h.last_modifying_user is not null
     or h.project_id is distinct from p then
    raise exception 'owner history wrong: %', row_to_json(h);
  end if;
  select * into h from ifc_owner_history('public.relationships', r::text);
  if h.change_action <> 'DELETED' then raise exception 'deleted edge history: %', row_to_json(h); end if;
  select * into h from v_ifc_owner_history where table_name = 'public.objects' and row_id = o::text;
  if h.change_action <> 'MODIFIED' or h.owning_user is distinct from person then
    raise exception 'v_ifc_owner_history wrong: %', row_to_json(h);
  end if;

  -- 9. ETL run summary row.
  perform audit.write_run('etl:test-run', '{"objects": 2}'::jsonb, p);
  select count(*) into n from audit.log where op = 'RUN' and row_id = 'etl:test-run' and after ->> 'objects' = '2';
  if n <> 1 then raise exception 'run summary not logged'; end if;
  begin
    perform audit.write('public.objects', 'x', p, 'RUN', null, null, 'postgres');
    raise exception 'audit.write accepted op RUN';
  exception when raise_exception then
    if sqlerrm not like 'audit.write: op RUN not allowed%' then raise; end if;
  end;

  -- 10. Unlogged tables stay unlogged.
  select count(*) into n from pg_trigger
   where tgname like 'audit_log_%' and tgrelid::regclass::text in
     ('ifc_rev_objects', 'ifc_rev_property_sets', 'ifc_rev_relationships', 'mcp_call_log', 'ifc_guid_history',
      'bcf_topic_counters', 'ids_results', 'clash_results', 'verification_results', 'document_pages');
  if n <> 0 then raise exception 'unlogged table has an audit trigger: %', n; end if;
  select count(distinct tgrelid) into n from pg_trigger where tgname = 'audit_log_ins_del';
  if n <> 25 then raise exception 'logged tables: % <> 25', n; end if;
end $$;

-- 11. Pre-request: headers are trusted only for service_role.
do $$
begin
  perform set_config('request.headers',
    '{"x-aim-person-id": "11111111-2222-3333-4444-555555555555", "x-aim-source": "app:/api/bcf"}', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform aim_pre_request();
  if current_setting('app.person_id') <> '11111111-2222-3333-4444-555555555555'
     or current_setting('app.source') <> 'app:/api/bcf' then
    raise exception 'service_role headers not copied: % %', current_setting('app.person_id'), current_setting('app.source');
  end if;
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform aim_pre_request();
  if current_setting('app.person_id') <> '' or current_setting('app.source') <> 'api:anon' then
    raise exception 'anon headers trusted: % %', current_setting('app.person_id'), current_setting('app.source');
  end if;
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-aim-person-id": "drop table x"}', true);
  perform aim_pre_request();
  if current_setting('app.person_id') <> '' or current_setting('app.source') <> 'api:service_role' then
    raise exception 'bad person header accepted';
  end if;
  perform set_config('request.headers', 'not json', true);
  perform aim_pre_request();   -- must not fail
end $$;

-- 12. As service_role (the app's role): writes are logged, the log can be read but not changed.
set local role service_role;
do $$
declare o uuid; n int;
begin
  perform set_config('app.person_id', '', true);
  perform set_config('app.source', 'app', true);
  insert into objects (object_type, object_ref, name, ifc_type, project_id)
    values ('asset', 'T196A.SR', 'sr', 'IfcWall', '9e2dfcba-437b-43d3-a925-0dd29f195b38') returning id into o;
  select count(*) into n from audit.log where row_id = o::text and db_role = 'service_role' and source = 'app'
    and person_id is null;
  if n <> 1 then raise exception 'service_role write not logged with its role'; end if;
  begin
    insert into audit.log (db_role, table_name, op) values ('x', 'x', 'INSERT');
    raise exception 'service_role inserted into audit.log directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from audit.log where row_id = o::text;
    raise exception 'service_role deleted from audit.log';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
