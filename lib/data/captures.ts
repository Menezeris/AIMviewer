import "server-only";

import { unstable_cache } from "next/cache";

import { AIM_CACHE } from "@/lib/data/constants";
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
 * Data-access vrstva pre Reality Capture (D-073). Model „ako dokumenty" (D-018):
 * capture point = `objects` riadok `object_type='capture'` + prípona `captures`,
 * jednotlivá snímka/verzia = `objects` `object_type='capture_media'` + prípona
 * `capture_media`. Ukotvenie (2D plán pin + 3D world pin) žije v rezervovanom
 * `objects.properties._capture` JSONB (vzor `_georef`, D-072).
 *
 * Hrany (D-051 manifest, prvé `aim_`): `aim_rel_capture_located` (capture → space)
 * a `aim_rel_capture_media` (capture → capture_media). Čítame kanonické views;
 * zápis ide na base `relationships` (views nie sú insertovateľné).
 *
 * Čítanie je server-only (`service_role`, D-026) + ISR tag `aim`. Zápisové helpery
 * (nižšie) volajú route handlery za env bránou `CAPTURE_WRITE_ENABLED` (D-068/D-072).
 *
 * Čisté typy + validácia `_capture` žijú v `./capture-placement` (unit-testovateľné
 * bez server-only); tu ich re-exportujeme pre pohodlie volajúcich.
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

// ─── Čítanie ─────────────────────────────────────────────────────────────────

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

/** Aktívne médiá capture pointov → mapa capturePointId → zoradené médiá. */
async function fetchActiveMediaByPoint(
  captureIds: string[]
): Promise<Map<string, CaptureMediaWire[]>> {
  const out = new Map<string, CaptureMediaWire[]>();
  if (captureIds.length === 0) return out;

  const supabase = getSupabaseAdmin();

  // capture point → médiá (aktívne väzby), potom detail médií z prípony.
  const { data: edges, error: eErr } = await supabase
    .from("aim_rel_capture_media")
    .select("from_id, to_id")
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

  // Zoradenie od najnovšej + odvodenie „aktuálnej" verzie (najnovší captured_at).
  for (const [id, list] of out) {
    list.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
    if (list.length > 0) list[0].isCurrent = true;
    out.set(id, list);
  }
  return out;
}

/** Doplní capture point objekty (name, kind, placement, spaceId) k daným id. */
async function hydrateCapturePoints(captureIds: string[]): Promise<CapturePointWire[]> {
  if (captureIds.length === 0) return [];
  const supabase = getSupabaseAdmin();

  const [objsRes, kindsRes, spaceRes, mediaByPoint] = await Promise.all([
    supabase.from("objects").select("id, name, properties").in("id", captureIds),
    supabase.from("captures").select("id, kind").in("id", captureIds),
    supabase
      .from("aim_rel_capture_located")
      .select("from_id, to_id")
      .in("from_id", captureIds)
      .is("valid_until", null),
    fetchActiveMediaByPoint(captureIds),
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

async function fetchCapturesForSpaceImpl(spaceId: string): Promise<CapturePointWire[]> {
  const supabase = getSupabaseAdmin();
  // Obojsmernosť: capture pointy naviazané na tento priestor (to_id = space).
  const { data: edges, error } = await supabase
    .from("aim_rel_capture_located")
    .select("from_id")
    .eq("to_id", spaceId)
    .is("valid_until", null);
  if (error) throw new Error(error.message);

  const captureIds = [...new Set(((edges ?? []) as { from_id: string }[]).map((e) => e.from_id))];
  const points = await hydrateCapturePoints(captureIds);
  // Stabilné poradie: podľa mena capture pointu.
  points.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return points;
}

/** Captures naviazané na priestor (ISR, tag `aim`). Obojsmerné čítanie „fotky priestoru". */
export const fetchCapturesForSpace = unstable_cache(
  fetchCapturesForSpaceImpl,
  ["fetch-captures-for-space"],
  AIM_CACHE
);

async function fetchCaptureDetailImpl(id: string): Promise<CapturePointWire | null> {
  const supabase = getSupabaseAdmin();
  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj || obj.object_type !== "capture") return null;
  const [point] = await hydrateCapturePoints([id]);
  return point ?? null;
}

/** Detail capture pointu vrátane verzií médií (ISR, tag `aim`). */
export const fetchCaptureDetail = unstable_cache(
  fetchCaptureDetailImpl,
  ["fetch-capture-detail"],
  AIM_CACHE
);

async function fetchAllCapturePointsImpl(): Promise<CapturePointWire[]> {
  const supabase = getSupabaseAdmin();
  // Kardinalita capture pointov je nízka (jednotky/desiatky) — bez stránkovania.
  // Pri väčších objemoch prejsť na fetchAllPages (vzor `fetchGuidMap`).
  const { data: caps, error } = await supabase
    .from("objects")
    .select("id")
    .eq("object_type", "capture")
    .is("valid_until", null); // odstránená fotka (D-088) sa nezobrazí
  if (error) throw new Error(error.message);
  const captureIds = (caps ?? []).map((c) => c.id as string);
  return hydrateCapturePoints(captureIds);
}

/** Všetky capture pointy (pre 3D bridge + overlay na 2D vieweri), ISR tag `aim`. */
export const fetchAllCapturePoints = unstable_cache(
  fetchAllCapturePointsImpl,
  ["fetch-all-capture-points"],
  AIM_CACHE
);

async function fetchCapturePinsImpl(): Promise<CaptureViewerWire[]> {
  const points = await fetchAllCapturePointsImpl();
  const out: CaptureViewerWire[] = [];
  for (const p of points) {
    const world = p.placement?.world;
    if (!world) continue; // 3D pin vyžaduje world ukotvenie (F2 authoring)
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

/** Capture piny s 3D world ukotvením pre embed viewer (bridge `CAPTURES_LOAD`). */
export const fetchCapturePins = unstable_cache(
  fetchCapturePinsImpl,
  ["fetch-capture-pins"],
  AIM_CACHE
);

/**
 * Capture piny s 2D plán ukotvením na daný dokument (overlay v drawing vieweri).
 *
 * ZÁMERNE NECACHOVANÉ: volá to len klientský `CapturePlanOverlay` a hneď po
 * umiestnení pinu (PATCH `/api/captures/[id]`) musí `refetch()` vidieť čerstvý
 * stav (read-after-write na rovnakej DB). `unstable_cache` + `revalidateTag` sa
 * na legacy tagu správa ako stale-while-revalidate a prvý refetch by vrátil starý
 * (bezpinový) zoznam → pin by sa nezobrazil (vzor pozn. v `/api/underlay`).
 */
export async function fetchCapturesForDocument(documentId: string): Promise<CapturePlanPinWire[]> {
  const points = await fetchAllCapturePointsImpl();
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

async function fetchCaptureSummaryForObjectImpl(objectId: string): Promise<CaptureSummary> {
  const supabase = getSupabaseAdmin();
  const empty: CaptureSummary = { spaceId: null, spaceName: null, count: 0 };

  const { data: obj, error } = await supabase
    .from("objects")
    .select("id, object_type, name")
    .eq("id", objectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!obj) return empty;

  // Priestor objektu: sám (space) alebo obsahujúci priestor prvku (asset →
  // rel_contained_in_spatial_structure, vzor fetchSpaceSiblings v filter.ts).
  let spaceId: string;
  let spaceName: string | null;
  if (obj.object_type === "space") {
    spaceId = obj.id as string;
    spaceName = (obj.name as string | null) ?? null;
  } else {
    const { data: parent, error: pErr } = await supabase
      .from("rel_contained_in_spatial_structure")
      .select("to_id")
      .eq("from_id", objectId)
      .is("valid_until", null)
      .limit(1)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent) return empty;
    const { data: sp, error: sErr } = await supabase
      .from("objects")
      .select("id, object_type, name")
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
    .eq("to_id", spaceId)
    .is("valid_until", null);
  if (cErr) throw new Error(cErr.message);

  return { spaceId, spaceName, count: count ?? 0 };
}

/**
 * Súhrn Reality Capture pre objekt vybraný v 3D (AIM karta, D-073): priestor +
 * počet snímok. Prvok (asset) sa mapuje na svoj obsahujúci priestor. ISR tag `aim`.
 */
export const fetchCaptureSummaryForObject = unstable_cache(
  fetchCaptureSummaryForObjectImpl,
  ["fetch-capture-summary-for-object"],
  AIM_CACHE
);

/**
 * Dokument pôdorysu podlažia, na ktorom leží priestor (pre „umiestniť na pláne").
 * space → floor (`rel_aggregates`) → drawing (`rel_associates_document` role='drawing').
 * Vráti `objects.id` výkresu, alebo null ak podlažie nemá pôdorys.
 */
export async function fetchPlanDocumentForSpace(spaceId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data: parent, error: pErr } = await supabase
    .from("rel_aggregates")
    .select("to_id")
    .eq("from_id", spaceId)
    .is("valid_until", null)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  const floorId = parent?.to_id as string | undefined;
  if (!floorId) return null;

  const { data: docs, error: dErr } = await supabase
    .from("rel_associates_document")
    .select("to_id")
    .eq("from_id", floorId)
    .eq("role", "drawing")
    .is("valid_until", null);
  if (dErr) throw new Error(dErr.message);
  const docIds = ((docs ?? []) as { to_id: string }[]).map((d) => d.to_id);
  if (docIds.length === 0) return null;

  // Uprednostni dokument so supabase PDF (má location); inak prvý.
  const { data: withPdf } = await supabase
    .from("documents")
    .select("id")
    .in("id", docIds)
    .eq("storage_type", "supabase")
    .limit(1)
    .maybeSingle();
  return (withPdf?.id as string | undefined) ?? docIds[0];
}

/** Čiastočná zmena ukotvenia — merge `plan`/`world`/`yaw` do existujúceho `_capture`. */
export interface CapturePlacementPatch {
  plan?: CapturePlanAnchor | null;
  world?: CaptureWorldAnchor | null;
  yaw?: number | null;
}

/**
 * Aktualizuje ukotvenie capture pointu (authoring pinov, D-073). Merguje zadané
 * kľúče do existujúceho `_capture` (null = zmazať kľúč), nič iné neprepisuje.
 * Vráti výsledný placement. Volajúci route handler validuje vstup.
 */
export async function updateCapturePlacement(
  id: string,
  patch: CapturePlacementPatch
): Promise<CapturePlacement> {
  const supabase = getSupabaseAdmin();
  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .select("object_type, properties")
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
    .eq("id", id);
  if (uErr) throw new Error(uErr.message);
  return merged;
}

// ─── Zápis (volané z route handlerov za env bránou; nie cachované) ────────────

let bucketEnsured = false;

/**
 * Idempotentne zabezpečí VEREJNÝ bucket `captures` (vzor `etl/doc_upload.py`).
 * Ak bucket neexistuje → vytvor public. Ak existuje ale NIE je public →
 * `updateBucket` na public (inak by `getPublicUrl` vracal 400 a `<img>` by boli
 * broken — self-heal aj pre bucket vytvorený skôr/privátne).
 */
export async function ensureCapturesBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.storage.getBucket(CAPTURES_BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(CAPTURES_BUCKET, { public: true });
    // Konkurenčný vznik (409) toleruj — bucket už existuje.
    if (error && !/exist/i.test(error.message)) throw new Error(error.message);
  } else if (!data.public) {
    const { error } = await supabase.storage.updateBucket(CAPTURES_BUCKET, { public: true });
    if (error) throw new Error(error.message);
  }
  bucketEnsured = true;
}

/** Verejná URL objektu v bucket `captures`. */
export function capturesPublicUrl(key: string): string {
  const supabase = getSupabaseAdmin();
  return supabase.storage.from(CAPTURES_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Nahrá binárny obsah do bucket `captures` (upsert) a vráti verejnú URL. Kľúče nesú `randomUUID`, obsah sa nemení, preto rok (D-135 dodatok). */
export async function uploadCaptureObject(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string
): Promise<string> {
  await ensureCapturesBucket();
  const supabase = getSupabaseAdmin();
  // Blob (nie raw Node Buffer): supabase-js `upload` s Bufferom vie na serverless
  // (undici) uložiť 0-bajtový súbor → broken <img>. Blob nesie definitívnu veľkosť.
  // Cast: Node Buffer je Uint8Array<ArrayBufferLike> — za behu platný BlobPart,
  // len DOM lib typ chce Uint8Array<ArrayBuffer>.
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
  /** `objects.id` priestoru (IfcSpace) — sémantické ukotvenie. */
  spaceId: string;
  placement: CapturePlacement;
  /** Proveniencia (survey-session batch, D-065) — ide na hranu. */
  source?: string | null;
}

/**
 * Vytvorí capture point: `objects`+`captures` riadok, `_capture` placement,
 * hrana `aim_rel_capture_located` na priestor. Vráti nové `objects.id`.
 * Volajúci route handler validuje `spaceId` (existujúci `object_type='space'`).
 */
export async function createCapturePoint(input: CreateCapturePointInput): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .insert({
      object_type: "capture",
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
 * Pridá snímku/verziu k capture pointu (append-only): `objects`+`capture_media`
 * riadok + hrana `aim_rel_capture_media`. „Aktuálna" verzia sa odvodí z
 * najnovšieho `captured_at` (nič sa needituje in-place). Vráti nové media id.
 */
export async function addCaptureMedia(
  captureId: string,
  input: AddCaptureMediaInput
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .insert({ object_type: "capture_media", name: null })
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
    rel_type: "aim_rel_capture_media",
    from_id: captureId,
    to_id: mediaId,
    source: input.source ?? "capture_upload (D-073)",
  });
  if (rErr) throw new Error(rErr.message);

  return mediaId;
}

/** Overí, že `id` je existujúci capture point (`object_type='capture'`). */
export async function captureExists(id: string): Promise<boolean> {
  return (await getCaptureKind(id)) !== null;
}

/** Vráti `kind` capture pointu (`photo`/`pano360`), alebo null ak `id` nie je capture. */
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

/** Overí, že `id` je existujúci priestor (`object_type='space'`). */
export async function spaceExists(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("object_type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && data.object_type === "space";
}
