-- =============================================================================
-- D-058 - Pset dictionary from real data: view `v_property_dictionary`
-- =============================================================================
-- Grounding for the LLM interface (D-056/D-057): the model must not GUESS JSONB paths into
-- `objects.properties` - the view aggregates which psets × properties actually
-- exist in the data (per object_type × ifc_type), what type the values are, how many objects
-- carry them and what the values look like (samples + min/max for numerics).
--
-- Covers standard (Pset_/Qto_) AND custom psets (D-022 layer 3) - the static
-- IFC schema does not know custom psets, this view does (complemented by D-061, the static
-- IFC dictionary of definitions). Reserved `_keys` (meta, D-022) are not psets →
-- omitted (`p.key !~ '^_'`).
--
-- Performance: full scan + double jsonb_each - a few ms at ~10^3 objects.
-- When growing beyond ~10^5 objects switch to a materialized view with a refresh after the ETL
-- load (note in D-058); the definition does not change.
--
-- Migrations are ADDITIVE - this file is never edited; old ones are not deleted.

begin;

create view v_property_dictionary as
select
  o.object_type,
  o.ifc_type,
  p.key                                as pset,
  a.key                                as property,
  jsonb_typeof(a.value)                as value_type,
  count(*)::int                        as object_count,
  count(distinct a.value)::int         as distinct_values,
  -- value samples (scalar without JSON quotes, trimmed to 60 characters, max 5)
  (array_agg(distinct left(a.value #>> '{}', 60)))[1:5] as sample_values,
  min(case when jsonb_typeof(a.value) = 'number'
           then (a.value #>> '{}')::numeric end)        as min_number,
  max(case when jsonb_typeof(a.value) = 'number'
           then (a.value #>> '{}')::numeric end)        as max_number
from objects o
cross join lateral jsonb_each(o.properties) p
cross join lateral jsonb_each(p.value) a
where p.key !~ '^_'
  and jsonb_typeof(p.value) = 'object'
group by o.object_type, o.ifc_type, p.key, a.key, jsonb_typeof(a.value);

comment on view v_property_dictionary is
  'D-058: slovník psetov z reálnych dát (grounding LLM filtrov properties->Pset->>Key).';

commit;

-- PostgREST must see the new view without a restart (Supabase).
notify pgrst, 'reload schema';
