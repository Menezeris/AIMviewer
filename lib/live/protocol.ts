/**
 * Spätný kanál viewer -> Claude (D-085): otázka a odpoveď cez ten istý
 * Supabase Realtime kanál ako príkazy (D-079). Spoločné pre server
 * (`query.ts`) aj prehliadač (`components/live-channel.tsx`), bez závislostí.
 *
 * Server pošle udalosť `query` {id, query, guids?}; otvorený viewer ju odovzdá
 * forku (`QUERY` bridge správa) a odpoveď vráti udalosťou `reply` s tým istým id.
 */

export const LIVE_QUERY_EVENT = "query";
export const LIVE_REPLY_EVENT = "reply";

export const VIEWER_QUERIES = ["bounds", "view_state"] as const;
export type ViewerQuery = (typeof VIEWER_QUERIES)[number];

/** Rovnaké limity ako most forku (`apps/viewer/src/aim/view-protocol.ts`). */
export const MAX_QUERY_GUIDS = 100;
const MAX_ID = 64;

export interface LiveQueryPayload {
  id: string;
  query: ViewerQuery;
  guids?: string[];
}

export type LiveReplyPayload =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function isLiveQuery(p: unknown): p is LiveQueryPayload {
  if (!p || typeof p !== "object") return false;
  const q = p as Record<string, unknown>;
  return (
    isStr(q.id) &&
    q.id.length <= MAX_ID &&
    (VIEWER_QUERIES as readonly unknown[]).includes(q.query) &&
    (q.guids === undefined ||
      (Array.isArray(q.guids) && q.guids.length <= MAX_QUERY_GUIDS && q.guids.every(isStr)))
  );
}

export function isLiveReply(p: unknown): p is LiveReplyPayload {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return isStr(r.id) && (r.ok === true || (r.ok === false && typeof r.error === "string"));
}
