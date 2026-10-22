-- D-158: väzba BCF témy na dokument, stranu a oblasť strany (BCF DocumentReference).
--
-- Nositeľ témy ostáva `model_tasks` (D-099); toto je podriadená väzba 1:N, téma má 0..n
-- odkazov na dokumenty. Prvky IFC témy ostávajú v `model_tasks.components` (jediný nositeľ
-- väzby na IFC). Dokument je `objects` riadok typu document alebo document_reference (D-104);
-- pri jeho zániku odkaz ostáva so snímkou kódu, názvu a revízie z času založenia.
-- `region` = výrez strany v % (x, y, width, height, počiatok vľavo hore) ako `open_drawing
-- region` (D-117); NULL = celá strana. `url` = cudzí odkaz z BCF importu (dokument mimo AIM).
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).

create table model_task_documents (
  id                uuid primary key default gen_random_uuid(),           -- BCF DocumentReference guid
  task_id           uuid not null references model_tasks(id) on delete cascade,
  document_id       uuid references objects(id) on delete set null,       -- document | document_reference
  document_ref      text,                                                 -- object_ref / identification v čase založenia
  document_name     text,
  document_revision text,                                                 -- documents.revision v čase založenia
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
