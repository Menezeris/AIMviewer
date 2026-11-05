import "server-only";

import { createRateLimiter } from "../api-guard";

import type { SnapshotOutcome } from "./api";
import { documentSnapshot, SnapshotError, type SnapshotRequest } from "./snapshot";
import { SnapshotRenderError } from "./snapshot-render";
import { defaultSnapshotSource } from "./snapshot-runtime";

/**
 * Shared by routes with a region snapshot (D-158 step 3): `/api/drawing/<id>/snapshot` and the BCF API
 * `.../viewpoints/<guid>/snapshot`. The per-IP limit (D-068) covers on-demand rendering; the viewer
 * asks for the snapshot of every comment when loading topics, so the window is generous.
 */

const MAX = Number(process.env.SNAPSHOT_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 240 : 0));
const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: MAX });

export async function snapshotFor(req: SnapshotRequest, ipKey: string): Promise<SnapshotOutcome> {
  if (MAX > 0) {
    const rate = limiter.check(`snapshot:${ipKey}`);
    if (!rate.allowed) return { ok: false, status: 429, message: "Priveľa snímok naraz, skús o chvíľu.", retryAfter: rate.retryAfterSeconds };
  }
  try {
    const r = await documentSnapshot(defaultSnapshotSource(), req);
    return { ok: true, png: r.png, revisionChanged: r.revision_changed };
  } catch (e) {
    if (e instanceof SnapshotError) return { ok: false, status: e.status, message: e.message };
    if (e instanceof SnapshotRenderError) return { ok: false, status: 400, message: e.message };
    return { ok: false, status: 502, message: `Snímka sa nevyrobila: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** PNG response; the content for the same key (sha256, page, region) does not change, only the document revision does. */
export function pngHeaders(revisionChanged: boolean): Record<string, string> {
  return {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=3600",
    ...(revisionChanged ? { "X-AIM-Revision-Changed": "1" } : {}),
  };
}
