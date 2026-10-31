-- D-181: icdd_imports (pripravená migrácia 20261101140000).
-- Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/icdd_imports.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

insert into icdd_imports (version_id, container_sha256, file_name, same_as_aim, payloads, counts)
values ('2026-10-31_ASR-v079_VZT-v011_D44', repeat('a', 64), 'AIM_x.icdd', true,
        '{"ASR_v079.ifc": "aa"}', '{"derived-spatial": 3518}');

do $$
begin
  -- zlý sha256
  begin
    insert into icdd_imports (version_id, container_sha256) values ('v', 'xyz');
    raise exception 'FAIL: sha256 bez kontroly';
  exception when check_violation then null;
  end;
  -- applied bez času
  begin
    insert into icdd_imports (version_id, container_sha256, status) values ('v', repeat('b', 64), 'applied');
    raise exception 'FAIL: applied bez applied_at';
  exception when check_violation then null;
  end;
  -- neznámy stav
  begin
    insert into icdd_imports (version_id, container_sha256, status) values ('v', repeat('b', 64), 'done');
    raise exception 'FAIL: neznámy status';
  exception when check_violation then null;
  end;
  -- issues musí byť pole
  begin
    insert into icdd_imports (version_id, container_sha256, issues) values ('v', repeat('b', 64), '{}');
    raise exception 'FAIL: issues nie je pole';
  exception when check_violation then null;
  end;
  if (select count(*) from icdd_imports where status = 'checked') <> 1 then raise exception 'FAIL: počet'; end if;
  if has_table_privilege('anon', 'icdd_imports', 'select') then raise exception 'FAIL: anon číta icdd_imports'; end if;
end $$;

update icdd_imports set status = 'applied', applied_at = now() where version_id like '2026-10-31%';

rollback;
