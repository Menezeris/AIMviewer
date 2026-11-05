-- D-160: manual assignment and suppression of a label link on a drawing (room numbers, type marks,
-- zone names). Matching from the text layer (D-130) is a derived AIM layer; this is the only carrier
-- of a manual correction and it takes precedence over the automation.
--
-- Row key = document + page + normalized label text (+ optional bbox in % of the page).
-- Without bbox it applies to all occurrences of the text on the page. bbox applies only when the document
-- revision matches (`document_revision`, later `document_sha256` as the anchor per D-158 step 4); a text-only
-- row survives re-ETL. action 'assign' = the label points to `target_id`, 'suppress' = the link
-- is not shown. Cancelling a manual correction ends the row (`valid_until`), history stays.
-- anon/authenticated get no rights on new objects (default privileges, migration 20261016120000).

create table drawing_link_overrides (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references objects(id) on delete set null,       -- document (D-104)
  document_ref      text,                                                 -- snapshot of the document object_ref
  document_revision text,                                                 -- documents.revision at the time of writing
  document_sha256   text,                                                 -- revision anchor (D-158 step 4), nullable for now
  page              integer not null check (page >= 1),
  text              text not null check (length(text) between 1 and 200), -- normalized (no diacritics, lower case)
  bbox              jsonb check (bbox is null or jsonb_typeof(bbox) = 'object'),  -- {x, y, width, height} in %
  action            text not null check (action in ('assign', 'suppress')),
  target_id         uuid references objects(id) on delete set null,
  target_ref        text,                                                 -- snapshot of the target object_ref
  target_guid       text,                                                 -- snapshot of the target IFC GlobalId
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
