-- D-158 kroky 3 a 4: kotva revízie dokumentu a veľkosť strán pre snímku výrezu PDF.
--
-- `documents.file_sha256` = sha256 súboru PDF (`location`), plní `etl/pdf_text.py --from-db`.
-- `model_task_documents.document_sha256` = sha256 dokumentu v čase založenia odkazu: snímka
-- výrezu sa kešuje pod ním (bucket `documents`, `snapshots/<sha256>/...`), takže téma ostane
-- pri svojej revízii aj po novej revízii súboru (nový súbor = nové sha256 = nová snímka).
-- `document_pages.page_size` = [šírka, výška] strany v bodoch (ako `_georef.page_size`, D-133),
-- pre RFC 8118 `viewrect` v odkaze na dokument; plní ten istý ETL.
-- Všetko aditívne, bez dát nič nepadá (snímka sa vyrobí aj bez sha256, odkaz bez viewrect).
-- Práva anon/authenticated sa nemenia (default privileges, migrácia 20261016120000).

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
