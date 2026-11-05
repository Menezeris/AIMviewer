-- =============================================================================
-- AIM Platform - seed data for AIM Viewer
-- =============================================================================
-- Purpose: a minimal but fully linked demo set that shows the strength of the model -
--   spatial hierarchy, type->occurrence inheritance (v_asset_effective),
--   union of classifications (v_asset_classifications), actors and responsibilities,
--   documents and the history of IFC GUIDs.
--
-- Conventions: CLAUDE.md + DECISIONS.md (D-009 to D-025), schema from migration
--   20260616120000_init_aim_schema.sql.
--
-- Hard rules observed:
--   * All UUIDs are hardcoded constants -> the seed is idempotent
--     (every INSERT has ON CONFLICT (id) DO NOTHING).
--   * IFC attributes (ifc_guid, ifc_type, predefined_type, ...) are COLUMNS
--     on `objects`, never in `properties`.
--   * `properties` contains only property sets (Pset_/Qto_ = standard,
--     others = custom) and reserved `_keys` (meta, capture-don't-structure).
--   * object_type='asset_type' is NEVER in spatial links (rel_aggregates /
--     rel_contained_in_spatial_structure).
--
-- UUID scheme (readable):
--   a0...0001 site, ...0002 building, ...0011/0012 floor, ...0021-0024 space
--   a0...00a0 asset_type, ...00a1/00a2/00a3 asset
--   a0...00b0 organization, ...00b1 person, ...00c0 document
--   c1...0001 classification_system, c2...0001/0002 classification_reference
--   rel_* edges have their own e.../f... prefixes
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Nodes - spatial hierarchy (Site -> Building -> Floor -> Space)
-- -----------------------------------------------------------------------------
insert into objects (id, object_type, object_ref, name, ifc_guid, ifc_type, properties) values
  ('a0000000-0000-0000-0000-000000000001', 'site',     'AB',          'Administratívna budova — areál', '1site00000000000000001', 'IfcSite',     '{}'),
  ('a0000000-0000-0000-0000-000000000002', 'building', 'AB-B1',       'Administratívna budova',         '2bldg00000000000000002', 'IfcBuilding', '{}'),
  ('a0000000-0000-0000-0000-000000000011', 'floor',    'AB-B1-1NP',   '1.NP',                           '3flr000000000000000011', 'IfcBuildingStorey', '{}'),
  ('a0000000-0000-0000-0000-000000000012', 'floor',    'AB-B1-2NP',   '2.NP',                           '3flr000000000000000012', 'IfcBuildingStorey', '{}'),
  ('a0000000-0000-0000-0000-000000000021', 'space',    'AB-B1-1.01',  'Technická miestnosť 1.01',       '4spc000000000000000021', 'IfcSpace',    '{}'),
  ('a0000000-0000-0000-0000-000000000022', 'space',    'AB-B1-1.02',  'Strojovňa VZT 1.02',             '4spc000000000000000022', 'IfcSpace',    '{}'),
  ('a0000000-0000-0000-0000-000000000023', 'space',    'AB-B1-2.01',  'Kancelária 2.01',                '4spc000000000000000023', 'IfcSpace',    '{}'),
  ('a0000000-0000-0000-0000-000000000024', 'space',    'AB-B1-2.02',  'Kancelária 2.02',                '4spc000000000000000024', 'IfcSpace',    '{}')
on conflict (id) do nothing;

-- Suffix of floors (elevation)
insert into floors (id, elevation) values
  ('a0000000-0000-0000-0000-000000000011', 0.000),
  ('a0000000-0000-0000-0000-000000000012', 3.500)
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 2. Asset type (D-021) - air handling unit
--    The type carries the shared: predefined_type=AIRHANDLER, standard + custom pset.
--    The type is NEVER in spatial links (rel_aggregates / rel_contained_in_spatial_structure).
-- -----------------------------------------------------------------------------
insert into objects (id, object_type, object_ref, name, ifc_guid, ifc_type, predefined_type, properties) values
  ('a0000000-0000-0000-0000-0000000000a0', 'asset_type', 'TYP-VZT-AHU-5000', 'VZT jednotka AHU-5000',
   '5typ0000000000000000a0', 'IfcUnitaryEquipmentType', 'AIRHANDLER',
   '{
      "Pset_UnitaryEquipmentTypeCommon": {
        "Reference": "AHU-5000",
        "Status": "New"
      },
      "VZT_Parametre": {
        "AirFlowRate": 5000,
        "HeatRecovery": true,
        "Manufacturer": "Daikin"
      }
    }'::jsonb)
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 3. Assets (occurrence)
--    a1, a2 -> linked to the same asset_type (inheritance is visible in v_asset_effective).
--      a1 overrides AirFlowRate and adds SerialNumber (deep-merge via type).
--      predefined_type NULL -> inherits AIRHANDLER from the type.
--    a3 -> a standalone pump WITHOUT a type (shows the left-join "no type" branch).
-- -----------------------------------------------------------------------------
insert into objects (id, object_type, object_ref, name, ifc_guid, ifc_type, predefined_type, properties) values
  ('a0000000-0000-0000-0000-0000000000a1', 'asset', 'AHU-01', 'VZT jednotka AHU-01',
   '6ahu0100000000000000a1', 'IfcUnitaryEquipment', null,
   '{
      "VZT_Parametre": {
        "AirFlowRate": 4800,
        "SerialNumber": "SN-2024-001"
      }
    }'::jsonb),
  ('a0000000-0000-0000-0000-0000000000a2', 'asset', 'AHU-02', 'VZT jednotka AHU-02',
   '6ahu0200000000000000a2', 'IfcUnitaryEquipment', null,
   '{
      "VZT_Parametre": {
        "SerialNumber": "SN-2024-002"
      }
    }'::jsonb),
  ('a0000000-0000-0000-0000-0000000000a3', 'asset', 'CERP-01', 'Obehové čerpadlo ÚK-01',
   '7pmp0100000000000000a3', 'IfcPump', 'CIRCULATOR',
   '{
      "Pset_PumpTypeCommon": {
        "Reference": "WILO-Stratos"
      }
    }'::jsonb)
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 4. Actors (D-024, level B) - organization + person
-- -----------------------------------------------------------------------------
insert into objects (id, object_type, object_ref, name, properties) values
  ('a0000000-0000-0000-0000-0000000000b0', 'organization', 'ORG-TZB', 'TZB Servis s.r.o.',
   '{ "_contact": { "address": "Priemyselná 12, 821 09 Bratislava", "ico": "12345678" } }'::jsonb),
  ('a0000000-0000-0000-0000-0000000000b1', 'person',       'PER-JN',  'Ján Novák', '{}'::jsonb)
on conflict (id) do nothing;

insert into persons (id, given_name, family_name, email, phone) values
  ('a0000000-0000-0000-0000-0000000000b1', 'Ján', 'Novák', 'jan.novak@tzbservis.sk', '+421 900 123 456')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 5. Document (D-014)
-- -----------------------------------------------------------------------------
insert into objects (id, object_type, object_ref, name, properties) values
  ('a0000000-0000-0000-0000-0000000000c0', 'document', 'DOC-AHU-MAN', 'Návod na obsluhu VZT jednotky AHU-5000', '{}'::jsonb)
on conflict (id) do nothing;

insert into documents (id, identification, description, location, purpose, revision, status, valid_from) values
  ('a0000000-0000-0000-0000-0000000000c0', 'AHU-5000-OM',
   'Prevádzkový a údržbový manuál', 'https://example.com/docs/ahu-5000-manual.pdf',
   'Operation & Maintenance', 'Rev.A', 'Final', '2024-03-01T00:00:00Z')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 6. Classification (D-011, D-019, D-023) - Uniclass 2015, union of facets
--    Pr_ (product) on the type, Ss_ (system) additionally on occurrence AHU-01
-- -----------------------------------------------------------------------------
insert into classification_systems (id, name, source, edition, edition_date, location) values
  ('c1000000-0000-0000-0000-000000000001', 'Uniclass 2015', 'NBS', '2015', '2015-01-01',
   'https://uniclass.thenbs.com/')
on conflict (id) do nothing;

insert into classification_references (id, system_id, identification, name, location) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'Pr_70_65_04', 'Air handling units', 'https://uniclass.thenbs.com/'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001',
   'Ss_55_70_70', 'Ventilation ductwork systems', 'https://uniclass.thenbs.com/')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 7. History of IFC GUIDs (D-010) - AHU-01 was re-exported once
--    The active GUID (valid_until NULL) matches objects.ifc_guid.
-- -----------------------------------------------------------------------------
insert into ifc_guid_history (id, object_id, ifc_guid, valid_from, valid_until, source) values
  ('d0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1',
   '6ahuOLD000000000000001', '2023-06-01T00:00:00Z', '2024-02-15T00:00:00Z', 'IFC export 2023 (Revit)'),
  ('d0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1',
   '6ahu0100000000000000a1', '2024-02-15T00:00:00Z', null, 'IFC export 2024 (Revit)')
on conflict (id) do nothing;


-- =============================================================================
-- EDGES (rel_*) - from_id -> to_id
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8. Spatial links (D-048) - split the IFC-canonical way:
--    rel_aggregates = decomposition of the structure (Site<-Building<-Floor<-Space),
--    rel_contained_in_spatial_structure = a physical element (asset) in a space.
--    asset_type NEVER occurs in spatial links.
-- -----------------------------------------------------------------------------
-- D-051: edges live in the generic `relationships` (discriminator `rel_type`).
-- Canonical views (rel_aggregates...) are read-only -> the seed writes the base table.
insert into relationships (id, rel_type, from_id, to_id, source) values
  -- building → site
  ('e1000000-0000-0000-0000-000000000002', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'seed'),
  -- floors → building
  ('e1000000-0000-0000-0000-000000000011', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000002', 'seed'),
  ('e1000000-0000-0000-0000-000000000012', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000002', 'seed'),
  -- spaces → floors
  ('e1000000-0000-0000-0000-000000000021', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000011', 'seed'),
  ('e1000000-0000-0000-0000-000000000022', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000011', 'seed'),
  ('e1000000-0000-0000-0000-000000000023', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000012', 'seed'),
  ('e1000000-0000-0000-0000-000000000024', 'rel_aggregates', 'a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000012', 'seed'),
  -- assets -> spaces (contained)
  ('e1000000-0000-0000-0000-0000000000a1', 'rel_contained_in_spatial_structure', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000022', 'seed'),  -- AHU-01 -> machine room 1.02
  ('e1000000-0000-0000-0000-0000000000a2', 'rel_contained_in_spatial_structure', 'a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000021', 'seed'),  -- AHU-02 -> technical room 1.01
  ('e1000000-0000-0000-0000-0000000000a3', 'rel_contained_in_spatial_structure', 'a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000022', 'seed'),  -- CERP-01 -> machine room 1.02
  -- 9. defined_by_type (D-021) - occurrence -> asset_type (1:N); AHU-01/02 share the type
  ('e2000000-0000-0000-0000-0000000000a1', 'rel_defines_by_type', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a0', 'seed'),
  ('e2000000-0000-0000-0000-0000000000a2', 'rel_defines_by_type', 'a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a0', 'seed'),
  -- 13. associates_classification (D-023) - union of facets (Pr_ on the type, Ss_ on AHU-01)
  ('e6000000-0000-0000-0000-0000000000a0', 'rel_associates_classification', 'a0000000-0000-0000-0000-0000000000a0', 'c2000000-0000-0000-0000-000000000001', 'seed'),  -- TYPE → Pr_70_65_04
  ('e6000000-0000-0000-0000-0000000000a1', 'rel_associates_classification', 'a0000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-000000000002', 'seed')   -- AHU-01 → Ss_55_70_70
on conflict (id) do nothing;

-- Edges with `role` (member_of, assigns_to_actor, associates_document)
insert into relationships (id, rel_type, from_id, to_id, role, valid_from, source) values
  -- 10. member_of (D-024) - person -> organization
  ('e3000000-0000-0000-0000-0000000000b1', 'rel_member_of', 'a0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b0', 'Facility Manager', now(), 'seed'),
  -- 11. assigns_to_actor (D-020) - Ján Novák: two DIFFERENT acting roles
  ('e4000000-0000-0000-0000-0000000000a1', 'rel_assigns_to_actor', 'a0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000a1', 'operator',   '2024-03-01T00:00:00Z', 'seed'),
  ('e4000000-0000-0000-0000-0000000000a2', 'rel_assigns_to_actor', 'a0000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000a2', 'maintainer', '2024-03-01T00:00:00Z', 'seed'),
  -- 12. associates_document (D-014) - manual attached to AHU-01
  ('e5000000-0000-0000-0000-0000000000a1', 'rel_associates_document', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c0', 'manual', now(), 'seed')
on conflict (id) do nothing;
