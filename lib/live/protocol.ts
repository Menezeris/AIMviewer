/**
 * Back channel viewer -> Claude (D-085): a question and answer over the same
 * Supabase Realtime channel as the commands (D-079). Shared by the server
 * (`query.ts`) and the browser (`components/live-channel.tsx`), no dependencies.
 *
 * The server sends a `query` event {id, query, guids?}; an open viewer hands it to the
 * fork (`QUERY` bridge message) and returns the answer as a `reply` event with the same id.
 */

export const LIVE_QUERY_EVENT = "query";

/** Test channel of working sessions (D-159): `<LIVE_CHANNEL>-test`, never the user's viewer. */
export const LIVE_TEST_SUFFIX = "-test";

/** Live channel environment in the viewer (D-159): production (the user's chat) or session tests. */
export type LiveKind = "prod" | "test";

/** Channel for the selected environment: session tests = `<channel>-test`. */
export const channelFor = (base: string, kind: LiveKind) => (kind === "test" ? `${base}${LIVE_TEST_SUFFIX}` : base);

/** `?live=` with the test channel suffix = base channel + test selection; otherwise the saved tab selection applies. */
export function splitChannel(name: string, storedKind: string | null): { base: string; kind: LiveKind } {
  if (name.endsWith(LIVE_TEST_SUFFIX)) return { base: name.slice(0, -LIVE_TEST_SUFFIX.length), kind: "test" };
  return { base: name, kind: storedKind === "test" ? "test" : "prod" };
}
export const LIVE_REPLY_EVENT = "reply";

/** `lens_state` = counts of the AIM chat lens after `style_in_3d` (D-096). */
export const VIEWER_QUERIES = ["bounds", "view_state", "lens_state"] as const;
export type ViewerQuery = (typeof VIEWER_QUERIES)[number];

/** The same limits as the fork bridge (`apps/viewer/src/aim/view-protocol.ts`). */
export const MAX_QUERY_GUIDS = 100;
const MAX_ID = 64;

export interface LiveQueryPayload {
  id: string;
  query: ViewerQuery;
  guids?: string[];
  /** Lens version for `lens_state` - the viewer waits for its evaluation. */
  rev?: string;
  /** Conversation asking (D-159): the answer says whether the viewer is controlled by it. */
  sid?: string;
}

/**
 * Who controls the viewer window from the point of view of the asking conversation (D-159): `you` = this chat,
 * `other` = another chat (commands from here are not executed), `none` = nobody yet.
 */
export type ViewerOwner = "you" | "other" | "none";

/**
 * `viewer` = random identity of a window with `?live=` for one page load (D-125): several windows
 * (tabs, phone) can answer on the channel and their state differs; an older client does not have it.
 */
export type LiveReplyPayload =
  | { id: string; ok: true; result: unknown; viewer?: string; owner?: ViewerOwner }
  | { id: string; ok: false; error: string; viewer?: string; owner?: ViewerOwner };

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function isLiveQuery(p: unknown): p is LiveQueryPayload {
  if (!p || typeof p !== "object") return false;
  const q = p as Record<string, unknown>;
  return (
    isStr(q.id) &&
    q.id.length <= MAX_ID &&
    (VIEWER_QUERIES as readonly unknown[]).includes(q.query) &&
    (q.guids === undefined ||
      (Array.isArray(q.guids) && q.guids.length <= MAX_QUERY_GUIDS && q.guids.every(isStr))) &&
    (q.rev === undefined || (isStr(q.rev) && q.rev.length <= MAX_ID)) &&
    (q.sid === undefined || (isStr(q.sid) && q.sid.length <= MAX_ID))
  );
}

/** Viewer window identity (D-125): a short string, otherwise ignored. */
export const isViewerId = (v: unknown): v is string => isStr(v) && v.length <= MAX_ID;

/** New viewer window identity on page load (D-125). */
export function newViewerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isLiveReply(p: unknown): p is LiveReplyPayload {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    isStr(r.id) &&
    (r.viewer === undefined || isViewerId(r.viewer)) &&
    (r.ok === true || (r.ok === false && typeof r.error === "string"))
  );
}

/**
 * Command acknowledgement (D-101): the server sends a command with `cmdId`, the viewer executes it and
 * after its steps finish returns an `applied` event with the state after applying.
 */
export const LIVE_APPLIED_EVENT = "applied";

export interface LiveAppliedPayload {
  cmdId: string;
  /** Window that acknowledged the command (D-125). */
  viewer?: string;
  ok: boolean;
  /** What could not be executed in the viewer (e.g. an element was not found). */
  issues: string[];
  state?: unknown;
  /** `foreign` = the window is controlled by another chat and did not execute the command (D-159). */
  rejected?: "foreign";
}

export const isCmdId = (v: unknown): v is string => isStr(v) && v.length <= MAX_ID;

export function isLiveApplied(p: unknown): p is LiveAppliedPayload {
  if (!p || typeof p !== "object") return false;
  const a = p as Record<string, unknown>;
  return (
    isCmdId(a.cmdId) &&
    (a.viewer === undefined || isViewerId(a.viewer)) &&
    typeof a.ok === "boolean" &&
    Array.isArray(a.issues) &&
    a.issues.every((i) => typeof i === "string")
  );
}
