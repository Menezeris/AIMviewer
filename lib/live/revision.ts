/**
 * Správa "nová revízia" na živom kanáli (D-086). Posiela ju `etl/model_publish.py
 * announce` po re-ETL; viewer s `?live=` obnoví stránku a iframe dostane URL modelu
 * s novým `?rev=`. Bez závislostí na serveri — číta ju klient (`components/live-channel.tsx`).
 */

/** Udalosť v kanáli (rovnaká hodnota ako `LIVE_REVISION_EVENT` v `etl/model_publish.py`). */
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
