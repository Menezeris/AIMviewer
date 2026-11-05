-- =============================================================================
-- D-059 - Fulltext over everything: `objects.search_text` + RPC `search_everything`
-- =============================================================================
-- Goal: parity with a human who scans the properties panel by eye - the LLM must be able to
-- find a keyword ANYWHERE in the content of a node (name, object_ref, IFC typology,
-- all psets including CUSTOM - keys and values), without knowing the JSONB structure.
-- search_objects stays for identity/typology; this layer searches property content.
--
-- Mechanics:
--   1. `f_unaccent`      - IMMUTABLE wrapper over unaccent (the extension function is
--                          only STABLE → cannot be used in a generated column/index).
--   2. `f_object_search_text` - IMMUTABLE flattener of a node into normalized text
--                          (lower + unaccent); reserved `_keys` (D-022)
--                          omitted - e.g. `_drawing_links` (hundreds of regions of
--                          coordinates) would drown the signal.
--   3. `objects.search_text` - STORED generated column (at ~10^3 rows the
--                          bloat is irrelevant; it recomputes itself on update).
--   4. GIN indexes - tsvector (fulltext) + pg_trgm (typos/substrings).
--   5. RPC `search_everything` - combined ranking FTS + word_similarity,
--                          also returns `matched_properties` (WHICH pset/property
--                          matched - proof for the trust loop) and `headline` (excerpt).
--
-- Writes: ETL (`etl/db.py`) and seed insert with an explicit column list,
-- the generated column does not affect them. The LLM tool calls the RPC via parameters (no SQL
-- splicing). Migrations are ADDITIVE - this file is never edited.

begin;

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent(text) is STABLE (depends on search_path for the dictionary) → immutable wrapper
-- with an explicitly qualified dictionary (standard pattern for indexes/generated cols).
create or replace function f_unaccent(text)
returns text
language sql immutable parallel safe strict
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Flatten a node into search text: identity + IFC typology + all psets
-- (pset name + whole JSON content = keys and values). Deterministic order.
create or replace function f_object_search_text(
  p_name text,
  p_object_ref text,
  p_ifc_type text,
  p_predefined_type text,
  p_user_defined_type text,
  p_properties jsonb
) returns text
language sql immutable parallel safe
as $$
  select lower(f_unaccent(concat_ws(' ',
    p_name, p_object_ref, p_ifc_type, p_predefined_type, p_user_defined_type,
    (select string_agg(p.key || ' ' || p.value::text, ' ' order by p.key)
     from jsonb_each(coalesce(p_properties, '{}'::jsonb)) p
     where p.key !~ '^_')
  )))
$$;

alter table objects add column search_text text
  generated always as (
    f_object_search_text(name, object_ref, ifc_type, predefined_type,
                         user_defined_type, properties)
  ) stored;

create index idx_objects_search_tsv on objects
  using gin (to_tsvector('simple', search_text));
create index idx_objects_search_trgm on objects
  using gin (search_text gin_trgm_ops);

-- RPC: combined search. An FTS hit (websearch syntax, 'simple' config -
-- no Slovak stemmer exists, trigram approximates morphology) ranks above fuzzy;
-- the fuzzy branch (word_similarity) catches typos and substrings. Row-cap 50 (D-005).
create or replace function search_everything(
  q text,
  object_types text[] default null,
  max_rows int default 20
)
returns table (
  id uuid,
  object_type text,
  object_ref text,
  name text,
  ifc_type text,
  predefined_type text,
  score real,
  match_kind text,
  headline text,
  matched_properties jsonb
)
language sql stable
set search_path = public
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with nq as (
    select lower(f_unaccent(btrim(q))) as t
  ),
  words as (
    select w
    from regexp_split_to_table((select t from nq), '\s+') as w
    where length(w) >= 2
  ),
  fts as (
    select o.id,
           ts_rank(to_tsvector('simple', o.search_text),
                   websearch_to_tsquery('simple', (select t from nq))) as r
    from objects o
    where length((select t from nq)) >= 2
      and to_tsvector('simple', o.search_text)
          @@ websearch_to_tsquery('simple', (select t from nq))
  ),
  trgm as (
    select o.id, word_similarity((select t from nq), o.search_text) as s
    from objects o
    where length((select t from nq)) >= 2
      and (select t from nq) <% o.search_text
  ),
  ranked as (
    select coalesce(f.id, t.id) as id,
           -- FTS zásah vždy nad čisto fuzzy zásahom (+1.0), v rámci vetvy ranking
           (coalesce(t.s, 0)
            + case when f.id is not null then 1.0 + coalesce(f.r, 0) else 0 end)::real
             as score,
           case when f.id is not null then 'fulltext' else 'fuzzy' end as match_kind
    from fts f
    full join trgm t using (id)
  )
  select o.id, o.object_type, o.object_ref, o.name, o.ifc_type, o.predefined_type,
         r.score, r.match_kind,
         case when r.match_kind = 'fulltext'
              then ts_headline('simple', o.search_text,
                     websearch_to_tsquery('simple', (select t from nq)),
                     'MaxFragments=2, MaxWords=12, MinWords=4')
              end as headline,
         -- Dôkaz pre trust loop: ktoré psety/properties nesú hľadané slovo
         -- (lateral len nad vrátenými riadkami — lacné pri row-cape 50).
         (select jsonb_agg(m) from (
            select jsonb_build_object('pset', p.key, 'property', a.key,
                                      'value', a.value) as m
            from jsonb_each(o.properties) p
            cross join lateral jsonb_each(p.value) a
            where p.key !~ '^_'
              and jsonb_typeof(p.value) = 'object'
              and exists (
                select 1 from words w
                where lower(f_unaccent(p.key || ' ' || a.key || ' ' || (a.value #>> '{}')))
                      like '%' || w.w || '%')
            limit 3
          ) sub) as matched_properties
  from ranked r
  join objects o on o.id = r.id
  where object_types is null or o.object_type = any(object_types)
  order by r.score desc
  limit least(greatest(coalesce(max_rows, 20), 1), 50);
$$;

comment on function search_everything(text, text[], int) is
  'D-059: fulltext+fuzzy vyhľadávanie nad search_text (identita + všetky psety), s dôkazom matched_properties.';

commit;

-- PostgREST must see the RPC without a restart (Supabase).
notify pgrst, 'reload schema';
