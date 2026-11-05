-- D-122: saved viewer views (#72).
--
-- A view is shared for the building (not personal) and lives on its own, not with BCF topics.
-- `viewpoint` has the same shape as `model_tasks.viewpoint` (D-099): camera in the IFC world, section,
-- mode, floor. Hidden and isolated elements are IFC GlobalIds (cap 600 as the viewer bridge).
-- The row `kind = 'last'` is the single "Posledný pohľad" (last view); it is overwritten on every save and restore.
-- anon/authenticated privileges are not granted on the new table (default privileges, migration 20261016120000).

begin;

create table saved_views (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'saved' check (kind in ('saved', 'last')),
  name             text not null,
  description      text,
  viewpoint        jsonb not null,                        -- camera, section, mode, floor (D-099)
  selection        text[] not null default '{}',          -- IFC GlobalIds of the selection
  hidden           text[] not null default '{}',          -- IFC GlobalIds of hidden elements
  isolated         text[],                                -- IFC GlobalIds of the isolation; NULL = no isolation
  model_revisions  jsonb not null default '{}'::jsonb,    -- {model: revision} at the time of saving (D-086)
  author           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_used_at     timestamptz                            -- last restore
);

-- The name is unique regardless of letter case; there is at most one "Posledný pohľad" (last view).
create unique index uniq_saved_views_name on saved_views (lower(name)) where kind = 'saved';
create unique index uniq_saved_views_last on saved_views (kind) where kind = 'last';

comment on table saved_views is
  'D-122: uložené pohľady viewera, spoločné pre stavbu; kind=last = posledný použitý pohľad.';

commit;
