-- =============================================================================
-- D-063 - Document content: `document_pages` + RPC `search_documents`
-- =============================================================================
-- Documents were until now only metadata (CDE name, D-036) + E4 regions - questions
-- about the CONTENT of PDFs (legends, specifications, labels) were in principle
-- unanswerable. Text extraction is done by `etl/pdf_text.py` (PyMuPDF - already an
-- ETL dependency, D-041), per page; searched by RPC (FTS, same normalization
-- as D-059: lower + f_unaccent).
--
-- Honest expectation (D-063): drawings are mostly vector graphics - text is
-- sparse (legends, corner stamps, labels). OCR is out of scope. A document without
-- a local source PDF has no pages - the tool says so.
--
-- Migrations are ADDITIVE - this file is never edited.

begin;

create table document_pages (
  document_id uuid not null references objects(id) on delete cascade,
  page        int  not null check (page >= 1),
  text        text not null,     -- normalized text of the page (extracted, not OCR)
  primary key (document_id, page)
);

comment on table document_pages is
  'D-063: extrahovaný text PDF strán (etl/pdf_text.py) — fulltext nad obsahom dokumentov.';

-- Same normalization as search_text (D-059): unaccent → lower.
create index idx_document_pages_tsv on document_pages
  using gin (to_tsvector('simple', lower(f_unaccent(text))));

-- RPC for the LLM tool (parameterized, row-cap 50). Also returns the document identity
-- (join to objects) - one call, no name lookups.
create or replace function search_documents(
  q text,
  max_rows int default 10
)
returns table (
  document_id uuid,
  document_ref text,
  document_name text,
  page int,
  rank real,
  snippet text
)
language sql stable
set search_path = public
as $$
  with nq as (
    select lower(f_unaccent(btrim(q))) as t
  )
  select dp.document_id,
         o.object_ref,
         o.name,
         dp.page,
         ts_rank(to_tsvector('simple', lower(f_unaccent(dp.text))),
                 websearch_to_tsquery('simple', (select t from nq)))::real as rank,
         ts_headline('simple', lower(f_unaccent(dp.text)),
                     websearch_to_tsquery('simple', (select t from nq)),
                     'MaxFragments=2, MaxWords=14, MinWords=4') as snippet
  from document_pages dp
  join objects o on o.id = dp.document_id
  where length((select t from nq)) >= 2
    and to_tsvector('simple', lower(f_unaccent(dp.text)))
        @@ websearch_to_tsquery('simple', (select t from nq))
  order by rank desc, dp.page
  limit least(greatest(coalesce(max_rows, 10), 1), 50);
$$;

comment on function search_documents(text, int) is
  'D-063: fulltext nad extrahovaným textom PDF strán (document_pages), so snippetom a identitou dokumentu.';

commit;

-- PostgREST must see the new table/RPC without a restart (Supabase).
notify pgrst, 'reload schema';
