-- D-160: ručné priradenie a zrušenie odkazu popisku na výkrese (čísla miestností, značky typov,
-- názvy zón). Párovanie z textovej vrstvy (D-130) je odvodená AIM vrstva; toto je jediný nositeľ
-- ručnej opravy a má prednosť pred automatikou.
--
-- Kľúč riadku = dokument + strana + normalizovaný text popisku (+ voliteľný bbox v % strany).
-- Bez bbox platí pre všetky výskyty textu na strane. bbox platí len pri zhode revízie dokumentu
-- (`document_revision`, neskôr `document_sha256` ako kotva podľa D-158 krok 4); text-only
-- riadok prežije re-ETL. action 'assign' = popisok ukazuje na `target_id`, 'suppress' = odkaz
-- sa nezobrazí. Zrušenie ručnej opravy ukončí riadok (`valid_until`), história ostáva.
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).

create table drawing_link_overrides (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references objects(id) on delete set null,       -- document (D-104)
  document_ref      text,                                                 -- snímka object_ref dokumentu
  document_revision text,                                                 -- documents.revision v čase zápisu
  document_sha256   text,                                                 -- kotva revízie (D-158 krok 4), zatiaľ nullable
  page              integer not null check (page >= 1),
  text              text not null check (length(text) between 1 and 200), -- normalizovaný (bez diakritiky, malé písmená)
  bbox              jsonb check (bbox is null or jsonb_typeof(bbox) = 'object'),  -- {x, y, width, height} v %
  action            text not null check (action in ('assign', 'suppress')),
  target_id         uuid references objects(id) on delete set null,
  target_ref        text,                                                 -- snímka object_ref cieľa
  target_guid       text,                                                 -- snímka IFC GlobalId cieľa
  author            text,
  created_at        timestamptz not null default now(),
  valid_until       timestamptz,
  constraint drawing_link_overrides_target_check
    check (action = 'suppress' or target_ref is not null)
);

create unique index uq_drawing_link_overrides_live
  on drawing_link_overrides (document_id, page, text, coalesce(bbox::text, ''))
  where valid_until is null;
create index idx_drawing_link_overrides_doc on drawing_link_overrides (document_id, page)
  where valid_until is null;

comment on table drawing_link_overrides is
  'D-160: ručné priradenie (assign) alebo zrušenie (suppress) odkazu popisku výkresu; má prednosť pred párovaním D-130.';

revoke all on drawing_link_overrides from anon, authenticated;
grant all on drawing_link_overrides to service_role;
