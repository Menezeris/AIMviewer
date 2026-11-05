-- D-196 (R10, decision A): enforce the IFC end types for every rel_type whose active edges all pass.
-- Not a migration yet: copy to supabase/migrations/ with a timestamp on Samuel's yes, after
--   select rel_type, count(*) from v_relationship_ifc_violations where active group by 1;
-- returns no row for the types below (5 Nov 16:52 UTC: no row at all).
-- rel_assigns_to_actor stays 'warn' until the ETL writes IfcActor nodes (D-196 point 4,
-- etl/transform.py writes person/organization -> object today).

do $$
declare n int;
begin
  select count(*) into n from v_relationship_ifc_violations
   where active and rel_type <> 'rel_assigns_to_actor';
  if n > 0 then
    raise exception 'D-196: % active edges fail the IFC rule; fix them before enforcing', n;
  end if;
end $$;

update public.relationship_types set ifc_check = 'enforce'
 where rel_type <> 'rel_assigns_to_actor' and ifc_check = 'warn';
