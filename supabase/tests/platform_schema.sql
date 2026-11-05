-- D-188: rola platform_app smie písať len do schémy platform, do AIM dát nie.
-- Spúšťa sa ručne po aplikovaní migrácie (ako postgres); všetko sa vráti rollbackom.
begin;

do $$
begin
  if (select rolconnlimit from pg_roles where rolname = 'platform_app') <> 20 then
    raise exception 'platform_app: connection limit nie je 20';
  end if;
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'vector nie je nainštalovaný';
  end if;
  if to_regclass('public.objects') is null then
    raise exception 'chýba public.objects';
  end if;
end $$;

set local role platform_app;

create table platform.__platform_schema_test (id integer);
insert into platform.__platform_schema_test values (1);
select '[1, 2, 3]'::vector;
select to_tsvector('public.simple_unaccent', 'Žltý kôň');

do $$
begin
  begin
    perform 1 from public.objects limit 1;
    raise exception 'platform_app číta public.objects';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.objects (object_type, name) values ('asset', 'test');
    raise exception 'platform_app zapisuje do public.objects';
  exception when insufficient_privilege then
    null;
  end;
  begin
    create table public.__platform_schema_test (id integer);
    raise exception 'platform_app zakladá tabuľky v public';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
