-- D-089: register pravidiel odvodení a záznam ich behov.
--
-- Odvodený vzťah = vzťah, ktorý nikto nezapísal do súboru ani ručne; AIM ho vypočíta pravidlom
-- (geometria, cez priestory…). Pravidlá sú dáta: dajú sa zapnúť, vypnúť a prepnúť medzi
-- `auto` (po každej novej revízii) a `manual`. Vypnutie uzavrie hrany pravidla (`source`).
-- Spúšťa `python -m etl.derive run`; každý beh sa zapíše do `derivation_runs` (vzor ids_runs).
-- Práva anon/authenticated tabuľky nedostanú (default privileges, migrácia 20261016120000).

begin;

create table derivation_rules (
  id              text primary key,                    -- stabilný kľúč pravidla
  name            text not null,
  description     text,
  kind            text not null check (kind in ('geometry', 'via_space')),
  rel_type        text,                                -- IFC vzťah, ktorý pravidlo zapisuje (NULL = len pohľad)
  source          text unique,                         -- zdroj hrán pravidla v `relationships`
  source_classes  text[] not null default '{}',        -- IFC triedy prvkov
  target_classes  text[] not null default '{}',        -- IFC triedy cieľov
  roles           text[] not null default '{inside,partial}',
  enabled         boolean not null default true,
  mode            text not null default 'auto' check (mode in ('auto', 'manual')),
  updated_at      timestamptz not null default now()
);

create table derivation_runs (
  id              uuid primary key default gen_random_uuid(),
  rule_id         text not null references derivation_rules (id),
  status          text not null check (status in ('ok', 'dry_run', 'disabled', 'error')),
  trigger         text not null default 'manual' check (trigger in ('auto', 'manual')),
  models          jsonb not null default '{}'::jsonb,  -- {"ASR": 72, "VZT": 1} revízie z model_revisions
  written         integer not null default 0,
  closed          integer not null default 0,
  unresolved      integer not null default 0,          -- GUID, ktoré DB nepozná
  details         jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index on derivation_runs (rule_id, started_at desc);

insert into derivation_rules
  (id, name, description, kind, rel_type, source, source_classes, target_classes, roles)
values
  ('element_in_space', 'Prvok v priestore (geometria)',
   'Prvok leží v telese IfcSpace celý (inside) alebo ho pretína (partial). Doterajšie hrany D-080.',
   'geometry', 'rel_referenced_in_spatial_structure', 'derive:spatial_reference',
   '{IfcDistributionElement,IfcFurnishingElement}', '{IfcSpace}', '{inside,partial}'),
  ('element_in_spatial_zone', 'Prvok v priestorovej zóne (geometria)',
   'Prvok v telese IfcSpatialZone (požiarny úsek, energetická zóna); partial = prestup cez hranicu zóny.',
   'geometry', 'rel_referenced_in_spatial_structure', 'derive:element_in_spatial_zone',
   '{IfcDistributionElement,IfcFurnishingElement}', '{IfcSpatialZone}', '{inside,partial}'),
  ('element_in_zone', 'Prvok v zóne (cez priestory)',
   'Prvok v priestore, ktorý je členom IfcZone (aj vnorenej). IfcZone sdružuje len priestory a nemá '
   'teleso, IFC na prvok v IfcZone vzťah nemá: pravidlo nezapisuje hrany, je to pohľad v_zone_elements.',
   'via_space', null, null,
   '{IfcProduct}', '{IfcZone}', '{contained,referenced}');

-- Prvky v zónach cez priestory (pravidlo element_in_zone). Zóna obsahuje priestory priamo alebo
-- cez vnorené zóny (rel_assigns_to_group zóna -> zóna); prvok je v priestore natívne (contained)
-- alebo referenciou (zo súboru aj odvodenou). Prázdny, keď je pravidlo vypnuté.
create view v_zone_elements as
  with recursive zone_spaces (zone_id, space_id) as (
    select g.to_id, g.from_id
    from rel_assigns_to_group g
    join objects s on s.id = g.from_id and s.object_type = 'space' and s.valid_until is null
    join objects z on z.id = g.to_id and z.object_type = 'zone' and z.valid_until is null
    where g.valid_until is null
    union
    select parent.to_id, zs.space_id
    from zone_spaces zs
    join rel_assigns_to_group parent on parent.from_id = zs.zone_id and parent.valid_until is null
    join objects pz on pz.id = parent.to_id and pz.object_type = 'zone' and pz.valid_until is null
  ),
  element_spaces as (
    select c.from_id as element_id, c.to_id as space_id, 'contained'::text as relation,
           null::text as role, c.source
    from rel_contained_in_spatial_structure c where c.valid_until is null
    union all
    select r.from_id, r.to_id, 'referenced', r.role, r.source
    from rel_referenced_in_spatial_structure r where r.valid_until is null
  )
  select zs.zone_id, z.object_ref as zone_ref, z.name as zone_name,
         es.element_id, e.object_ref as element_ref, e.name as element_name,
         e.ifc_type as element_ifc_type, e.predefined_type as element_predefined_type,
         zs.space_id as via_space_id, s.object_ref as via_space_ref,
         es.relation, es.role, es.source
  from zone_spaces zs
  join element_spaces es on es.space_id = zs.space_id
  join objects e on e.id = es.element_id and e.object_type = 'asset' and e.valid_until is null
  join objects z on z.id = zs.zone_id
  join objects s on s.id = zs.space_id
  where exists (select 1 from derivation_rules where id = 'element_in_zone' and enabled);

commit;
