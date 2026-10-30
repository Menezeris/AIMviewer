-- D-183 K2: úplná kópia informácií každej revízie modelu (bez geometrie), vedľa grafu AIM.
--
-- Zapisuje len `python -m etl.revision_copy` z archívu revízie (overený sha256), generickým pravidlom:
--   * `ifc_rev_objects`        = každý IfcRoot okrem vzťahov a sád (prvky, priestory, typy, systémy, projekt, šablóny
--                                psetov) s atribútmi okrem geometrie a OwnerHistory; kľúč (model, revision, global_id);
--   * `ifc_rev_relationships`  = každá dvojica z každého IfcRel* okrem IfcRelDefinesByProperties (to sú psety);
--                                kľúč (model, revision, rel_class, relating, related) = (trieda, nositeľ, druhá strana);
--                                strana bez GlobalId má prirodzený kľúč `Trieda:Identification|Name` alebo hash obsahu;
--   * `ifc_rev_property_sets`  = každý pset, Qto a preddefinovaná sada na výskyte aj na type; kľúč
--                                (model, revision, global_id nositeľa, pset_name); vlastné GlobalId psetu len informačne.
-- Plné kópie (D-183 bod 5): každý riadok nesie (model, revision) a `content_hash` (sha256 kanonického zápisu riadku,
-- `hash_version` v behu). Kópia vzniká v jednej transakcii s riadkom `ifc_rev_imports` v stave `done`; pohľady
-- a funkcie čítajú len revízie s `done`. Kópiu nikto ručne nemení, pri geometrii sa ide do súboru (bod 6).
-- Porovnanie dvoch revízií je funkcia na požiadanie (bod 7), nič neukladá. Existujúce `objects` a `relationships`
-- (graf AIM) sa nemenia. Práva: anon/authenticated nič (default privileges, 20261016120000).

begin;

create table ifc_rev_imports (
  model                text not null,
  revision             integer not null,
  sha256               text not null check (sha256 ~ '^[0-9a-f]{64}$'),   -- overený obsah archívu
  status               text not null check (status in ('done', 'failed')),
  hash_version         integer not null,           -- verzia kanonického zápisu a content_hash
  schema_identifier    text,                       -- FILE_SCHEMA (IFC4X3_ADD2)
  counts               jsonb not null default '{}'::jsonb,   -- počty zo súboru a z DB (kontrola úplnosti)
  warnings             jsonb not null default '[]'::jsonb,   -- napr. pset bez nositeľa, IfcRel bez dvojice
  error                text,                       -- pri failed
  engine               text,                       -- ifcopenshell verzia
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
  attributes          jsonb not null,              -- atribúty schémy bez geometrie a OwnerHistory (Name, PredefinedType...)
  file_owner_history  jsonb,                       -- IfcOwnerHistory zo súboru, len informačne (ChangeAction, OwningUser...)
  content_hash        text not null,
  primary key (model, revision, global_id),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);
create index idx_ifc_rev_objects_class on ifc_rev_objects (model, revision, ifc_class);

create table ifc_rev_relationships (
  model           text not null,
  revision        integer not null,
  rel_class       text not null,                   -- IfcRelContainedInSpatialStructure...
  relating        text not null,                   -- nositeľ (Relating*): GlobalId alebo prirodzený kľúč
  related         text not null,                   -- druhá strana (Related*): GlobalId alebo prirodzený kľúč
  relating_class  text not null,
  related_class   text not null,
  attributes      jsonb not null default '[]'::jsonb,   -- ostatné atribúty IfcRel* (zoradené rôzne varianty)
  multiplicity    integer not null default 1,      -- koľko IfcRel* inštancií nesie tú istú dvojicu
  rel_global_ids  text[] not null default '{}',    -- vlastné GlobalId IfcRel*, len informačne (Revit ich mení)
  content_hash    text not null,
  primary key (model, revision, rel_class, relating, related),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);
create index idx_ifc_rev_rel_related on ifc_rev_relationships (model, revision, related);
create index idx_ifc_rev_rel_relating on ifc_rev_relationships (model, revision, relating, rel_class);

create table ifc_rev_property_sets (
  model            text not null,
  revision         integer not null,
  global_id        text not null,                  -- nositeľ: výskyt alebo typ
  pset_name        text not null,                  -- Pset_DuctSegmentCommon, Qto_DuctSegmentBaseQuantities...
  pset_class       text not null,                  -- IfcPropertySet, IfcElementQuantity, IfcDoorLiningProperties...
  properties       jsonb not null,                 -- {meno: hodnota}
  pset_global_ids  text[] not null default '{}',   -- vlastné GlobalId psetu, len informačne
  content_hash     text not null,
  primary key (model, revision, global_id, pset_name),
  foreign key (model, revision) references ifc_rev_imports (model, revision) on delete cascade
);

-- Revízia, ktorú smú čítať funkcie: zadaná (len done), inak aktuálna z model_revisions (tiež len done).
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

-- Prvky obsiahnuté v podlaží (IfcRelContainedInSpatialStructure, podlažie podľa Name alebo GlobalId), voliteľne
-- len členovia systému (IfcRelAssignsToGroup, Name systému ilike p_system). Akceptačný test D-183:
-- ifc_rev_storey_elements('VZT', 11, '2NP', 'Prívod%') = 212 prvkov.
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

-- Kľúče, ktorých hodnota sa líši (aj pridané a odobraté), zoradené.
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

-- Porovnanie dvoch revízií modelu na požiadanie (D-183 bod 7), nič neukladá. Podľa GlobalId:
-- ADDED / DELETED / MODIFIED (aspects: attributes = mená atribútov, psets = Pset.Vlastnosť, relations = +/-Trieda:nositeľ
-- na strane Related, teda prvku) / NOCHANGE len ako poznámka "changed via type" (výskyt typu, ktorý je MODIFIED).
-- Poloha (placement) sa v DB nenachádza: dopĺňa ju `python -m etl.revision_compare --placement` zo súborov.
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
