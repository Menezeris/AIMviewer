import { revalidateProject } from "@/lib/data/revalidate";
import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import { isValidGeorefV1 } from "@/lib/data/drawing";
import { calibrationFromV1, editCalibration, isValidCalibration, mergeCalibration, visibilityOnlyUpdate, type GeorefCalibration, type GeorefV1 } from "@/lib/data/georef";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * Writing the georeference of a drawing (D-072): PATCH saves the calibration into `_georef` in the
 * `properties` of the document object (`objects.properties`, a reserved
 * `_` key like `_drawing_links` - the `documents` table has no properties).
 * Called by the host page after the bridge message `UNDERLAY_SAVE` from the embed viewer.
 * D-133: `_georef` is v2 (a list of calibrations); a v1 from the panel is merged as
 * `source: manual` in place of the same page and storey, `calibration` (a v2
 * item) is merged as it came. Manual has the last word, hence `force` here.
 *
 * Protection: the viewer is so far public read-only (D-025/D-026), so the ONLY
 * write endpoint is behind the env gate - default OFF, demo/staging turns it
 * on via `UNDERLAY_WRITE_ENABLED=true`. Plus origin guard + per-IP
 * rate limit (pattern D-068). An honest conscious limit until auth arrives.
 */

const WRITE_ENABLED = process.env.UNDERLAY_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(
  process.env.UNDERLAY_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.UNDERLAY_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const underlayLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

/** UUID format of `objects.id` - a cheap validation before the DB query. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function patchHandler(
  req: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const projectId = currentProjectId();
  if (!WRITE_ENABLED) {
    return NextResponse.json(
      { error: "zápis georeferencie je vypnutý (UNDERLAY_WRITE_ENABLED)" },
      { status: 403 }
    );
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = underlayLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  const { documentId } = await params;
  if (!UUID_RE.test(documentId)) {
    return NextResponse.json({ error: "invalid document id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = body as { georef?: unknown; calibration?: unknown; calibrationIndex?: unknown } | null;
  let next: GeorefCalibration;
  let v1: GeorefV1 | null = null;
  // D-179: a v2 item (section, vertical underlay) from the viewer; edits an existing calibration, never adds a new one.
  const g2 = b?.georef as { version?: unknown } | undefined;
  const isV2Edit = !!g2 && typeof g2 === "object" && g2.version === 2;
  if (isV2Edit) {
    if (!isValidCalibration(b!.georef)) return NextResponse.json({ error: "invalid _georef payload" }, { status: 400 });
    const idx = b!.calibrationIndex;
    if (idx !== undefined && (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx > 49)) {
      return NextResponse.json({ error: "invalid calibrationIndex" }, { status: 400 });
    }
    next = b!.georef as GeorefCalibration;
  } else if (isValidGeorefV1(b?.georef)) {
    v1 = b!.georef as GeorefV1;
    next = calibrationFromV1(v1, "manual");
  } else if (isValidCalibration(b?.calibration)) next = b!.calibration as GeorefCalibration;
  else return NextResponse.json({ error: "invalid _georef payload" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // The target must be an existing document - properties are merged, not overwritten.
  const { data: obj, error: oErr } = await supabase
    .from("objects")
    .select("id, object_type, properties")
    .eq("project_id", projectId)
    .eq("id", documentId)
    .maybeSingle();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });
  if (!obj || obj.object_type !== "document") {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  const current = (obj.properties as Record<string, unknown> | null) ?? {};
  if (isV2Edit) {
    const edit = editCalibration(current._georef, next, b!.calibrationIndex as number | undefined, { by: "panel", reason: "úprava v paneli Underlays (rez)", at: new Date().toISOString() });
    if (!edit.ok) return NextResponse.json({ error: "calibration not found" }, { status: 404 });
    const { error: eErr } = await supabase.from("objects").update({ properties: { ...current, _georef: edit.georef } }).eq("project_id", projectId).eq("id", documentId);
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
    revalidateProject(projectId);
    return NextResponse.json({ ok: true });
  }
  // D-168: a v1 with an unchanged position (SET_UNDERLAYS_3D with persist) changes only visible and opacity, source stays (auto stays auto).
  const visibilityOnly = v1 ? visibilityOnlyUpdate(current._georef, v1) : null;
  // History (D-168): overwriting the position from the panel keeps the previous calibration; visible/opacity alone do not.
  const meta = { by: "panel" as const, reason: v1 ? "úprava v paneli Underlays" : "kalibrácia cez PATCH /api/underlay", at: new Date().toISOString() };
  const merged = mergeCalibration(current._georef, visibilityOnly ?? next, true, meta);
  if (!merged.ok) return NextResponse.json({ error: "merge failed" }, { status: 409 });
  const properties = { ...current, _georef: merged.georef };
  const { error: uErr } = await supabase
    .from("objects")
    .update({ properties })
    .eq("project_id", projectId)
    .eq("id", documentId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Viewer/drawing data is read via the ISR tag `aim`. Next 16 requires a
  // profile; `{expire: 0}` on the legacy unstable_cache tag may behave like
  // stale-while-revalidate (one request still gets the old response, the next a fresh one)
  // - that is enough for underlays, the viewer keeps georef in the session. Verify live (F7).
  revalidateProject(projectId);

  return NextResponse.json({ ok: true });
}

export const PATCH = withRequestAuth(withRequestProject(patchHandler), { source: "app:/api/underlay/[documentId]", write: true });
