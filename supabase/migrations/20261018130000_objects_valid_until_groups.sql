-- D-087: platnosť objektov (zaniknuté prvky modelu) + projekt, zóny a skupiny ako uzly AIM.
--
-- 1) `objects.valid_until`: objekt, ktorý žiadny model federácie už nevydáva (zmazaný
--    alebo premenovaný prvok), ETL uzavrie (`etl.main --model`, `model_publish close-legacy`).
--    Riadok ostáva (Master UUID, D-010), ale views a RPC nad `objects` ho nevidia.
-- 2) Manifest vzťahov (`etl/manifest.py`) povoľuje nové object_type `project`, `zone`,
--    `spatial_zone`, `group` (IfcProject, IfcZone, IfcSpatialZone, IfcGroup) na hranách.
-- 3) Views a RPC nad `objects` filtrujú `valid_until is null` (definície prevzaté z
--    predošlých migrácií, zmenený je len filter).

begin;

-- Načíta knižnicu pg_trgm: bez nej rola bez superusera (Management API, `supabase db push`)
-- nesmie pri create function nastaviť `pg_trgm.word_similarity_threshold` (search_everything).
select word_similarity('a', 'a');

alter table objects add column valid_until timestamptz;   -- NULL = objekt existuje v modeli
comment on column objects.valid_until is
  'Kedy objekt zanikol (už ho nevydáva žiadny model federácie, D-087). NULL = platný.';
create index idx_objects_retired on objects (valid_until) where valid_until is not null;

-- 2) relationship_types podľa manifestu (python -m etl.manifest)
update relationship_types set
  from_object_types = array['site', 'building', 'floor', 'space', 'spatial_zone', 'group'],
  to_object_types = array['project', 'site', 'building', 'floor', 'spatial_zone', 'group'],
  description = 'Dekompozícia Project→Site→Building→Floor→Space (D-013), časti priestorovej zóny a skupiny (D-087).'
where rel_type = 'rel_aggregates';
update relationship_types set
  from_object_types = array['asset', 'spatial_zone'],
  to_object_types = array['floor', 'space'],
  description = 'Fyzický prvok (asset) alebo priestorová zóna v priestorovej štruktúre.'
where rel_type = 'rel_contained_in_spatial_structure';
update relationship_types set
  from_object_types = array['asset', 'space', 'spatial_zone'],
  to_object_types = array['space', 'floor', 'building', 'site', 'spatial_zone'],
  description = 'Prvok sa nachádza (aj) v priestorovej štruktúre — neexkluzívne; odvodené geometriou naprieč federáciou (D-080) alebo zo súboru, napr. priestor v priestorovej zóne (D-087).'
where rel_type = 'rel_referenced_in_spatial_structure';
update relationship_types set
  from_object_types = array['project', 'site', 'building', 'floor', 'space', 'asset', 'asset_type', 'zone', 'spatial_zone', 'group'],
  to_object_types = array['document'],
  description = 'Väzba objekt → dokument (D-014); role=''drawing'' pre E4.'
where rel_type = 'rel_associates_document';
update relationship_types set
  from_object_types = array['person', 'organization'],
  to_object_types = array['project', 'site', 'building', 'floor', 'space', 'asset', 'asset_type', 'document', 'zone', 'spatial_zone', 'group'],
  description = 'Zodpovednosti (D-020); role = acting rola.'
where rel_type = 'rel_assigns_to_actor';
update relationship_types set
  from_object_types = array['asset', 'space', 'zone', 'spatial_zone'],
  to_object_types = array['system', 'zone', 'group'],
  description = 'Členstvo v systéme (D-047), zóne alebo skupine (D-087).'
where rel_type = 'rel_assigns_to_group';

-- 3a) views
create or replace view v_actors as
SELECT id,
    object_type,
    object_ref,
    name,
    ifc_guid,
    ifc_type,
    predefined_type,
    user_defined_type,
    properties,
    created_at,
    updated_at
   FROM objects
  WHERE object_type = ANY (ARRAY['person'::text, 'organization'::text]) AND valid_until IS NULL;

create or replace view v_asset_classifications as
SELECT occ.id AS object_id,
    rc.to_id AS classification_ref_id,
    'occurrence'::text AS level
   FROM objects occ
     JOIN rel_associates_classification rc ON rc.from_id = occ.id AND rc.valid_until IS NULL
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL
UNION
 SELECT occ.id AS object_id,
    rc.to_id AS classification_ref_id,
    'type'::text AS level
   FROM objects occ
     JOIN rel_defines_by_type dt ON dt.from_id = occ.id AND dt.valid_until IS NULL
     JOIN rel_associates_classification rc ON rc.from_id = dt.to_id AND rc.valid_until IS NULL
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL;

create or replace view v_asset_effective as
SELECT occ.id,
    occ.object_ref,
    occ.name,
    occ.ifc_type,
        CASE
            WHEN typ.predefined_type IS NOT NULL AND typ.predefined_type <> 'NOTDEFINED'::text THEN typ.predefined_type
            ELSE occ.predefined_type
        END AS predefined_type,
        CASE
            WHEN typ.predefined_type IS NOT NULL AND typ.predefined_type <> 'NOTDEFINED'::text THEN typ.user_defined_type
            ELSE occ.user_defined_type
        END AS user_defined_type,
    jsonb_deep_merge(typ.properties, occ.properties) AS properties,
    typ.id AS type_id,
    typ.name AS type_name
   FROM objects occ
     LEFT JOIN rel_defines_by_type r ON r.from_id = occ.id AND r.valid_until IS NULL
     LEFT JOIN objects typ ON typ.id = r.to_id
  WHERE occ.object_type = 'asset'::text AND occ.valid_until IS NULL;

create or replace view v_floors as
SELECT o.id,
    o.object_type,
    o.object_ref,
    o.name,
    o.ifc_guid,
    o.ifc_type,
    o.predefined_type,
    o.user_defined_type,
    o.properties,
    o.created_at,
    o.updated_at,
    f.elevation
   FROM objects o
     JOIN floors f USING (id)
  WHERE o.valid_until IS NULL;

create or replace view v_property_dictionary as
SELECT o.object_type,
    o.ifc_type,
    p.key AS pset,
    a.key AS property,
    jsonb_typeof(a.value) AS value_type,
    count(*)::integer AS object_count,
    count(DISTINCT a.value)::integer AS distinct_values,
    (array_agg(DISTINCT "left"(a.value #>> '{}'::text[], 60)))[1:5] AS sample_values,
    min(
        CASE
            WHEN jsonb_typeof(a.value) = 'number'::text THEN (a.value #>> '{}'::text[])::numeric
            ELSE NULL::numeric
        END) AS min_number,
    max(
        CASE
            WHEN jsonb_typeof(a.value) = 'number'::text THEN (a.value #>> '{}'::text[])::numeric
            ELSE NULL::numeric
        END) AS max_number
   FROM objects o
     CROSS JOIN LATERAL jsonb_each(o.properties) p(key, value)
     CROSS JOIN LATERAL jsonb_each(p.value) a(key, value)
  WHERE o.valid_until IS NULL AND p.key !~ '^_'::text AND jsonb_typeof(p.value) = 'object'::text
  GROUP BY o.object_type, o.ifc_type, p.key, a.key, (jsonb_typeof(a.value));

create or replace view v_spaces as
SELECT o.id,
    o.object_type,
    o.object_ref,
    o.name,
    o.ifc_guid,
    o.ifc_type,
    o.predefined_type,
    o.user_defined_type,
    o.properties,
    o.created_at,
    o.updated_at,
    s.long_name
   FROM objects o
     JOIN spaces s USING (id)
  WHERE o.valid_until IS NULL;

-- 3b) RPC
CREATE OR REPLACE FUNCTION public.search_everything(q text, object_types text[] DEFAULT NULL::text[], max_rows integer DEFAULT 20)
 RETURNS TABLE(id uuid, object_type text, object_ref text, name text, ifc_type text, predefined_type text, score real, match_kind text, headline text, matched_properties jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
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
  where o.valid_until is null
    and (object_types is null or o.object_type = any(object_types))
  order by r.score desc
  limit least(greatest(coalesce(max_rows, 20), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.search_documents(q text, max_rows integer DEFAULT 10)
 RETURNS TABLE(document_id uuid, document_ref text, document_name text, page integer, rank real, snippet text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  where o.valid_until is null
    and length((select t from nq)) >= 2
    and to_tsvector('simple', lower(f_unaccent(dp.text)))
        @@ websearch_to_tsquery('simple', (select t from nq))
  order by rank desc, dp.page
  limit least(greatest(coalesce(max_rows, 10), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.aggregate_objects(relation text DEFAULT 'objects'::text, agg text DEFAULT 'count'::text, prop_path text[] DEFAULT NULL::text[], group_by text DEFAULT NULL::text, group_by_path text[] DEFAULT NULL::text[], filters jsonb DEFAULT '[]'::jsonb, ids uuid[] DEFAULT NULL::uuid[], max_groups integer DEFAULT 50, return_rows boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  allowed_cols constant text[] := array[
    'object_type','ifc_type','predefined_type','user_defined_type','name','object_ref'];
  numeric_re constant text := '^-?[0-9]+(\.[0-9]+)?$';
  f jsonb;
  col text;
  op text;
  op_sql text;
  fpath text[];
  path_lit text;
  fval_expr text;
  where_parts text[] := array['true'];
  val_expr text := null;   -- textová hodnota prop_path
  num_expr text := null;   -- guarded numeric cast prop_path
  agg_expr text;
  key_expr text := null;
  where_clause text;
  q text;
  total_rows bigint;
  result jsonb;
begin
  -- ── whitelisty ──────────────────────────────────────────────────────────
  if relation not in ('objects', 'v_asset_effective') then
    raise exception 'relation ''%'' nie je povolená (objects | v_asset_effective)', relation;
  end if;
  -- zaniknuté objekty (D-087); v_asset_effective ich filtruje sám
  if relation = 'objects' then
    where_parts := where_parts || 'valid_until is null'::text;
  end if;
  if agg not in ('count', 'sum', 'avg', 'min', 'max') then
    raise exception 'agg ''%'' nie je povolený (count|sum|avg|min|max)', agg;
  end if;
  if agg <> 'count' and (prop_path is null or coalesce(array_length(prop_path, 1), 0) = 0) then
    raise exception 'agg ''%'' vyžaduje prop_path (cesta v properties)', agg;
  end if;
  if group_by is not null and group_by_path is not null then
    raise exception 'group_by a group_by_path sú vzájomne výlučné';
  end if;
  max_groups := least(greatest(coalesce(max_groups, 50), 1), 50);

  -- ── prop_path výrazy ────────────────────────────────────────────────────
  if prop_path is not null and coalesce(array_length(prop_path, 1), 0) > 0 then
    select string_agg(format('%L', e), ',') into path_lit from unnest(prop_path) e;
    val_expr := format('nullif(properties #>> array[%s]::text[], '''')', path_lit);
    num_expr := format('(case when %s ~ %L then (%s)::numeric end)',
                       val_expr, numeric_re, val_expr);
  end if;

  -- ── filtre (AND) ────────────────────────────────────────────────────────
  for f in select * from jsonb_array_elements(coalesce(filters, '[]'::jsonb)) loop
    op := f ->> 'op';
    op_sql := case op
      when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>'
      when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
    if op is null or (op_sql is null and op not in ('ilike', 'is')) then
      raise exception 'filter op ''%'' nie je povolený (eq|neq|gt|gte|lt|lte|ilike|is)', op;
    end if;

    if f ? 'column' then
      col := f ->> 'column';
      if not (col = any (allowed_cols)) then
        raise exception 'filter column ''%'' nie je povolený (%)', col,
          array_to_string(allowed_cols, ', ');
      end if;
      if op = 'is' then
        where_parts := where_parts || format('%I is %s', col,
          case when f ->> 'value' is null or f ->> 'value' = 'null'
               then 'null' else 'not null' end);
      elsif op = 'ilike' then
        where_parts := where_parts || format('%I ilike %L', col, f ->> 'value');
      else
        where_parts := where_parts || format('%I %s %L', col, op_sql, f ->> 'value');
      end if;

    elsif f ? 'path' then
      select array_agg(x.e) into fpath from jsonb_array_elements_text(f -> 'path') x(e);
      if fpath is null or coalesce(array_length(fpath, 1), 0) = 0 then
        raise exception 'filter path je prázdny';
      end if;
      select string_agg(format('%L', e), ',') into path_lit from unnest(fpath) e;
      fval_expr := format('nullif(properties #>> array[%s]::text[], '''')', path_lit);
      if op in ('gt', 'gte', 'lt', 'lte') then
        -- numericky bezpečné porovnanie (dôvod existencie tejto RPC)
        if f ->> 'value' is null or (f ->> 'value') !~ numeric_re then
          raise exception 'filter %/% vyžaduje číselnú value, dostal ''%''',
            array_to_string(fpath, '.'), op, f ->> 'value';
        end if;
        where_parts := where_parts || format(
          '(case when %s ~ %L then (%s)::numeric end) %s %L::numeric',
          fval_expr, numeric_re, fval_expr, op_sql, f ->> 'value');
      elsif op = 'is' then
        where_parts := where_parts || format('%s is %s', fval_expr,
          case when f ->> 'value' is null or f ->> 'value' = 'null'
               then 'null' else 'not null' end);
      elsif op = 'ilike' then
        where_parts := where_parts || format('%s ilike %L', fval_expr, f ->> 'value');
      else
        where_parts := where_parts || format('%s %s %L', fval_expr, op_sql, f ->> 'value');
      end if;

    else
      raise exception 'filter musí mať column alebo path';
    end if;
  end loop;

  if ids is not null then
    where_parts := where_parts || format('id = any (%L::uuid[])', ids);
  end if;
  where_clause := array_to_string(where_parts, ' and ');

  -- ── režim: riadky s hodnotou (escape hatch pre číselné filtre) ──────────
  if return_rows then
    -- riadky bez prop_path hodnoty sú šum → implicitný not-null (keď je cesta zadaná)
    if val_expr is not null then
      where_clause := where_clause || format(' and %s is not null', val_expr);
    end if;
    q := format(
      'select coalesce(jsonb_agg(r), ''[]''::jsonb) from (
         select jsonb_build_object(
           ''id'', id, ''object_ref'', object_ref, ''name'', name,
           ''object_type'', %s, ''value'', %s) as r
         from %I where %s order by %s desc nulls last limit 50) t',
      -- v_asset_effective nemá object_type stĺpec — je to vždy asset
      case when relation = 'objects' then 'object_type' else quote_literal('asset') end,
      coalesce(val_expr, 'null'), relation, where_clause, coalesce(num_expr, '1'));
    execute q into result;
    return jsonb_build_object('mode', 'rows', 'rows', result,
                              'row_count', jsonb_array_length(result));
  end if;

  -- ── agregát ─────────────────────────────────────────────────────────────
  agg_expr := case
    when agg = 'count' and val_expr is null then 'count(*)'
    when agg = 'count' then format('count(%s)', val_expr)
    else format('%s(%s)', agg, num_expr) end;

  execute format('select count(*) from %I where %s', relation, where_clause)
    into total_rows;

  if group_by is null and group_by_path is null then
    q := format(
      'select jsonb_build_object(
         ''mode'', ''aggregate'', ''agg'', %L, ''value'', %s,
         ''total_rows'', %s::bigint,
         ''skipped_non_numeric'', %s)
       from %I where %s',
      agg, agg_expr, total_rows,
      case when num_expr is null then '0'
           else format('count(*) filter (where %s is not null and %s is null)',
                       val_expr, num_expr) end,
      relation, where_clause);
    execute q into result;
    return result;
  end if;

  -- ── group by ────────────────────────────────────────────────────────────
  if group_by is not null then
    if not (group_by = any (allowed_cols)) then
      raise exception 'group_by ''%'' nie je povolený (%)', group_by,
        array_to_string(allowed_cols, ', ');
    end if;
    key_expr := format('%I', group_by);
  else
    select string_agg(format('%L', e), ',') into path_lit from unnest(group_by_path) e;
    key_expr := format('properties #>> array[%s]::text[]', path_lit);
  end if;

  q := format(
    'select jsonb_build_object(
       ''mode'', ''aggregate'', ''agg'', %L,
       ''groups'', coalesce(jsonb_agg(
           jsonb_build_object(''key'', k, ''value'', v, ''count'', c)), ''[]''::jsonb),
       ''groups_returned'', count(*),
       ''total_rows'', %s::bigint,
       ''skipped_non_numeric'', coalesce(sum(sk), 0))
     from (
       select %s as k, %s as v, count(*) as c,
              %s as sk
       from %I where %s
       group by 1
       order by v desc nulls last
       limit %s) g',
    agg, total_rows, key_expr, agg_expr,
    case when num_expr is null then '0'
         else format('count(*) filter (where %s is not null and %s is null)',
                     val_expr, num_expr) end,
    relation, where_clause, max_groups);
  execute q into result;
  return result;
end;
$function$;

commit;
