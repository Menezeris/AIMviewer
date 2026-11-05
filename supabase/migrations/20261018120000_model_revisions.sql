-- D-086 (F13): revisions of the federation IFC models and model-edit tasks.
--
-- The IFC file is the master (ASR, VZT). Each published version = an immutable compressed
-- copy in the bucket `ifc/archive/<model>/vNNN.ifc.gz` + a `model_revisions` row;
-- the current revision is additionally at the existing key `ifc/<model>.ifc` (viewer, engine
-- D-084 and ETL read it as before). Writing is done by `etl/model_publish.py` under
-- the model's advisory lock (compare-and-swap against the task base).
--
-- `model_tasks` = a model-edit task in the shape of a BCF topic (BCF API 2.1 topic/comment/viewpoint),
-- so that the BCF panel of the fork can create it in the next phase. anon/authenticated privileges
-- are not granted on the new tables (default privileges, migration 20261016120000).

create table model_tasks (
  id               uuid primary key default gen_random_uuid(),
  model            text not null,                         -- 'ASR', 'VZT' (key ifc/<model>.ifc)
  title            text not null,                         -- BCF topic.title
  description      text,                                  -- BCF topic.description
  components       text[] not null default '{}',          -- IFC GlobalId of the selection (BCF selection)
  viewpoint        jsonb,                                 -- BCF viewpoint (camera, section), later
  status           text not null default 'open'           -- BCF topic_status
                   check (status in ('open', 'in_progress', 'resolved', 'conflict', 'failed')),
  base_revision    integer,                               -- revision on which the task was created
  result_revision  integer,                               -- revision published by the task
  run_url          text,                                  -- GitHub Actions run (OCB)
  comments         jsonb not null default '[]'::jsonb,    -- BCF comments [{author, date, comment}]
  author           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_model_tasks_model_status on model_tasks (model, status);

create table model_revisions (
  id               uuid primary key default gen_random_uuid(),
  model            text not null,
  revision         integer not null check (revision >= 0),  -- vNNN (ASR continues the pipeline numbering)
  parent_revision  integer,                                 -- base; NULL for the first revision
  is_current       boolean not null default false,
  sha256           text not null,                           -- size of the uncompressed IFC
  size_bytes       bigint not null,
  archive_path     text not null,                           -- ifc/archive/<model>/vNNN.ifc.gz
  task_id          uuid references model_tasks (id),
  recipe_ref       text,                                    -- recipe in OCB (path@commit)
  summary          text,
  author           text,
  guard            jsonb,                                   -- result of the technical safeguard
  created_at       timestamptz not null default now(),
  unique (model, revision)
);

-- Exactly one current revision per model.
create unique index uniq_current_model_revision on model_revisions (model) where is_current;
