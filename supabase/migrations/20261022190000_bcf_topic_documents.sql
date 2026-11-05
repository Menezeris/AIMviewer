-- D-158: link of a BCF topic to a document, page and page area (BCF DocumentReference).
--
-- The carrier of the topic stays `model_tasks` (D-099); this is a subordinate 1:N link, a topic has 0..n
-- references to documents. The IFC elements of the topic stay in `model_tasks.components` (the only carrier
-- of links to IFC). A document is an `objects` row of type document or document_reference (D-104);
-- when it ceases to exist the reference stays with a snapshot of the code, name and revision from the time of creation.
-- `region` = crop of the page in % (x, y, width, height, origin top left) like `open_drawing
-- region` (D-117); NULL = whole page. `url` = foreign link from a BCF import (document outside AIM).
-- anon/authenticated privileges are not granted on new objects (default privileges, migration 20261016120000).

create table model_task_documents (
  id                uuid primary key default gen_random_uuid(),           -- BCF DocumentReference guid
  task_id           uuid not null references model_tasks(id) on delete cascade,
  document_id       uuid references objects(id) on delete set null,       -- document | document_reference
  document_ref      text,                                                 -- object_ref / identification at the time of creation
  document_name     text,
  document_revision text,                                                 -- documents.revision at the time of creation
  page              integer check (page >= 1),
  region            jsonb check (region is null or jsonb_typeof(region) = 'object'),
  markup            jsonb check (markup is null or jsonb_typeof(markup) = 'array'),
  url               text,                                                 -- BCF ReferencedDocument / url
  description       text,                                                 -- BCF DocumentReference description
  author            text,
  created_at        timestamptz not null default now(),
  constraint model_task_documents_target_check
    check (document_id is not null or document_ref is not null or url is not null)
);

create index idx_model_task_documents_task on model_task_documents (task_id, created_at);
create index idx_model_task_documents_document on model_task_documents (document_id, page);

comment on table model_task_documents is
  'D-158: odkaz BCF témy (model_tasks) na dokument, stranu a oblasť strany (BCF DocumentReference).';

revoke all on model_task_documents from anon, authenticated;
grant all on model_task_documents to service_role;
