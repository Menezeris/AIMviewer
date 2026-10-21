-- D-122: uložené pohľady viewera (#72).
--
-- Pohľad je spoločný pre stavbu (nie osobný) a žije samostatne, nie pri BCF témach.
-- `viewpoint` má ten istý tvar ako `model_tasks.viewpoint` (D-099): kamera v IFC svete, rez,
-- režim, podlažie. Skryté a izolované prvky sú IFC GlobalId (strop 600 ako most viewera).
-- Riadok `kind = 'last'` je jediný "Posledný pohľad"; prepíše sa pri každom uložení a obnove.
-- Práva anon/authenticated nová tabuľka nedostane (default privileges, migrácia 20261016120000).

begin;

create table saved_views (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'saved' check (kind in ('saved', 'last')),
  name             text not null,
  description      text,
  viewpoint        jsonb not null,                        -- kamera, rez, režim, podlažie (D-099)
  selection        text[] not null default '{}',          -- IFC GlobalId výberu
  hidden           text[] not null default '{}',          -- IFC GlobalId skrytých prvkov
  isolated         text[],                                -- IFC GlobalId izolácie; NULL = bez izolácie
  model_revisions  jsonb not null default '{}'::jsonb,    -- {model: revízia} v čase uloženia (D-086)
  author           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_used_at     timestamptz                            -- posledná obnova
);

-- Meno je jedinečné bez ohľadu na veľkosť písmen; "Posledný pohľad" je najviac jeden.
create unique index uniq_saved_views_name on saved_views (lower(name)) where kind = 'saved';
create unique index uniq_saved_views_last on saved_views (kind) where kind = 'last';

comment on table saved_views is
  'D-122: uložené pohľady viewera, spoločné pre stavbu; kind=last = posledný použitý pohľad.';

commit;
