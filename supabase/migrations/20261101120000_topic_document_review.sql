-- D-158 step 6: a comment on a PDF is carried over on a new document revision, an open one gets the flag
-- "check after revision". The flag is NOT STORED: it is derived on read from the link revision
-- (`document_revision`, `document_sha256` = original revision, do not change) and the current revision of the
-- document (`container_revisions`, D-183 K1 / `documents.file_sha256`). Only these are stored:
--   * position anchor (page count and page size of the original revision) for the "position uncertain" report,
--   * review confirmation (revision, who, when), which cancels the flag.
-- All additive and nullable; old links without an anchor are compared only by page number.
-- Rights do not change (the table is for service_role only, migration 20261022190000).

alter table model_task_documents
  add column if not exists anchor_pages integer check (anchor_pages is null or anchor_pages >= 1),
  add column if not exists anchor_page_size jsonb
    check (anchor_page_size is null or (jsonb_typeof(anchor_page_size) = 'array' and jsonb_array_length(anchor_page_size) = 2)),
  add column if not exists reviewed_revision text,
  add column if not exists reviewed_sha256 text check (reviewed_sha256 is null or reviewed_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;

comment on column model_task_documents.anchor_pages is
  'D-158 krok 6: počet strán dokumentu v revízii, nad ktorou odkaz vznikol (poloha neistá, ak sa zmenil).';
comment on column model_task_documents.anchor_page_size is
  'D-158 krok 6: [šírka, výška] strany odkazu v bodoch v čase založenia.';
comment on column model_task_documents.reviewed_revision is
  'D-158 krok 6: revízia dokumentu, po ktorej človek potvrdil kontrolu (zruší príznak "skontrolovať po revízii").';

-- Backfill of the anchor from current pages only for links that are still at their revision
-- (link sha256 = document sha256); for an already changed revision we do not know the original value.
update model_task_documents t
   set anchor_pages = p.max_page,
       anchor_page_size = (select pp.page_size from document_pages pp where pp.document_id = t.document_id and pp.page = t.page)
  from documents d
  join (select document_id, max(page) as max_page from document_pages group by document_id) p on p.document_id = d.id
 where t.document_id = d.id and t.anchor_pages is null
   and t.document_sha256 is not null and t.document_sha256 = d.file_sha256;
