/**
 * Spätný kanál viewer -> Claude (D-085): otázka a odpoveď cez ten istý
 * Supabase Realtime kanál ako príkazy (D-079). Spoločné pre server
 * (`query.ts`) aj prehliadač (`components/live-channel.tsx`), bez závislostí.
 *
 * Server pošle udalosť `query` {id, query, guids?}; otvorený viewer ju odovzdá
 * forku (`QUERY` bridge správa) a odpoveď vráti udalosťou `reply` s tým istým id.
 */

export const LIVE_QUERY_EVENT = "query";

/** Testovací kanál pracovných sessions (D-159): `<LIVE_CHANNEL>-test`, nikdy viewer používateľa. */
export const LIVE_TEST_SUFFIX = "-test";

/** Prostredie živého kanála vo vieweri (D-159): produkcia (chat používateľa) alebo testy sessions. */
export type LiveKind = "prod" | "test";

/** Kanál pre vybrané prostredie: testy sessions = `<kanál>-test`. */
export const channelFor = (base: string, kind: LiveKind) => (kind === "test" ? `${base}${LIVE_TEST_SUFFIX}` : base);

/** `?live=` s príponou testovacieho kanála = základný kanál + výber testov; inak platí uložený výber karty. */
export function splitChannel(name: string, storedKind: string | null): { base: string; kind: LiveKind } {
  if (name.endsWith(LIVE_TEST_SUFFIX)) return { base: name.slice(0, -LIVE_TEST_SUFFIX.length), kind: "test" };
  return { base: name, kind: storedKind === "test" ? "test" : "prod" };
}
export const LIVE_REPLY_EVENT = "reply";

/** `lens_state` = počty AIM chat lens po `style_in_3d` (D-096). */
export const VIEWER_QUERIES = ["bounds", "view_state", "lens_state"] as const;
export type ViewerQuery = (typeof VIEWER_QUERIES)[number];

/** Rovnaké limity ako most forku (`apps/viewer/src/aim/view-protocol.ts`). */
export const MAX_QUERY_GUIDS = 100;
const MAX_ID = 64;

export interface LiveQueryPayload {
  id: string;
  query: ViewerQuery;
  guids?: string[];
  /** Verzia lens pri `lens_state` - viewer počká na jej vyhodnotenie. */
  rev?: string;
  /** Rozhovor, ktorý sa pýta (D-159): odpoveď povie, či viewer ovláda on. */
  sid?: string;
}

/**
 * Kto ovláda okno viewera z pohľadu pýtajúceho sa rozhovoru (D-159): `you` = tento chat,
 * `other` = iný chat (príkazy odtiaľto sa nevykonajú), `none` = zatiaľ nikto.
 */
export type ViewerOwner = "you" | "other" | "none";

/**
 * `viewer` = náhodná identita okna s `?live=` na jedno načítanie stránky (D-125): na kanál
 * môže odpovedať viac okien (karty, telefón) a ich stav sa líši; starší klient ju nemá.
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

/** Identita okna viewera (D-125): krátky reťazec, inak sa ignoruje. */
export const isViewerId = (v: unknown): v is string => isStr(v) && v.length <= MAX_ID;

/** Nová identita okna viewera pri načítaní stránky (D-125). */
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
 * Potvrdenie príkazu (D-101): server pošle príkaz s `cmdId`, viewer ho vykoná a
 * po dobehnutí jeho krokov vráti udalosť `applied` so stavom po aplikovaní.
 */
export const LIVE_APPLIED_EVENT = "applied";

export interface LiveAppliedPayload {
  cmdId: string;
  /** Okno, ktoré príkaz potvrdilo (D-125). */
  viewer?: string;
  ok: boolean;
  /** Čo sa vo vieweri vykonať nedalo (napr. prvok sa nenašiel). */
  issues: string[];
  state?: unknown;
  /** `foreign` = okno ovláda iný chat a príkaz nevykonalo (D-159). */
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
