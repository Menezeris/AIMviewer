-- D-099: práva funkcie model_task_add_comment ako ostatné RPC (SCHEMA §2.12).
-- Nová funkcia dostala EXECUTE pre PUBLIC (predvolené v Postgrese), takže ju videl aj anon kľúč.
-- Zapisovať by nemohol (beží s právami volajúceho a tabuľku nevidí), ale anon kľúč nemá
-- vidieť žiadnu RPC.
revoke all on function model_task_add_comment(uuid, text, text) from public, anon, authenticated;
grant execute on function model_task_add_comment(uuid, text, text) to service_role;
