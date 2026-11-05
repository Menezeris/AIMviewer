-- D-183 K2: complete copy of the information of every model revision (without geometry), next to the AIM graph.
--
-- Written only by `python -m etl.revision_copy` from the revision archive (verified sha256), by a generic rule:
--   * `ifc_rev_objects`        = every IfcRoot except relationships and sets (elements, spaces, types, systems, project, pset
--                                templates) with attributes except geometry and OwnerHistory; key (model, revision, global_id);
--   * `ifc_rev_relationships`  = every pair from every IfcRel* except IfcRelDefinesByProperties (those are psets);
--                                key (model, revision, rel_class, relating, related) = (class, carrier, other side);
--                                a side without GlobalId has a natural key `Class:Identification|Name` or a content hash;
--   * `ifc_rev_property_sets`  = every pset, Qto and predefined set on an occurrence and on a type; key
--                                (model, revision, carrier global_id, pset_name); the pset's own GlobalId only informational.
-- Full copies (D-183 point 5): every row carries (model, revision) and `content_hash` (sha256 of the canonical row notation,
-- `hash_version` in the run). The copy is created in one transaction with an `ifc_rev_imports` row in state `done`; views
-- and functions read only revisions with `done`. Nobody changes the copy by hand, geometry goes to a file (point 6).
-- Comparing two revisions is an on-demand function (point 7), it stores nothing. Existing `objects` and `relationships`
-- (AIM graph) do not change. Rights: anon/authenticated none (default privileges, 20261016120000).

begin;

create table ifc_rev_imports (
  model                text not null,
  revision             integer not null,
  sha256               text not null check (sha256 ~ '^[0-9a-f]{64}$'),   -- verified content of the archive
  status               text not null check (status in ('done', 'failed')),
  hash_version         integer not null,           -- version of the canonical notation and of content_hash
  schema_identifier    text,                       -- FILE_SCHEMA (IFC4X3_ADD2)
  counts               jsonb not null default '{}'::jsonb,   -- counts from the file and from the DB (completeness check)
  warnings             jsonb not null default '[]'::jsonb,   -- e.g. pset without carrier, IfcRel without a pair
  error                text,                       -- on failed
  engine               text,                       -- ifcopenshell version
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  primary key (model, revision),
  foreign key (model, revision) references model_revisions (model, revision) on delete cascade
);

create table ifc_rev_objects (
  model               text not null,
  revision            integer not null,
  global_id           text not null,               -- IfcRoot.GlobalId
  ifc_class           text not null,               -- IfcDuctSegment, IfcBuildingStorey, IfcPropertySetTemplate...
  attributes          jsonb not null,              -- schema attributes without geometry and OwnerHistory (Name, PredefinedType...)
  file_owner_history  jsonb,                       -- IfcOwnerHistory from the file, informational only (ChangeAction, OwningUser...)
  content_hash        text not null,
  primary key (model, revision, global_id),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);
create index idx_ifc_rev_objects_class on ifc_rev_objects (model, revision, ifc_class);

create table ifc_rev_relationships (
  model           text not null,
  revision        integer not null,
  rel_class       text not null,                   -- IfcRelContainedInSpatialStructure...
  relating        text not null,                   -- carrier (Relating*): GlobalId or natural key
  related         text not null,                   -- other side (Related*): GlobalId or natural key
  relating_class  text not null,
  related_class   text not null,
  attributes      jsonb not null default '[]'::jsonb,   -- other IfcRel* attributes (distinct variants sorted)
  multiplicity    integer not null default 1,      -- how many IfcRel* instances carry the same pair
  rel_global_ids  text[] not null default '{}',    -- IfcRel* own GlobalIds, informational only (Revit changes them)
  content_hash    text not null,
  primary key (model, revision, rel_class, relating, related),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);
create index idx_ifc_rev_rel_related on ifc_rev_relationships (model, revision, related);
create index idx_ifc_rev_rel_relating on ifc_rev_relationships (model, revision, relating, rel_class);

create table ifc_rev_property_sets (
  model            text not null,
  revision         integer not null,
  global_id        text not null,                  -- carrier: occurrence or type
  pset_name        text not null,                  -- Pset_DuctSegmentCommon, Qto_DuctSegmentBaseQuantities...
  pset_class       text not null,                  -- IfcPropertySet, IfcElementQuantity, IfcDoorLiningProperties...
  properties       jsonb not null,                 -- {name: value}
  pset_global_ids  text[] not null default '{}',   -- pset's own GlobalIds, informational only
  content_hash     text not null,
  primary key (model, revision, global_id, pset_name),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);

-- The revision the functions may read: the given one (only done), otherwise the current one from model_revisions (also only done).
create or replace function ifc_rev_resolve(p_model text, p_revision integer default null)
returns integer language plpgsql stable set search_path = public as $$
declare r integer;
begin
  r := coalesce(p_revision, (select revision from model_revisions where model = p_model and is_current));
  if r is null then raise exception 'Model % nemá revíziu', p_model; end if;
  if not exists (select 1 from ifc_rev_imports where model = p_model and revision = r and status = 'done') then
    raise exception 'Revízia % v% nemá hotovú kópiu v DB (python -m etl.revision_copy --model % --revision %)', p_model, r, p_model, r;
  end if;
  return r;
end $$;

-- Elements contained in a storey (IfcRelContainedInSpatialStructure, storey by Name or GlobalId), optionally
-- only members of a system (IfcRelAssignsToGroup, system Name ilike p_system). D-183 acceptance test:
-- ifc_rev_storey_elements('VZT', 11, '2NP', 'Prívod%') = 212 elements.
create or replace function ifc_rev_storey_elements(p_model text, p_revision integer, p_storey text, p_system text default null)
returns table (global_id text, ifc_class text, name text)
language sql stable set search_path = public as $$
  with rev as (select ifc_rev_resolve(p_model, p_revision) as r),
  storey as (
    select o.global_id from ifc_rev_objects o, rev
    where o.model = p_model and o.revision = rev.r and o.ifc_class = 'IfcBuildingStorey'
      and (o.global_id = p_storey or o.attributes ->> 'Name' = p_storey)
  ),
  contained as (
    select rr.related from ifc_rev_relationships rr, rev
    where rr.model = p_model and rr.revision = rev.r and rr.rel_class = 'IfcRelContainedInSpatialStructure'
      and rr.relating in (select global_id from storey)
  )
  select o.global_id, o.ifc_class, o.attributes ->> 'Name'
  from ifc_rev_objects o, rev
  where o.model = p_model and o.revision = rev.r and o.global_id in (select related from contained)
    and (p_system is null or exists (
      select 1 from ifc_rev_relationships g
      join ifc_rev_objects s on s.model = g.model and s.revision = g.revision and s.global_id = g.relating
      where g.model = p_model and g.revision = rev.r and g.rel_class = 'IfcRelAssignsToGroup'
        and g.related = o.global_id and s.attributes ->> 'Name' ilike p_system
    ))
  order by o.ifc_class, o.global_id
$$;

-- Keys whose value differs (including added and removed), sorted.
create or replace function jsonb_changed_keys(a jsonb, b jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}')
  from (
    select coalesce(x.key, y.key) as k
    from jsonb_each(coalesce(a, '{}'::jsonb)) x
    full join jsonb_each(coalesce(b, '{}'::jsonb)) y on y.key = x.key
    where x.value is distinct from y.value
  ) d
$$;

-- Comparison of two model revisions on demand (D-183 point 7), stores nothing. By GlobalId:
-- ADDED / DELETED / MODIFIED (aspects: attributes = attribute names, psets = Pset.Property, relations = +/-Class:carrier
-- on the Related side, i.e. the element) / NOCHANGE only as the note "changed via type" (an occurrence of a type that is MODIFIED).
-- Placement is not in the DB: it is added by `python -m etl.revision_compare --placement` from the files.
create or replace function ifc_rev_compare(p_model text, p_from integer, p_to integer)
returns table (global_id text, ifc_class text, change_action text, aspects jsonb)
language sql stable set search_path = public as $$
  with
  f as (select ifc_rev_resolve(p_model, p_from) as r),
  t as (select ifc_rev_resolve(p_model, p_to) as r),
  o_from as (select o.* from ifc_rev_objects o, f where o.model = p_model and o.revision = f.r),
  o_to   as (select o.* from ifc_rev_objects o, t where o.model = p_model and o.revision = t.r),
  objs as (
    select coalesce(b.global_id, a.global_id) as global_id, coalesce(b.ifc_class, a.ifc_class) as ifc_class,
           a.global_id is not null as in_from, b.global_id is not null as in_to,
           case when a.global_id is not null and b.global_id is not null and a.content_hash <> b.content_hash
                then jsonb_changed_keys(a.attributes, b.attributes) end as attr_keys
    from o_from a full join o_to b on b.global_id = a.global_id
  ),
  p_from_ as (select p.* from ifc_rev_property_sets p, f where p.model = p_model and p.revision = f.r),
  p_to_   as (select p.* from ifc_rev_property_sets p, t where p.model = p_model and p.revision = t.r),
  pset_diff as (
    select coalesce(b.global_id, a.global_id) as global_id,
           array_agg(x order by x) as items
    from p_from_ a
    full join p_to_ b on b.global_id = a.global_id and b.pset_name = a.pset_name
    cross join lateral unnest(
      case
        when a.global_id is null then array[b.pset_name || ' (+)']
        when b.global_id is null then array[a.pset_name || ' (-)']
        else (select array_agg(a.pset_name || '.' || k) from unnest(jsonb_changed_keys(a.properties, b.properties)) k)
      end
    ) x
    where a.content_hash is distinct from b.content_hash
    group by 1
  ),
  r_from as (select r.* from ifc_rev_relationships r, f where r.model = p_model and r.revision = f.r),
  r_to   as (select r.* from ifc_rev_relationships r, t where r.model = p_model and r.revision = t.r),
  rel_diff as (
    select coalesce(b.related, a.related) as global_id,
           array_agg(case when a.related is null then '+' when b.related is null then '-' else '~' end
                     || coalesce(b.rel_class, a.rel_class) || ':' || coalesce(b.relating, a.relating)
                     order by coalesce(b.rel_class, a.rel_class), coalesce(b.relating, a.relating)) as items
    from r_from a
    full join r_to b on b.rel_class = a.rel_class and b.relating = a.relating and b.related = a.related
    where a.content_hash is distinct from b.content_hash
    group by 1
  ),
  changed as (
    select o.global_id, o.ifc_class,
           case when not o.in_from then 'ADDED' when not o.in_to then 'DELETED' else 'MODIFIED' end as change_action,
           case when o.in_from and o.in_to then
             jsonb_strip_nulls(jsonb_build_object(
               'attributes', case when cardinality(o.attr_keys) > 0 then to_jsonb(o.attr_keys) end,
               'psets', to_jsonb(pd.items),
               'relations', to_jsonb(rd.items)))
           end as aspects
    from objs o
    left join pset_diff pd on pd.global_id = o.global_id
    left join rel_diff rd on rd.global_id = o.global_id
    where not o.in_from or not o.in_to or cardinality(o.attr_keys) > 0 or pd.items is not null or rd.items is not null
  ),
  via_type as (
    select o.global_id, o.ifc_class, 'NOCHANGE'::text as change_action,
           jsonb_build_object('via_type', r.relating, 'note', 'changed via type') as aspects
    from r_to r
    join changed c on c.global_id = r.relating and c.change_action = 'MODIFIED'
    join objs o on o.global_id = r.related and o.in_from and o.in_to
    where r.rel_class = 'IfcRelDefinesByType'
      and not exists (select 1 from changed c2 where c2.global_id = r.related)
  )
  select * from changed
  union all
  select * from via_type
  order by 3, 2, 1
$$;

revoke all on ifc_rev_imports, ifc_rev_objects, ifc_rev_relationships, ifc_rev_property_sets from anon, authenticated;
grant all on ifc_rev_imports, ifc_rev_objects, ifc_rev_relationships, ifc_rev_property_sets to service_role;
revoke all on function ifc_rev_resolve(text, integer), ifc_rev_storey_elements(text, integer, text, text),
  ifc_rev_compare(text, integer, integer) from public, anon, authenticated;
grant execute on function ifc_rev_resolve(text, integer), ifc_rev_storey_elements(text, integer, text, text),
  ifc_rev_compare(text, integer, integer) to service_role;

commit;
