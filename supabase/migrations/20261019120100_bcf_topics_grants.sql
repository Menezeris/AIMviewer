-- D-099: privileges of the model_task_add_comment function like the other RPCs (SCHEMA §2.12).
-- The new function got EXECUTE for PUBLIC (the Postgres default), so the anon key could see it too.
-- It could not write (runs with the caller's privileges and cannot see the table), but the anon key must not
-- see any RPC.
revoke all on function model_task_add_comment(uuid, text, text) from public, anon, authenticated;
grant execute on function model_task_add_comment(uuid, text, text) to service_role;
