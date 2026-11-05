-- D-158 steps 3 and 4: document revision anchor and page size for the PDF crop snapshot.
--
-- `documents.file_sha256` = sha256 of the PDF file (`location`), filled by `etl/pdf_text.py --from-db`.
-- `model_task_documents.document_sha256` = sha256 of the document at the time the link was created: the crop
-- snapshot is cached under it (bucket `documents`, `snapshots/<sha256>/...`), so the topic stays
-- at its revision even after a new revision of the file (new file = new sha256 = new snapshot).
-- `document_pages.page_size` = [width, height] of the page in points (like `_georef.page_size`, D-133),
-- for the RFC 8118 `viewrect` in the document link; filled by the same ETL.
-- Everything is additive, nothing breaks without data (the snapshot is produced even without sha256, the link without viewrect).
-- anon/authenticated rights are unchanged (default privileges, migration 20261016120000).

alter table documents add column if not exists file_sha256 text
  check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

alter table model_task_documents add column if not exists document_sha256 text
  check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$');

alter table document_pages add column if not exists page_size jsonb
  check (page_size is null or (jsonb_typeof(page_size) = 'array' and jsonb_array_length(page_size) = 2));

comment on column documents.file_sha256 is
  'D-158: sha256 súboru PDF (location), kotva revízie; plní etl/pdf_text.py.';
comment on column model_task_documents.document_sha256 is
  'D-158: sha256 dokumentu v čase založenia odkazu (kľúč keše snímky výrezu).';
comment on column document_pages.page_size is
  'D-158: [šírka, výška] strany v bodoch PDF (RFC 8118 viewrect); plní etl/pdf_text.py.';
