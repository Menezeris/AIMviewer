-- D-158 krok 8, dodatok (#372 follow-up): import .bcfzip zachová pôvodný dátum komentára.
-- PRIPRAVENÉ, na produkciu len na Samuelovo slovo (nie v supabase/migrations, nespúšťať z session).
-- Aditívne: nová funkcia, žiadny nový stĺpec ani zmena existujúcej `model_task_add_comment`.
-- Dátumy tém netreba migráciu: `model_tasks.created_at`/`updated_at` sa zapisujú priamo pri vložení.
-- Kód funguje aj pred touto migráciou (komentár dostane čas zápisu ako doteraz).
-- Rollback: drop function model_task_import_comment(uuid, text, text, timestamptz);

create or replace function model_task_import_comment(p_task uuid, p_author text, p_comment text, p_date timestamptz)
returns jsonb
language sql
volatile
as $$
  with c as (
    select jsonb_build_object(
      'guid', gen_random_uuid(),
      'author', p_author,
      'date', to_char(coalesce(p_date, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'comment', p_comment
    ) as v
  )
  update model_tasks t
     set comments = t.comments || jsonb_build_array(c.v)
    from c
   where t.id = p_task
  returning c.v;
$$;

comment on function model_task_import_comment(uuid, text, text, timestamptz) is
  'D-158 krok 8: pripojí BCF komentár s pôvodným dátumom z importu; na rozdiel od model_task_add_comment nemení updated_at ani modified_by témy. NULL = téma neexistuje.';

revoke all on function model_task_import_comment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function model_task_import_comment(uuid, text, text, timestamptz) to service_role;
