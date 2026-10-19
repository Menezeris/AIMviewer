-- D-099: `model_tasks` ako BCF témy nad modelmi federácie.
--
-- Jedna tabuľka pre všetky témy (kolízia, pripomienka, úprava modelu); úprava modelu je
-- téma priradená Claudovi, ktorá spustí Claude session (routine "AIM: BCF téma").
-- Polia podľa BCF API 2.1 topic; `etl/model_publish.py --task` tému uzatvára ako doteraz.
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).

-- Téma nad celou federáciou (výber z ASR aj VZT) nemá jeden model.
alter table model_tasks alter column model drop not null;

alter table model_tasks
  add column number      bigint generated always as identity,  -- BCF topic.index, "téma #12"
  add column topic_type  text not null default 'Issue',         -- BCF topic_type
  add column priority    text,                                  -- BCF priority
  add column assigned_to text,                                  -- BCF assigned_to; 'claude' spustí session
  add column due_date    date,                                  -- BCF due_date
  add column labels      text[] not null default '{}',          -- BCF labels
  add column stage       text,                                  -- BCF stage
  add column modified_by text,                                  -- BCF modified_author
  add column session_url text;                                  -- Claude session, ktorá tému rieši

-- BCF topic_status; 'closed' = uzavretá bez revízie (vybavené, neopravuje sa).
alter table model_tasks drop constraint model_tasks_status_check;
alter table model_tasks add constraint model_tasks_status_check
  check (status in ('open', 'in_progress', 'resolved', 'closed', 'conflict', 'failed'));

create unique index uniq_model_tasks_number on model_tasks (number);
create index idx_model_tasks_assigned_status on model_tasks (lower(assigned_to), status);

-- Komentár sa pripája atomicky: session aj človek môžu písať naraz (read-modify-write
-- celého poľa v aplikácii by jeden z nich stratil). Vráti pridaný komentár, NULL = téma nie je.
-- Nie je security definer, preto bez pevného search_path (beží s právami volajúceho).
create or replace function model_task_add_comment(p_task uuid, p_author text, p_comment text)
returns jsonb
language sql
volatile
as $$
  with c as (
    select jsonb_build_object(
      'guid', gen_random_uuid(),
      'author', p_author,
      'date', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'comment', p_comment
    ) as v
  )
  update model_tasks t
     set comments = t.comments || jsonb_build_array(c.v),
         modified_by = p_author,
         updated_at = now()
    from c
   where t.id = p_task
  returning c.v;
$$;

comment on function model_task_add_comment(uuid, text, text) is
  'D-099: pripojí BCF komentár k téme (model_tasks) atomicky; NULL = téma neexistuje.';
