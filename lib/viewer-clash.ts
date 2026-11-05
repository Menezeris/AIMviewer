/**
 * Clash detection from AIM in the viewer (D-164, #292): wire format of messages `CLASH_LOAD`, `CLASH_SAVED` (host -> viewer)
 * and `CLASH_SAVE` (viewer -> host), mirror of `apps/viewer/src/aim/clash-protocol.ts` in the fork, and the viewer op
 * `clash_open`, by which the chat opens the clash panel with a test and (optionally) a run.
 *
 * A test has the shape of a test in AIM (`lib/engine/clash-tests.ts`: sets A/B as a class selector + model + storey, mode, mm);
 * conversion to `ClashPreset` (filterA/filterB) is done by the fork. The clash key (`clash_key`) is always composed by the host from the pair
 * `model:GUID` and the test code, the viewer sends elements, not its own keys.
 *
 * The op carries only references (test code, run): clashes do not belong in a live-channel message, the host client fetches them from
 * `GET /api/clash` and sends the viewer `CLASH_LOAD`.
 * Op: `clash_open::<base64url JSON {test, run?}>`.
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";

export const CLASH_SOURCE = "aim-bridge" as const;
export const CLASH_STATUSES = ["open", "resolved", "accepted"] as const;
export type ClashReviewState = (typeof CLASH_STATUSES)[number];
const KINDS = ["hard", "clearance"] as const;
const SEVERITIES = ["critical", "major", "minor", "info"] as const;

/** Cap on clashes in `CLASH_LOAD` (message to the iframe); above it `results_truncated` with the total count. */
export const MAX_LOAD_RESULTS = 3000;
/** Cap on clashes in `CLASH_SAVE` (Vercel request body ~4.5 MB); above it the viewer narrows the test. */
export const MAX_SAVE_RESULTS = 10_000;
/** Cap on state changes in one message. */
export const MAX_SAVE_REVIEWS = 2000;
const MAX_TEXT = 200;
const MAX_COMMENT = 2000;

export interface ClashSideWire {
  /** Selector of upstream IFC classes: `IfcDuct*|IfcPipe*`, `!IfcSpace`, `*`. */
  type: string;
  model?: string;
  storey?: string;
  load_bearing?: "true" | "false" | "unknown";
}

export interface ClashTestWire {
  code?: string;
  name: string;
  description?: string;
  a: ClashSideWire;
  b?: ClashSideWire;
  mode: "hard" | "clearance";
  clearance_mm?: number;
  tolerance_mm?: number;
}

export interface ClashElementWire {
  model: string;
  guid: string;
  type?: string;
  name?: string;
}

export interface ClashResultWire {
  kind: "hard" | "clearance";
  severity: (typeof SEVERITIES)[number];
  /** m; negative = penetration depth. */
  distance: number;
  a: ClashElementWire;
  b: ClashElementWire;
  storey?: string | null;
  /** [x, y, z] in the IFC world (m, Z up). */
  center?: number[] | null;
  /** Host -> viewer: state and note from AIM; clash key as AIM holds it. */
  key?: string;
  review?: ClashReviewState;
  comment?: string;
}

export interface ClashReviewWire {
  a: ClashElementWire;
  b: ClashElementWire;
  status: ClashReviewState;
  comment?: string;
}

export interface ClashSaveWire {
  /** Code of the test to which the run and states belong when the message does not carry the test itself. */
  test_code?: string;
  test?: ClashTestWire;
  run?: { models?: Record<string, unknown>; truncated?: boolean; results: ClashResultWire[] };
  reviews?: ClashReviewWire[];
}

export interface ClashOpenReq {
  /** Code or name of the test. */
  test: string;
  /** UUID of the saved run, or `latest`; without it only the test is loaded. */
  run?: string;
}

export type ClashOpenOp = { op: "clash_open" } & ClashOpenReq;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === "string" && (set as readonly string[]).includes(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const CLASH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clashOpenOp(req: ClashOpenReq): string {
  return `clash_open::${toBase64Url(JSON.stringify(req))}`;
}

/** `clash_open` from the wire format; null = invalid (the op is skipped). */
export function parseClashOp(joined: string): ClashOpenOp | null {
  const raw = joined ? fromBase64Url(joined) : null;
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || !isText(v.test)) return null;
  const run = isText(v.run) && (v.run === "latest" || CLASH_UUID_RE.test(v.run)) ? v.run : undefined;
  if (v.run !== undefined && !run) return null;
  return { op: "clash_open", test: v.test.trim(), ...(run ? { run } : {}) };
}

function side(v: unknown): ClashSideWire | null {
  if (!isObj(v) || !isText(v.type)) return null;
  if (v.model !== undefined && !isText(v.model)) return null;
  if (v.storey !== undefined && !isText(v.storey)) return null;
  const lb = v.load_bearing === "true" || v.load_bearing === "false" || v.load_bearing === "unknown" ? v.load_bearing : undefined;
  return { type: v.type.trim(), ...(v.model ? { model: (v.model as string).trim() } : {}), ...(v.storey ? { storey: (v.storey as string).trim() } : {}), ...(lb ? { load_bearing: lb } : {}) };
}

export function parseClashTest(v: unknown): ClashTestWire | null {
  if (!isObj(v) || !isText(v.name) || !oneOf(v.mode, KINDS)) return null;
  const a = side(v.a);
  if (!a) return null;
  let b: ClashSideWire | null = null;
  if (v.b !== undefined && v.b !== null) {
    b = side(v.b);
    if (!b) return null;
  }
  if (v.code !== undefined && v.code !== null && !isText(v.code, 80)) return null;
  if (v.description !== undefined && v.description !== null && typeof v.description !== "string") return null;
  for (const k of ["clearance_mm", "tolerance_mm"] as const) {
    if (v[k] !== undefined && v[k] !== null && (!isNum(v[k]) || (v[k] as number) < 0 || (v[k] as number) > 100_000)) return null;
  }
  if (v.mode === "clearance" && !(isNum(v.clearance_mm) && v.clearance_mm > 0)) return null;
  return {
    ...(v.code ? { code: (v.code as string).trim() } : {}),
    name: v.name.trim(),
    ...(typeof v.description === "string" && v.description.trim() ? { description: v.description.trim().slice(0, MAX_COMMENT) } : {}),
    a,
    ...(b ? { b } : {}),
    mode: v.mode,
    ...(v.mode === "clearance" ? { clearance_mm: v.clearance_mm as number } : {}),
    ...(isNum(v.tolerance_mm) ? { tolerance_mm: v.tolerance_mm } : {}),
  };
}

function element(v: unknown): ClashElementWire | null {
  if (!isObj(v) || !isText(v.model) || !isText(v.guid, 64)) return null;
  const type = typeof v.type === "string" && v.type ? v.type.slice(0, MAX_TEXT) : undefined;
  const name = typeof v.name === "string" && v.name ? v.name.slice(0, MAX_TEXT) : undefined;
  return { model: v.model.trim(), guid: v.guid.trim(), ...(type ? { type } : {}), ...(name ? { name } : {}) };
}

function result(v: unknown): ClashResultWire | null {
  if (!isObj(v) || !oneOf(v.kind, KINDS) || !isNum(v.distance)) return null;
  const a = element(v.a);
  const b = element(v.b);
  if (!a || !b) return null;
  const severity = oneOf(v.severity, SEVERITIES) ? v.severity : "info";
  const center = Array.isArray(v.center) && v.center.length === 3 && v.center.every(isNum) ? (v.center as number[]) : null;
  return {
    kind: v.kind,
    severity,
    distance: v.distance,
    a,
    b,
    storey: typeof v.storey === "string" && v.storey ? v.storey.slice(0, MAX_TEXT) : null,
    center,
  };
}

function review(v: unknown): ClashReviewWire | null {
  if (!isObj(v) || !oneOf(v.status, CLASH_STATUSES)) return null;
  const a = element(v.a);
  const b = element(v.b);
  if (!a || !b) return null;
  if (v.comment !== undefined && typeof v.comment !== "string") return null;
  const comment = typeof v.comment === "string" ? v.comment.slice(0, MAX_COMMENT) : undefined;
  return { a, b, status: v.status, ...(comment !== undefined ? { comment } : {}) };
}

/** Save from the viewer panel (`CLASH_SAVE`) after shape validation; null = invalid. A bad row invalidates the whole message, nothing is silently omitted. */
export function parseClashSave(data: unknown): ClashSaveWire | null {
  if (!isObj(data)) return null;
  const out: ClashSaveWire = {};
  if (data.test_code !== undefined) {
    if (!isText(data.test_code, 80)) return null;
    out.test_code = data.test_code.trim();
  }
  if (data.test !== undefined) {
    const t = parseClashTest(data.test);
    if (!t) return null;
    out.test = t;
  }
  if (data.run !== undefined) {
    const r = data.run;
    if (!isObj(r) || !Array.isArray(r.results) || r.results.length > MAX_SAVE_RESULTS) return null;
    const rows = r.results.map(result);
    if (rows.some((x) => x === null)) return null;
    out.run = {
      results: rows as ClashResultWire[],
      ...(isObj(r.models) ? { models: r.models } : {}),
      ...(r.truncated === true ? { truncated: true } : {}),
    };
  }
  if (data.reviews !== undefined) {
    if (!Array.isArray(data.reviews) || data.reviews.length > MAX_SAVE_REVIEWS) return null;
    const rows = data.reviews.map(review);
    if (rows.some((x) => x === null)) return null;
    out.reviews = rows as ClashReviewWire[];
  }
  if (!out.test && !out.run && !out.reviews) return null;
  return out;
}

/** What `GET /api/clash?test=` returns and what `CLASH_LOAD` is composed from. */
export interface ClashLoadPayload {
  test: ClashTestWire & { code: string; origin: string };
  run?: { id: string; created_at: string; trigger: string; total: number | null; by_status: Record<string, number> | null; models: Record<string, unknown>; truncated?: boolean };
  results?: ClashResultWire[];
  results_total?: number;
  results_truncated?: boolean;
}

export function clashLoadMessage(payload: ClashLoadPayload): Record<string, unknown> {
  return {
    type: "CLASH_LOAD",
    test: payload.test,
    ...(payload.run ? { run: payload.run } : {}),
    ...(payload.results ? { results: payload.results, results_total: payload.results_total ?? payload.results.length, ...(payload.results_truncated ? { results_truncated: true } : {}) } : {}),
  };
}

export type ClashSaveResult =
  | { ok: true; test_code?: string; run_id?: string; results?: number; reviews?: number; notes?: string[] }
  | { ok: false; error: string };

export function clashSavedMessage(result: ClashSaveResult): Record<string, unknown> {
  return result.ok
    ? {
        type: "CLASH_SAVED",
        ok: true,
        ...(result.test_code ? { test_code: result.test_code } : {}),
        ...(result.run_id ? { run_id: result.run_id } : {}),
        ...(result.results !== undefined ? { results: result.results } : {}),
        ...(result.reviews !== undefined ? { reviews: result.reviews } : {}),
        ...(result.notes?.length ? { notes: result.notes } : {}),
      }
    : { type: "CLASH_SAVED", ok: false, error: result.error.slice(0, 2000) };
}
