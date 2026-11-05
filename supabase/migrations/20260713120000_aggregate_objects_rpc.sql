-- =============================================================================
-- D-060 - Aggregations + numerically safe filters: RPC `aggregate_objects`
-- =============================================================================
-- Problem: query_view (PostgREST) cannot aggregate (only count) and a filter over a JSONB
-- path `properties->Pset->>Key` compares gt/lt as TEXT (lexicographically:
-- '9' > '10') - a silent precision error. The model then computes from truncated rows
-- (row-cap 50) in context → invented numbers. Sums/averages/numeric comparisons
-- must be done by the DATABASE.
--
-- Safety of dynamic SQL (the only place in the repo, keep it short and auditable):
--   * relation/agg/op/columns = internal whitelists (raise on anything else),
--   * identifiers via format('%I'), literals via format('%L') - never splicing,
--   * JSONB paths = array of text literals (%L per element),
--   * numerics via guarded cast (regex) - non-numeric values are skipped
--     and reported in `skipped_non_numeric` (honesty towards the model).
--
-- Migrations are ADDITIVE - this file is never edited.

begin;

create or replace function aggregate_objects(
  relation text default 'objects',        -- objects | v_asset_effective
  agg text default 'count',               -- count | sum | avg | min | max
  prop_path text[] default null,          -- path in properties, e.g. {VZT_Parametre,AirFlowRate}
  group_by text default null,             -- column from the whitelist (exclusive with group_by_path)
  group_by_path text[] default null,      -- or a pset path as the group key
  filters jsonb default '[]'::jsonb,      -- [{"column":"ifc_type","op":"eq","value":"IfcDoor"},
                                          --  {"path":["Pset_X","Key"],"op":"gt","value":"5"}]
  ids uuid[] default null,                -- optional narrowing to specific objects.id (chaining)
  max_groups int default 50,
  return_rows boolean default false       -- true = rows with the value instead of the aggregate (top 50)
) returns jsonb
language plpgsql stable
set search_path = public
as $$
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
$$;

comment on function aggregate_objects(text, text, text[], text, text[], jsonb, uuid[], int, boolean) is
  'D-060: read-only agregácie (sum/avg/min/max/count, group by) a numericky bezpečné filtre nad properties psetmi; interné whitelisty + format %I/%L.';

commit;

-- PostgREST must see the RPC without a restart (Supabase).
notify pgrst, 'reload schema';
