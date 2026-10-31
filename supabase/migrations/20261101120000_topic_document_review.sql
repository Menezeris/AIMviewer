-- D-158 krok 6: pripomienka na PDF sa pri novej revízii dokumentu prenáša, otvorená dostane príznak
-- "skontrolovať po revízii". Príznak sa NEUKLADÁ: odvodzuje sa pri čítaní z revízie odkazu
-- (`document_revision`, `document_sha256` = pôvodná revízia, nemenia sa) a aktuálnej revízie
-- dokumentu (`container_revisions`, D-183 K1 / `documents.file_sha256`). Ukladá sa len:
--   * kotva polohy (počet strán a veľkosť strany pôvodnej revízie) na hlásenie "poloha neistá",
--   * potvrdenie kontroly (revízia, kto, kedy), ktoré príznak zruší.
-- Všetko aditívne a nullable; staré odkazy bez kotvy sa porovnajú len podľa čísla strany.
-- Práva sa nemenia (tabuľka je len pre service_role, migrácia 20261022190000).

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

-- Spätné doplnenie kotvy z aktuálnych strán len pre odkazy, ktoré sú ešte pri svojej revízii
-- (sha256 odkazu = sha256 dokumentu); pri už zmenenej revízii pôvodnú hodnotu nepoznáme.
update model_task_documents t
   set anchor_pages = p.max_page,
       anchor_page_size = (select pp.page_size from document_pages pp where pp.document_id = t.document_id and pp.page = t.page)
  from documents d
  join (select document_id, max(page) as max_page from document_pages group by document_id) p on p.document_id = d.id
 where t.document_id = d.id and t.anchor_pages is null
   and t.document_sha256 is not null and t.document_sha256 = d.file_sha256;
