-- D-160: drawing_link_overrides. Spustenie na lokálnej DB s aplikovanými migráciami (nikdy produkcia):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/drawing_link_overrides.sql
begin;

insert into objects (id, object_type, object_ref, name) values
  ('00000000-0000-4000-8000-0000000000e1', 'document', 'TDOC.268', 'Pôdorys 1NP'),
  ('00000000-0000-4000-8000-0000000000e2', 'spatial_zone', 'TZ.268', 'PU N1.01');

insert into drawing_link_overrides (document_id, page, text, action, target_id, target_ref)
values ('00000000-0000-4000-8000-0000000000e1', 1, 'pu n1.01', 'assign',
        '00000000-0000-4000-8000-0000000000e2', 'TZ.268');

do $$
declare n int;
begin
  -- dva živé riadky s rovnakým kľúčom nejdú
  begin
    insert into drawing_link_overrides (document_id, page, text, action, target_id, target_ref)
    values ('00000000-0000-4000-8000-0000000000e1', 1, 'pu n1.01', 'assign',
            '00000000-0000-4000-8000-0000000000e2', 'TZ.268');
    raise exception 'duplicitný živý riadok prešiel';
  exception when unique_violation then null;
  end;
  -- po ukončení ide nový
  update drawing_link_overrides set valid_until = now() where text = 'pu n1.01';
  insert into drawing_link_overrides (document_id, page, text, action, target_id, target_ref)
  values ('00000000-0000-4000-8000-0000000000e1', 1, 'pu n1.01', 'suppress', null, null);
  select count(*) into n from drawing_link_overrides where valid_until is null;
  if n <> 1 then raise exception 'živých riadkov: čakal som 1, je %', n; end if;
  -- assign bez cieľa nejde
  begin
    insert into drawing_link_overrides (document_id, page, text, action)
    values ('00000000-0000-4000-8000-0000000000e1', 2, 'x', 'assign');
    raise exception 'assign bez cieľa prešiel';
  exception when check_violation then null;
  end;
  -- zánik cieľa nechá snímku
  delete from objects where id = '00000000-0000-4000-8000-0000000000e2';
  select count(*) into n from drawing_link_overrides where target_ref = 'TZ.268' and target_id is null;
  if n < 1 then raise exception 'snímka cieľa po zániku chýba'; end if;
end $$;

rollback;
