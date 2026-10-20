-- =============================================================================
-- D-123 - Text dokumentov s polohou: `document_pages.blocks` + `search_documents`
-- v jednom dokumente
-- =============================================================================
-- `document_pages` bolo v produkcii prázdne: etl/pdf_text.py čítal len starý
-- manifest (E3), dokumenty z IFC (D-104) v ňom nie sú. Všetky ich PDF majú
-- textovú vrstvu, OCR netreba. `python -m etl.pdf_text --from-db` ich načíta zo
-- storage a k textu strany uloží riadky s polohou:
--   blocks = [{t: text riadku, x, y, w, h: bbox v % strany, počiatok vľavo hore}]
-- Tool z nich vráti výrez pre open_drawing region (D-117).
--
-- search_documents dostane voliteľný doc_id (hľadanie len v jednom dokumente) a
-- slová dopytu hľadá ako prefixy so skrátenou koncovkou: slovenčina sa skloňuje
-- a 'simple' konfigurácia nemá stemming, takže "požiarna odolnosť" predtým
-- nenašla "požiarnej odolnosti".
-- Nová signatúra = drop + create (stará by ostala ako preťaženie a PostgREST by
-- volanie s dvoma parametrami nevedel jednoznačne priradiť).
--
-- Migrácie sú ADITÍVNE - tento súbor sa nikdy needituje.

begin;

alter table document_pages add column if not exists blocks jsonb;

comment on column document_pages.blocks is
  'D-123: riadky textu strany s polohou [{t, x, y, w, h}] v % strany (počiatok vľavo hore), etl/pdf_text.py.';

drop function if exists search_documents(text, int);

create or replace function search_documents(
  q text,
  max_rows int default 10,
  doc_id uuid default null
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
  ),
  -- Slová dopytu ako prefixy (rovnaký parser ako index). Slovo z písmen od 6
  -- znakov stratí posledné 2 (hrubá náhrada stemmingu pre skloňovanie):
  -- "poziarna odolnost" nájde "poziarnej odolnosti", "keramick" aj "keramicke".
  -- Kódy a čísla (dd01, ei30, 1.05) ostávajú celé.
  tq as (
    select to_tsquery('simple', string_agg(
             quote_literal(case when lexeme ~ '^[a-z]+$' and length(lexeme) >= 6
                                then left(lexeme, length(lexeme) - 2)
                                else lexeme end) || ':*',
             ' & ')) as query
    from unnest(to_tsvector('simple', (select t from nq)))
  )
  select dp.document_id,
         o.object_ref,
         o.name,
         dp.page,
         ts_rank(to_tsvector('simple', lower(f_unaccent(dp.text))),
                 (select query from tq))::real as rank,
         ts_headline('simple', lower(f_unaccent(dp.text)),
                     (select query from tq),
                     'MaxFragments=2, MaxWords=14, MinWords=4') as snippet
  from document_pages dp
  join objects o on o.id = dp.document_id
  where o.valid_until is null
    and (doc_id is null or dp.document_id = doc_id)
    and length((select t from nq)) >= 2
    and (select query from tq) is not null
    and to_tsvector('simple', lower(f_unaccent(dp.text))) @@ (select query from tq)
  order by rank desc, dp.page
  limit least(greatest(coalesce(max_rows, 10), 1), 50);
$$;

comment on function search_documents(text, int, uuid) is
  'D-063/D-123: fulltext nad extrahovaným textom PDF strán (document_pages), voliteľne v jednom dokumente.';

-- Práva ako ostatné RPC (migrácia 20261016120000): len service_role.
revoke all on function search_documents(text, int, uuid) from anon, authenticated, public;
grant execute on function search_documents(text, int, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
