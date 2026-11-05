-- D-196 (R10, decision A): enforce the IFC end types for every rel_type whose active edges all pass.
-- Approved by Samuel on 5 Nov (~19:00 UTC, relayed under D-193, #60); applied by the orchestrator (D-198).
-- Was supabase/pending/relationship_ifc_enforce.sql.
-- rel_assigns_to_actor stays 'warn' until the ETL writes IfcActor nodes (D-196 point 4,
-- etl/transform.py writes person/organization -> object today).
-- Rollback: update public.relationship_types set ifc_check = 'warn' where ifc_check = 'enforce';
-- Test: supabase/tests/relationship_ifc_enforce.sql.

-- Guard: no active edge of an enforced rel_type may fail the IFC rule, or this migration stops.
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
