-- D-158 step 8, addendum (#372 follow-up): .bcfzip import keeps the original comment date and GUID and is idempotent.
-- APPLIED to production by the orchestrator (1. 11. 2026), file moved from supabase/pending.
-- Additive: a new function, no new column or change to the existing `model_task_add_comment`.
-- Topic dates need no migration: `model_tasks.created_at`/`updated_at` are written directly on insert.
-- The code works even before this migration (the comment gets the write time and a new guid; duplicates are held back by author + text match).
-- Rollback: drop function model_task_import_comment(uuid, text, text, timestamptz, uuid);

create or replace function model_task_import_comment(
  p_task uuid,
  p_author text,
  p_comment text,
  p_date timestamptz,
  p_guid uuid default null
)
returns jsonb
language plpgsql
volatile
as $$
declare
  g uuid := coalesce(p_guid, gen_random_uuid());
  cur jsonb;
  c jsonb;
begin
  -- riadok sa zamkne, takže dva súbežné importy toho istého komentára ho nepridajú dvakrát
  select t.comments into cur from model_tasks t where t.id = p_task for update;
  if not found then
    return null;
  end if;
  -- komentár s týmto guid už v téme je: nepridávaj, vráť existujúci
  select e into c from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) e where lower(e->>'guid') = lower(g::text) limit 1;
  if c is not null then
    return c;
  end if;
  c := jsonb_build_object(
    'guid', g,
    'author', p_author,
    'date', to_char(coalesce(p_date, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'comment', p_comment
  );
  update model_tasks t set comments = coalesce(t.comments, '[]'::jsonb) || jsonb_build_array(c) where t.id = p_task;
  return c;
end;
$$;

comment on function model_task_import_comment(uuid, text, text, timestamptz, uuid) is
  'D-158 krok 8: pripojí BCF komentár s pôvodným dátumom a guid z importu; komentár s rovnakým guid v téme nepridá znova (vráti existujúci). Na rozdiel od model_task_add_comment nemení updated_at ani modified_by témy. NULL = téma neexistuje.';

revoke all on function model_task_import_comment(uuid, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function model_task_import_comment(uuid, text, text, timestamptz, uuid) to service_role;
