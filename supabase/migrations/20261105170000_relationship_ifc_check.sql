-- D-196 (R10, PR 3): relationships_validate checks the IFC type of both ends against the manifest
-- (relationship_types.from_ifc_types / to_ifc_types, 20261105140000) and every rel_type moves to 'warn'.
--   * 'off'     : no IFC check (as before).
--   * 'warn'    : an end that fails raises a WARNING; the edge is written and v_relationship_ifc_violations
--                 lists it.
--   * 'enforce' : an end that fails rejects the write.
-- The object_type rule and the project rule stay as they are and run first (narrower app rules, R10).
-- An update that keeps rel_type, from_id and to_id is not rechecked (closing an edge always works).
-- The body below is the function of 20261104233000 unchanged, plus the block marked D-196.
-- On production 5 Nov all 4,749 active edges pass (report in #435); enforce per rel_type is
-- supabase/pending/relationship_ifc_enforce.sql, applied once the view shows 0 active violations for it.
-- Test: supabase/tests/relationship_ifc_check.sql.

-- Same rule as in 20261105140000 (allowed empty, or the class or one of its ancestors is allowed), as one
-- primary-key lookup instead of one entity_is_a call per allowed type: it now runs on every edge write.
create or replace function public.relationship_ifc_end_ok(p_ifc_type text, p_allowed text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select cardinality(p_allowed) = 0
      or exists (select 1 from entity_types e
                  where e.ifc_class = p_ifc_type
                    and (e.ifc_class = any (p_allowed) or e.ancestors && p_allowed));
$$;

revoke all on function public.relationship_ifc_end_ok(text, text[]) from public, anon, authenticated;

create or replace function public.relationships_validate()
returns trigger
language plpgsql
as $$
declare
  m         relationship_types%rowtype;
  from_type text;
  to_type   text;
  from_proj uuid;
  to_proj   uuid;
  from_ifc  text;
  to_ifc    text;
  bad       text;
begin
  select * into m from relationship_types where rel_type = new.rel_type;
  if not found then
    raise exception 'relationships: neznamy rel_type "%"', new.rel_type;
  end if;

  select object_type, project_id, ifc_type into from_type, from_proj, from_ifc from objects where id = new.from_id;
  if from_type is null then
    raise exception 'relationships(%): from_id % nie je v objects', new.rel_type, new.from_id;
  end if;
  if cardinality(m.from_object_types) > 0 and not (from_type = any(m.from_object_types)) then
    raise exception 'relationships(%): from object_type "%" nie je povoleny %',
      new.rel_type, from_type, m.from_object_types;
  end if;

  if m.to_is_classification then
    if not exists (select 1 from classification_references where id = new.to_id) then
      raise exception 'relationships(%): to_id % nie je v classification_references', new.rel_type, new.to_id;
    end if;
    to_ifc := 'IfcClassificationReference';
  else
    select object_type, project_id, ifc_type into to_type, to_proj, to_ifc from objects where id = new.to_id;
    if to_type is null then
      raise exception 'relationships(%): to_id % nie je v objects', new.rel_type, new.to_id;
    end if;
    if cardinality(m.to_object_types) > 0 and not (to_type = any(m.to_object_types)) then
      raise exception 'relationships(%): to object_type "%" nie je povoleny %',
        new.rel_type, to_type, m.to_object_types;
    end if;
  end if;

  if from_proj is not null and to_proj is not null and from_proj <> to_proj then
    raise exception 'relationships(%): % and % are in different projects (D-189)', new.rel_type, new.from_id, new.to_id;
  end if;

  -- D-196 (R10): the ifc_type of each end is an allowed IFC class or a subtype (entity_is_a). Checked when
  -- the edge is written or its type or an end changes; an update of other columns (closing it with
  -- valid_until, the ETL's rewrites) is not rechecked, so an old edge can always be ended.
  if m.ifc_check <> 'off'
     and (tg_op = 'INSERT' or new.rel_type is distinct from old.rel_type
          or new.from_id is distinct from old.from_id or new.to_id is distinct from old.to_id) then
    if not relationship_ifc_end_ok(from_ifc, m.from_ifc_types) then
      bad := format('relationships(%s): from %s has ifc_type %s, allowed %s (R10)',
                    new.rel_type, new.from_id, coalesce(from_ifc, 'NULL'), m.from_ifc_types);
    elsif not relationship_ifc_end_ok(to_ifc, m.to_ifc_types) then
      bad := format('relationships(%s): to %s has ifc_type %s, allowed %s (R10)',
                    new.rel_type, new.to_id, coalesce(to_ifc, 'NULL'), m.to_ifc_types);
    end if;
    if bad is not null then
      if m.ifc_check = 'enforce' then
        raise exception '%', bad using errcode = 'check_violation';
      end if;
      raise warning '%', bad;
    end if;
  end if;

  new.project_id := coalesce(from_proj, to_proj);
  return new;
end $$;

update public.relationship_types set ifc_check = 'warn' where ifc_check = 'off';

analyze public.relationship_types;
