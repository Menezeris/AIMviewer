import { revalidateProject } from "@/lib/data/revalidate";
import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import {
  captureExists,
  fetchCaptureDetail,
  isValidCaptureV1,
  updateCapturePlacement,
  type CapturePlacementPatch,
} from "@/lib/data/captures";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * Capture point (D-073).
 * `GET   /api/captures/{id}` - detail + media versions (read-only, D-026).
 * `PATCH /api/captures/{id}` - merge of the anchoring (`plan`/`world`/`yaw`) into `_capture`
 *   (pin authoring: 2D plan pin, 3D world pin). Behind the env gate `CAPTURE_WRITE_ENABLED`
 *   + origin guard + rate limit (pattern D-068/D-072).
 */

const WRITE_ENABLED = process.env.CAPTURE_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(
  process.env.CAPTURE_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.CAPTURE_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const patchLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getHandler(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = currentProjectId();
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const capture = await fetchCaptureDetail(projectId, id);
    if (!capture) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(capture, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[api/captures/[id] GET]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

async function patchHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = currentProjectId();
  if (!WRITE_ENABLED) {
    return NextResponse.json(
      { error: "zápis captures je vypnutý (CAPTURE_WRITE_ENABLED)" },
      { status: 403 }
    );
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = patchLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // We accept a partial patch (plan/world/yaw); we validate it as a placement where
  // only the given keys are present (`isValidCaptureV1` checks their shape).
  const patch: CapturePlacementPatch = {};
  const probe: Record<string, unknown> = { version: 1 };
  if ("plan" in b) {
    patch.plan = b.plan === null ? null : (b.plan as CapturePlacementPatch["plan"] ?? null);
    if (b.plan !== null) probe.plan = b.plan;
  }
  if ("world" in b) {
    patch.world = b.world === null ? null : (b.world as CapturePlacementPatch["world"] ?? null);
    if (b.world !== null) probe.world = b.world;
  }
  if ("yaw" in b) {
    patch.yaw = b.yaw === null ? null : (b.yaw as number);
    if (b.yaw !== null) probe.yaw = b.yaw;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no placement keys (plan/world/yaw)" }, { status: 400 });
  }
  if (!isValidCaptureV1(probe)) {
    return NextResponse.json({ error: "invalid placement payload" }, { status: 400 });
  }
  // The plan-pin document must be a UUID (shape, not existence).
  if (patch.plan && !UUID_RE.test(patch.plan.documentId)) {
    return NextResponse.json({ error: "invalid plan.documentId" }, { status: 400 });
  }

  try {
    if (!(await captureExists(id))) {
      return NextResponse.json({ error: "capture not found" }, { status: 404 });
    }
    const placement = await updateCapturePlacement(projectId, id, patch);
    revalidateProject(projectId);
    return NextResponse.json({ ok: true, placement });
  } catch (err) {
    console.error("[api/captures/[id] PATCH]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export const GET = withRequestAuth(withRequestProject(getHandler), { source: "app:/api/captures/[id]", write: false });
export const PATCH = withRequestAuth(withRequestProject(patchHandler), { source: "app:/api/captures/[id]", write: true });
