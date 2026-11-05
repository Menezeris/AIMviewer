-- D-099: `model_tasks` as BCF topics over the federation models.
--
-- One table for all topics (clash, comment, model edit); a model edit is a
-- topic assigned to Claude, which starts a Claude session (routine "AIM: BCF téma").
-- Fields per BCF API 2.1 topic; `etl/model_publish.py --task` closes the topic as before.
-- anon/authenticated privileges are not granted on new objects (default privileges, migration 20261016120000).

-- A topic over the whole federation (selection from both ASR and VZT) has no single model.
alter table model_tasks alter column model drop not null;

alter table model_tasks
  add column number      bigint generated always as identity,  -- BCF topic.index, "topic #12"
  add column topic_type  text not null default 'Issue',         -- BCF topic_type
  add column priority    text,                                  -- BCF priority
  add column assigned_to text,                                  -- BCF assigned_to; 'claude' starts a session
  add column due_date    date,                                  -- BCF due_date
  add column labels      text[] not null default '{}',          -- BCF labels
  add column stage       text,                                  -- BCF stage
  add column modified_by text,                                  -- BCF modified_author
  add column session_url text;                                  -- Claude session that works on the topic

-- BCF topic_status; 'closed' = closed without a revision (handled, not being fixed).
alter table model_tasks drop constraint model_tasks_status_check;
alter table model_tasks add constraint model_tasks_status_check
  check (status in ('open', 'in_progress', 'resolved', 'closed', 'conflict', 'failed'));

create unique index uniq_model_tasks_number on model_tasks (number);
create index idx_model_tasks_assigned_status on model_tasks (lower(assigned_to), status);

-- A comment is appended atomically: a session and a human can write at the same time (read-modify-write
-- of the whole array in the application would lose one of them). Returns the added comment, NULL = no such topic.
-- Not security definer, hence without a fixed search_path (runs with the caller's privileges).
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
