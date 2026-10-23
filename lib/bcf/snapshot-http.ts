import "server-only";

import { createRateLimiter } from "../api-guard";

import type { SnapshotOutcome } from "./api";
import { documentSnapshot, SnapshotError, type SnapshotRequest } from "./snapshot";
import { SnapshotRenderError } from "./snapshot-render";
import { defaultSnapshotSource } from "./snapshot-runtime";

/**
 * Spoločné pre routes so snímkou výrezu (D-158 krok 3): `/api/drawing/<id>/snapshot` a BCF API
 * `.../viewpoints/<guid>/snapshot`. Limit na IP (D-068) kryje render na požiadanie; viewer
 * pri načítaní tém pýta snímku každej pripomienky, preto je okno štedré.
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

/** PNG odpoveď; obsah pre ten istý kľúč (sha256, strana, oblasť) sa nemení, len revízia dokumentu. */
export function pngHeaders(revisionChanged: boolean): Record<string, string> {
  return {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=3600",
    ...(revisionChanged ? { "X-AIM-Revision-Changed": "1" } : {}),
  };
}
