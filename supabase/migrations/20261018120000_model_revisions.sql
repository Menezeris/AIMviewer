-- D-086 (F13): revízie IFC modelov federácie a úlohy úprav modelu.
--
-- IFC súbor je master (ASR, VZT). Každá zverejnená verzia = nemenná skomprimovaná
-- kópia v buckete `ifc/archive/<model>/vNNN.ifc.gz` + riadok `model_revisions`;
-- aktuálna revízia je navyše na doterajšom kľúči `ifc/<model>.ifc` (viewer, motor
-- D-084 aj ETL čítajú ako doteraz). Zápis robí `etl/model_publish.py` pod
-- advisory lockom modelu (compare-and-swap voči základu úlohy).
--
-- `model_tasks` = úloha úpravy v tvare BCF témy (BCF API 2.1 topic/comment/viewpoint),
-- aby ju v ďalšej fáze vedel založiť aj BCF panel forku. Práva anon/authenticated
-- nové tabuľky nedostanú (default privileges, migrácia 20261016120000).

create table model_tasks (
  id               uuid primary key default gen_random_uuid(),
  model            text not null,                         -- 'ASR', 'VZT' (kľúč ifc/<model>.ifc)
  title            text not null,                         -- BCF topic.title
  description      text,                                  -- BCF topic.description
  components       text[] not null default '{}',          -- IFC GlobalId výberu (BCF selection)
  viewpoint        jsonb,                                 -- BCF viewpoint (kamera, rez), neskôr
  status           text not null default 'open'           -- BCF topic_status
                   check (status in ('open', 'in_progress', 'resolved', 'conflict', 'failed')),
  base_revision    integer,                               -- revízia, nad ktorou úloha vznikla
  result_revision  integer,                               -- revízia, ktorú úloha zverejnila
  run_url          text,                                  -- beh GitHub Actions (OCB)
  comments         jsonb not null default '[]'::jsonb,    -- BCF comments [{author, date, comment}]
  author           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_model_tasks_model_status on model_tasks (model, status);

create table model_revisions (
  id               uuid primary key default gen_random_uuid(),
  model            text not null,
  revision         integer not null check (revision >= 0),  -- vNNN (ASR pokračuje číslovaním pipeline)
  parent_revision  integer,                                 -- základ; NULL pri prvej revízii
  is_current       boolean not null default false,
  sha256           text not null,                           -- obsah nekomprimovaného IFC
  size_bytes       bigint not null,
  archive_path     text not null,                           -- ifc/archive/<model>/vNNN.ifc.gz
  task_id          uuid references model_tasks (id),
  recipe_ref       text,                                    -- recept v OCB (cesta@commit)
  summary          text,
  author           text,
  guard            jsonb,                                   -- výsledok technickej poistky
  created_at       timestamptz not null default now(),
  unique (model, revision)
);

-- Práve jedna aktuálna revízia na model.
create unique index uniq_current_model_revision on model_revisions (model) where is_current;
