-- =============================================================================
-- D-073 - Reality Capture v1 (photos + static 360° panoramas)
-- =============================================================================
-- Additive migration (AGENTS.md: migrations are never deleted or edited).
--
-- Visual condition survey of reality tied to the model (D-065 "platform feature":
-- 360°/2D/3D linked to IFC). The model follows exactly the spirit of "like documents" (D-014/D-032):
--   * capture point  = objects row object_type='capture'  + thin extension `captures`.
--                      The anchoring (2D plan pin + 3D world pin) lives in the reserved
--                      properties._capture JSONB (pattern of _georef, D-072) - no columns,
--                      versioned + validated in the app layer.
--   * capture medium = objects row object_type='capture_media' + extension
--                      `capture_media` (analog of `documents`: location=public URL,
--                      storage_type, dimensions, captured_at, valid_from/valid_until).
-- Versioning of the same location over time = several capture_media per capture point,
-- append-only (valid_until IS NULL = current version; nothing is edited in place).
--
-- EDGES (D-051 meta-model): two NEW `aim_`-namespace entries in the manifest
-- `relationship_types`. IFC has no clean concept for a "reality-capture point with versioned media"
-- → `aim_` namespace + export to an ICDD linkset (D-015/D-048 convention;
-- these are the FIRST aim_ edges, until now only a forward convention). We deliberately do NOT extend
-- `rel_contained_in_spatial_structure` with object_type 'capture' - we keep captures out of
-- the IFC-canonical asset/spatial reads (no leak into "elements in a space").
--   * aim_rel_capture_located  capture → space|floor  (where the capture is; unique-active)
--   * aim_rel_capture_media     capture → capture_media (its images/versions; 1:N)
-- Bidirectionality ("photos of a space" ↔ "space of a photo") falls out of the edge for free.
--
-- Storage: public Supabase Storage bucket `captures` (pattern `documents`/`ifc`) -
-- the bucket is created idempotently from the app upload route (not by an SQL migration;
-- Storage lives outside the public schema). Serving = direct public CDN URL in capture_media.location.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Type extensions (1:1 to objects, ON DELETE CASCADE) - style of documents/floors
-- -----------------------------------------------------------------------------

-- Capture point: registration of a location. `kind` discriminates the medium; the anchoring
-- (plan/world/yaw) is in objects.properties._capture (reserved _key, §4).
create table captures (
  id   uuid primary key references objects(id) on delete cascade,
  kind text not null                 -- 'photo' | 'pano360' (validated in the app/ETL, not CHECK - D-018)
);

-- One image / version tied to a capture point (analog of IfcDocumentInformation).
create table capture_media (
  id               uuid primary key references objects(id) on delete cascade,
  location         text,             -- public URL of the original (Supabase Storage)
  preview_location text,             -- reduced equirect/photo preview (fast loading)
  thumb_location   text,             -- thumbnail (gallery / pin)
  storage_type     text not null default 'supabase',   -- like documents.storage_type (D-032)
  media_type       text,             -- 'image/jpeg' | 'image/png' ...
  width            int,
  height           int,
  captured_at      timestamptz,      -- CAPTURE DATE → order of the location's versions over time
  valid_from       timestamptz not null default now(),
  valid_until      timestamptz       -- NULL = current version (append-only, never delete)
);
create index on capture_media (valid_until);

-- -----------------------------------------------------------------------------
-- 2) Edge manifest - two new aim_ entries (D-051/D-048)
--    is_ifc_rel=false, namespace='aim', export_path='icdd' (ICDD linkset, D-015).
--    ifc_entity/ifc_family = null (IFC has no such concept).
-- -----------------------------------------------------------------------------
insert into relationship_types
  (rel_type, ifc_entity, ifc_family, is_ifc_rel, relating_end,
   from_object_types, to_object_types, to_is_classification,
   namespace, export_path, unique_active_from, description)
values
  ('aim_rel_capture_located', null, null, false, 'to',
   array['capture'], array['space', 'floor'], false,
   'aim', 'icdd', true,
   'Reality-capture bod umiestnený v priestore/podlaží (D-073). unique-active: 1 aktívny priestor na capture.'),
  ('aim_rel_capture_media', null, null, false, 'from',
   array['capture'], array['capture_media'], false,
   'aim', 'icdd', false,
   'Reality-capture bod → jeho snímky/verzie (D-073). 1:N, append-only cez valid_from/valid_until.');

-- -----------------------------------------------------------------------------
-- 3) Canonical views (same pattern as the rel_* views) - the read layer of captures
--    queries these, not the base `relationships`.
-- -----------------------------------------------------------------------------
create view aim_rel_capture_located as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'aim_rel_capture_located';

create view aim_rel_capture_media as
  select id, from_id, to_id, valid_from, valid_until, source
  from relationships where rel_type = 'aim_rel_capture_media';

-- -----------------------------------------------------------------------------
-- 4) Integrity + hot-path indexes (per rel_type literal, pattern §2.6)
-- -----------------------------------------------------------------------------
-- unique-active-parent: 1 active space per capture (corresponds to unique_active_from).
create unique index uniq_active_capture_located on relationships (from_id)
  where rel_type = 'aim_rel_capture_located' and valid_until is null;

-- "media of this capture point" (gallery/versions) - frequent read by from_id.
create index idx_relationships_capture_media_from on relationships (from_id)
  where rel_type = 'aim_rel_capture_media';

-- "captures in this space" (bidirectionality) - read by to_id.
create index idx_relationships_capture_located_to on relationships (to_id)
  where rel_type = 'aim_rel_capture_located';

commit;
