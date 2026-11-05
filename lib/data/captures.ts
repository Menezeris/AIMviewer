import "server-only";

import { cachedProjectRead } from "@/lib/data/revalidate";
import {
  CAPTURES_BUCKET,
  parseCapturePlacement,
  type CaptureKind,
  type CaptureMediaWire,
  type CapturePlacement,
  type CapturePlanAnchor,
  type CapturePlanPinWire,
  type CapturePointWire,
  type CaptureSummary,
  type CaptureViewerWire,
  type CaptureWorldAnchor,
} from "@/lib/data/capture-placement";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Data-access layer for Reality Capture (D-073). The model is "like documents" (D-018):
 * capture point = `objects` row `object_type='capture'` + the `captures` extension,
 * an individual image/version = `objects` `object_type='capture_media'` + the
 * `capture_media` extension. The anchoring (2D plan pin + 3D world pin) lives in the reserved
 * `objects.properties._capture` JSONB (pattern `_georef`, D-072).
 *
 * Edges (D-051 manifest, the first `aim_`): `aim_rel_capture_located` (capture -> space)
 * and `aim_rel_capture_media` (capture -> capture_media). We read the canonical views;
 * writes go to the base `relationships` (views are not insertable).
 *
 * Reads are server-only (`service_role`, D-026) + ISR tag `aim`. The write helpers
 * (below) are called by route handlers behind the env gate `CAPTURE_WRITE_ENABLED` (D-068/D-072).
 *
 * Pure types + `_capture` validation live in `./capture-placement` (unit-testable
 * without server-only); we re-export them here for the convenience of callers.
 */

export {
  CAPTURES_BUCKET,
  isValidCaptureV1,
  parseCapturePlacement,
} from "@/lib/data/capture-placement";
export type {
  CaptureKind,
  CapturePlanAnchor,
  CaptureWorldAnchor,
  CapturePlacement,
  CaptureMediaWire,
  CapturePlanPinWire,
  CapturePointWire,
  CaptureSummary,
  CaptureViewerWire,
} from "@/lib/data/capture-placement";

// --- Reads ---------------------------------------------------------------------

type MediaRow = {
  id: string;
  location: string | null;
  preview_location: string | null;
  thumb_location: string | null;
  media_type: string | null;
  width: number | null;
  height: number | null;
  captured_at: string | null;
};

/** Active media of capture points -> map capturePointId -> sorted media. */
async function fetchActiveMediaByPoint(
  projectId: string,
  captureIds: string[]
): Promise<Map<string, CaptureMediaWire[]>> {
  const out = new Map<string, CaptureMediaWire[]>();
  if (captureIds.length === 0) return out;

  const supabase = getSupabaseAdmin();

  // capture point -> media (active links), then the media detail from the extension.
  const { data: edges, error: eErr } = await supabase
    .from("aim_rel_capture_media")
    .select("from_id, to_id")
    .eq("project_id", projectId)
    .in("from_id", captureIds)
    .is("valid_until", null);
  if (eErr) throw new Error(eErr.message);

  const mediaIds = [...new Set(((edges ?? []) as { to_id: string }[]).map((e) => e.to_id))];
  if (mediaIds.length === 0) return out;

  const { data: media, error: mErr } = await supabase
    .from("capture_media")
    .select("id, location, preview_location, thumb_location, media_type, width, height, captured_at")
    .in("id", mediaIds)
    .is("valid_until", null);
  if (mErr) throw new Error(mErr.message);

  const mediaById = new Map((media ?? []).map((m) => [m.id as string, m as MediaRow]));

  for (const e of (edges ?? []) as { from_id: string; to_id: string }[]) {
    const m = mediaById.get(e.to_id);
    if (!m) continue;
    const list = out.get(e.from_id) ?? [];
    list.push({
      id: m.id,
      location: m.location,
      previewLocation: m.preview_location,
      thumbLocation: m.thumb_location,
      mediaType: m.media_type,
      width: m.width,
      height: m.height,
      capturedAt: m.captured_at,
      isCurrent: false,
    });
    out.set(e.from_id, list);
  }

  // Sort from the newest + derive the "current" version (newest captured_at).
  for (const [id, list] of out) {
    list.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
    if (list.length > 0) list[0].isCurrent = true;
    out.set(id, list);
  }
  return out;
}

/** Completes capture point objects (name, kind, placement, spaceId) for the given ids. */
async function hydrateCapturePoints(projectId: string, captureIds: string[]): Promise<CapturePointWire[]> {
  if (captureIds.length === 0) return [];
  const supabase = getSupabaseAdmin();

  const [objsRes, kindsRes, spaceRes, mediaByPoint] = await Promise.all([
    supabase.from("objects").select("id, name, properties").eq("project_id", projectId).in("id", captureIds),
    supabase.from("captures").select("id, kind").in("id", captureIds),
    supabase
      .from("aim_rel_capture_located")
      .select("from_id, to_id")
      .eq("project_id", projectId)
      .in("from_id", captureIds)
      .is("valid_until", null),
    fetchActiveMediaByPoint(projectId, captureIds),
  ]);
  if (objsRes.error) throw new Error(objsRes.error.message);
  if (kindsRes.error) throw new Error(kindsRes.error.message);
  if (spaceRes.error) throw new Error(spaceRes.error.message);

  const kindById = new Map(
    (kindsRes.data ?? []).map((k) => [k.id as string, k.kind as CaptureKind])
  );
  const spaceById = new Map(
    ((spaceRes.data ?? []) as { from_id: string; to_id: string }[]).map((r) => [
      r.from_id,
      r.to_id,
    ])
  );

  const out: CapturePointWire[] = [];
  for (const obj of objsRes.data ?? []) {
    const id = obj.id as string;
    const placement = parseCapturePlacement(
      (obj.properties as Record<string, unknown> | null)?.["_capture"]
    );
    out.push({
      id,
      name: (obj.name as string | null) ?? null,
      kind: kindById.get(id) ?? "photo",
      spaceId: spaceById.get(id) ?? null,
      placement,
      media: mediaByPoint.get(id) ?? [],
    });
  }
  return out;
}

async function fetchCapturesForSpaceImpl(projectId: string, spaceId: string): Promise<CapturePointWire[]> {
  const supabase = getSupabaseAdmin();
  // Bidirectionality: capture points linked to this space (to_id = space).
  const { data: edges, error } = await supabase
    .from("aim_rel_capture_located")
    .select("from_id")
    .eq("project_id", projectId)
    .eq("to_id", spaceId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const captureIds = [...new Set(((edges ?? []) as { from_id: string }[]).map((e) => e.from_id))];
  const points = await hydrateCapturePoints(projectId, captureIds);
  // Stable order: by capture point name.
  points.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return points;
}

/** Captures linked to a space (ISR, tag `aim`). Bidirectional read of "photos of a space". */
export const fetchCapturesForSpace = cachedProjectRead("fetch-captures-for-space", fetchCapturesForSpaceImpl);

async function fetchCaptureDetailImpl(projectId: string, id: string): Promise<CapturePointWire | null> {
  const supabase = getSupabaseAdmin();
  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_type")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj || obj.object_type !== "capture") return null;
  const [point] = await hydrateCapturePoints(projectId, [id]);
  return point ?? null;
}

/** Capture point detail including media versions (ISR, tag `aim`). */
export const fetchCaptureDetail = cachedProjectRead("fetch-capture-detail", fetchCaptureDetailImpl);

async function fetchAllCapturePointsImpl(projectId: string): Promise<CapturePointWire[]> {
  const supabase = getSupabaseAdmin();
  // The cardinality of capture points is low (units/tens) - no pagination.
  // For larger volumes switch to fetchAllPages (pattern `fetchGuidMap`).
  const { data: caps, error } = await supabase
    .from("objects")
    .select("id")
    .eq("project_id", projectId)
    .eq("object_type", "capture")
    .is("valid_until", null); // a removed photo (D-088) is not shown
  if (error) throw new Error(error.message);
  const captureIds = (caps ?? []).map((c) => c.id as string);
  return hydrateCapturePoints(projectId, captureIds);
}

/** All capture points (for the 3D bridge + overlay on the 2D viewer), ISR tag `aim`. */
export const fetchAllCapturePoints = cachedProjectRead("fetch-all-capture-points", fetchAllCapturePointsImpl);

async function fetchCapturePinsImpl(projectId: string): Promise<CaptureViewerWire[]> {
  const points = await fetchAllCapturePointsImpl(projectId);
  const out: CaptureViewerWire[] = [];
  for (const p of points) {
    const world = p.placement?.world;
    if (!world) continue; // a 3D pin requires world anchoring (F2 authoring)
    const current = p.media[0];
    out.push({
      id: p.id,
      kind: p.kind,
      world,
      name: p.name ?? undefined,
      thumbUrl: current?.thumbLocation ?? undefined,
      spaceId: p.spaceId,
    });
  }
  return out;
}

/** Capture pins with 3D world anchoring for the embed viewer (bridge `CAPTURES_LOAD`). */
export const fetchCapturePins = cachedProjectRead("fetch-capture-pins", fetchCapturePinsImpl);

/**
 * Capture pins with 2D plan anchoring to the given document (overlay in the drawing viewer).
 *
 * INTENTIONALLY NOT CACHED: it is called only by the client `CapturePlanOverlay` and right after
 * placing a pin (PATCH `/api/captures/[id]`) the `refetch()` must see the fresh
 * state (read-after-write on the same DB). `unstable_cache` + `revalidateTag` on the
 * legacy tag behaves like stale-while-revalidate and the first refetch would return the old
 * (pinless) list -> the pin would not appear (pattern note in `/api/underlay`).
 */
export async function fetchCapturesForDocument(projectId: string, documentId: string): Promise<CapturePlanPinWire[]> {
  const points = await fetchAllCapturePointsImpl(projectId);
  const out: CapturePlanPinWire[] = [];
  for (const p of points) {
    const plan = p.placement?.plan;
    if (!plan || plan.documentId !== documentId) continue;
    const current = p.media[0];
    out.push({
      id: p.id,
      kind: p.kind,
      name: p.name ?? undefined,
      spaceId: p.spaceId,
      thumbUrl: current?.thumbLocation ?? undefined,
      previewUrl: current?.previewLocation ?? current?.location ?? undefined,
      origUrl: current?.location ?? undefined,
      yaw: p.placement?.yaw,
      page: plan.page,
      u: plan.u,
      v: plan.v,
    });
  }
  return out;
}

async function fetchCaptureSummaryForObjectImpl(projectId: string, objectId: string): Promise<CaptureSummary> {
  const supabase = getSupabaseAdmin();
  const empty: CaptureSummary = { spaceId: null, spaceName: null, count: 0 };

  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_type, name")
    .eq("project_id", projectId)
    .eq("id", objectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj) return empty;

  // Object's space: itself (space) or the containing space of an element (asset ->
  // rel_contained_in_spatial_structure, pattern fetchSpaceSiblings in filter.ts).
  let spaceId: string;
  let spaceName: string | null;
  if (obj.object_type === "space") {
    spaceId = obj.id as string;
    spaceName = (obj.name as string | null) ?? null;
  } else {
    const { data: parent, error: pErr } = await supabase
      .from("rel_contained_in_spatial_structure")
      .select("to_id")
      .eq("project_id", projectId)
      .eq("from_id", objectId)
      .is("valid_until", null)
      .limit(1)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent?.to_id) return empty; // container without an AIM node (D-183 K3)
    const { data: sp, error: sErr } = await supabase
      .from("objects")
      .select("id, object_type, name")
      .eq("project_id", projectId)
      .eq("id", parent.to_id)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!sp || sp.object_type !== "space") return empty;
    spaceId = sp.id as string;
    spaceName = (sp.name as string | null) ?? null;
  }

  const { count, error: cErr } = await supabase
    .from("aim_rel_capture_located")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("to_id", spaceId)
    .is("valid_until", null);
  if (cErr) throw new Error(cErr.message);

  return { spaceId, spaceName, count: count ?? 0 };
}

/**
 * Reality Capture summary for an object selected in 3D (AIM card, D-073): space +
 * number of images. An element (asset) maps to its containing space. ISR tag `aim`.
 */
export const fetchCaptureSummaryForObject = cachedProjectRead("fetch-capture-summary-for-object", fetchCaptureSummaryForObjectImpl);

/**
 * Floor-plan document of the storey the space lies on (for "place on plan").
 * space -> floor (`rel_aggregates`) -> drawing (`rel_associates_document` role='drawing').
 * Returns the `objects.id` of the drawing, or null if the storey has no floor plan.
 */
export async function fetchPlanDocumentForSpace(projectId: string, spaceId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data: parent, error: pErr } = await supabase
    .from("rel_aggregates")
    .select("to_id")
    .eq("project_id", projectId)
    .eq("from_id", spaceId)
    .is("valid_until", null)
    .not("to_id", "is", null)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  const floorId = parent?.to_id as string | undefined;
  if (!floorId) return null;

  const { data: docs, error: dErr } = await supabase
    .from("rel_associates_document")
    .select("to_id")
    .eq("project_id", projectId)
    .eq("from_id", floorId)
    .eq("role", "drawing")
    .is("valid_until", null);
  if (dErr) throw new Error(dErr.message);
  const docIds = ((docs ?? []) as { to_id: string }[]).map((d) => d.to_id);
  if (docIds.length === 0) return null;

  // Prefer the document with a supabase PDF (has a location); otherwise the first.
  const { data: withPdf } = await supabase
    .from("documents")
    .select("id")
    .in("id", docIds)
    .eq("storage_type", "supabase")
    .limit(1)
    .maybeSingle();
  return (withPdf?.id as string | undefined) ?? docIds[0];
}

/** Partial anchoring change - merge `plan`/`world`/`yaw` into the existing `_capture`. */
export interface CapturePlacementPatch {
  plan?: CapturePlanAnchor | null;
  world?: CaptureWorldAnchor | null;
  yaw?: number | null;
}

/**
 * Updates the anchoring of a capture point (pin authoring, D-073). Merges the given
 * keys into the existing `_capture` (null = delete the key), overwrites nothing else.
 * Returns the resulting placement. The calling route handler validates the input.
 */
export async function updateCapturePlacement(
  projectId: string,
  id: string,
  patch: CapturePlacementPatch
): Promise<CapturePlacement> {
  const supabase = getSupabaseAdmin();
  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .select("object_type, properties")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (oErr) throw new Error(oErr.message);
  if (!obj || obj.object_type !== "capture") throw new Error("capture not found");

  const props = (obj.properties as Record<string, unknown> | null) ?? {};
  const current = parseCapturePlacement(props["_capture"]) ?? { version: 1 };
  const merged: CapturePlacement = { ...current, version: 1 };
  if (patch.plan !== undefined) {
    if (patch.plan === null) delete merged.plan;
    else merged.plan = patch.plan;
  }
  if (patch.world !== undefined) {
    if (patch.world === null) delete merged.world;
    else merged.world = patch.world;
  }
  if (patch.yaw !== undefined) {
    if (patch.yaw === null) delete merged.yaw;
    else merged.yaw = patch.yaw;
  }

  const { error: uErr } = await supabase
    .from("objects")
    .update({ properties: { ...props, _capture: merged } })
    .eq("project_id", projectId)
    .eq("id", id);
  if (uErr) throw new Error(uErr.message);
  return merged;
}

// --- Writes (called from route handlers behind the env gate; not cached) ----------

let bucketEnsured = false;

/**
 * Idempotently ensures the PUBLIC bucket `captures` (pattern `etl/doc_upload.py`).
 * If the bucket does not exist -> create it public. If it exists but is NOT public ->
 * `updateBucket` to public (otherwise `getPublicUrl` would return 400 and the `<img>` would be
 * broken - self-heal also for a bucket created earlier/private).
 */
export async function ensureCapturesBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.storage.getBucket(CAPTURES_BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(CAPTURES_BUCKET, { public: true });
    // Tolerate a concurrent creation (409) - the bucket already exists.
    if (error && !/exist/i.test(error.message)) throw new Error(error.message);
  } else if (!data.public) {
    const { error } = await supabase.storage.updateBucket(CAPTURES_BUCKET, { public: true });
    if (error) throw new Error(error.message);
  }
  bucketEnsured = true;
}

/** Public URL of an object in the `captures` bucket. */
export function capturesPublicUrl(key: string): string {
  const supabase = getSupabaseAdmin();
  return supabase.storage.from(CAPTURES_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Uploads binary content to the `captures` bucket (upsert) and returns the public URL. Keys carry `randomUUID`, the content does not change, hence a year (D-135 addendum). */
export async function uploadCaptureObject(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string
): Promise<string> {
  await ensureCapturesBucket();
  const supabase = getSupabaseAdmin();
  // Blob (not a raw Node Buffer): supabase-js `upload` with a Buffer can store a
  // 0-byte file on serverless (undici) -> broken <img>. Blob carries the definitive size.
  // Cast: Node Buffer is Uint8Array<ArrayBufferLike> - a valid BlobPart at runtime,
  // only the DOM lib type wants Uint8Array<ArrayBuffer>.
  const blob = new Blob([body as unknown as BlobPart], { type: contentType });
  const { error } = await supabase.storage
    .from(CAPTURES_BUCKET)
    .upload(key, blob, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return capturesPublicUrl(key);
}

export interface CreateCapturePointInput {
  kind: CaptureKind;
  name?: string | null;
  /** `objects.id` of the space (IfcSpace) - semantic anchoring. */
  spaceId: string;
  placement: CapturePlacement;
  /** Provenance (survey-session batch, D-065) - goes onto the edge. */
  source?: string | null;
}

/**
 * Creates a capture point: `objects`+`captures` row, `_capture` placement,
 * edge `aim_rel_capture_located` to the space. Returns the new `objects.id`.
 * The calling route handler validates `spaceId` (an existing `object_type='space'`).
 */
export async function createCapturePoint(projectId: string, input: CreateCapturePointInput): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .insert({
      object_type: "capture",
      project_id: projectId,
      name: input.name ?? null,
      properties: { _capture: input.placement },
    })
    .select("id")
    .single();
  if (oErr) throw new Error(oErr.message);
  const captureId = obj.id as string;

  const { error: cErr } = await supabase
    .from("captures")
    .insert({ id: captureId, kind: input.kind });
  if (cErr) throw new Error(cErr.message);

  const { error: rErr } = await supabase.from("relationships").insert({
    project_id: projectId,
    rel_type: "aim_rel_capture_located",
    from_id: captureId,
    to_id: input.spaceId,
    source: input.source ?? "capture_upload (D-073)",
  });
  if (rErr) throw new Error(rErr.message);

  return captureId;
}

export interface AddCaptureMediaInput {
  location: string;
  previewLocation?: string | null;
  thumbLocation?: string | null;
  mediaType: string;
  width: number;
  height: number;
  capturedAt?: string | null;
  source?: string | null;
}

/**
 * Adds an image/version to a capture point (append-only): `objects`+`capture_media`
 * row + edge `aim_rel_capture_media`. The "current" version is derived from the
 * newest `captured_at` (nothing is edited in place). Returns the new media id.
 */
export async function addCaptureMedia(
  projectId: string,
  captureId: string,
  input: AddCaptureMediaInput
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .insert({ object_type: "capture_media", project_id: projectId, name: null })
    .select("id")
    .single();
  if (oErr) throw new Error(oErr.message);
  const mediaId = obj.id as string;

  const { error: mErr } = await supabase.from("capture_media").insert({
    id: mediaId,
    location: input.location,
    preview_location: input.previewLocation ?? null,
    thumb_location: input.thumbLocation ?? null,
    storage_type: "supabase",
    media_type: input.mediaType,
    width: input.width,
    height: input.height,
    captured_at: input.capturedAt ?? new Date().toISOString(),
  });
  if (mErr) throw new Error(mErr.message);

  const { error: rErr } = await supabase.from("relationships").insert({
    project_id: projectId,
    rel_type: "aim_rel_capture_media",
    from_id: captureId,
    to_id: mediaId,
    source: input.source ?? "capture_upload (D-073)",
  });
  if (rErr) throw new Error(rErr.message);

  return mediaId;
}

/** Verifies that `id` is an existing capture point (`object_type='capture'`). */
export async function captureExists(id: string): Promise<boolean> {
  return (await getCaptureKind(id)) !== null;
}

/** Returns the `kind` of a capture point (`photo`/`pano360`), or null if `id` is not a capture. */
export async function getCaptureKind(id: string): Promise<CaptureKind | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("captures")
    .select("kind")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.kind as CaptureKind) : null;
}

/** Verifies that `id` is an existing space (`object_type='space'`). */
export async function spaceExists(projectId: string, id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("object_type")
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && data.object_type === "space";
}
