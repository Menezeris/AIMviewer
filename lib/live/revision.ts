/**
 * The "new revision" message on the live channel (D-086). Sent by `etl/model_publish.py
 * announce` after a re-ETL; a viewer with `?live=` refreshes the page and the iframe gets the model URL
 * with the new `?rev=`. No server dependencies - read by the client (`components/live-channel.tsx`).
 */

/** Event in the channel (the same value as `LIVE_REVISION_EVENT` in `etl/model_publish.py`). */
export const LIVE_REVISION_EVENT = "model_revision";

export interface RevisionNotice {
  model: string;
  revision: number;
  summary: string | null;
}

const SUMMARY_MAX = 100;

export function parseRevisionNotice(payload: unknown): RevisionNotice | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.model !== "string" || !/^[\w.-]{1,40}$/.test(p.model)) return null;
  if (typeof p.revision !== "number" || !Number.isInteger(p.revision) || p.revision < 0) return null;
  const summary = typeof p.summary === "string" && p.summary.trim() ? p.summary.trim() : null;
  return { model: p.model, revision: p.revision, summary };
}

export function revisionToast(n: RevisionNotice): string {
  const head = `Nová revízia ${n.model} v${String(n.revision).padStart(3, "0")}`;
  if (!n.summary) return head;
  const s = n.summary.length > SUMMARY_MAX ? `${n.summary.slice(0, SUMMARY_MAX - 1)}…` : n.summary;
  return `${head}: ${s}`;
}
