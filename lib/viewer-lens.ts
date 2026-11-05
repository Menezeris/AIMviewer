/**
 * Lens from chat (D-096): wire format of the `lens` op in `/ifc?ops=` and its translation to the
 * bridge message `APPLY_LENS` of the viewer fork (`apps/viewer/src/aim/aimLens.ts`).
 * One source for the server (`lib/llm/style-lens.ts` composes) and the client
 * (`components/ifc-viewer.tsx` fills in the zone and sends). No dependencies.
 *
 * Op: `lens:<mode>[~r=<rev>]:<base64url JSON>`. The JSON carries Lens rules
 * (`FilterGroup` from `@ifc-lite/rules`) assembled on the server. What only the AIM
 * graph knows goes symbolically: a zone with elements in spaces as an `aim_zone` rule
 * with zone ids, elements of a document or its page (D-104 step 4) as `aim_document`.
 * The client fetches the GUIDs from `/api/style-scope` and replaces them with a
 * `globalId` rule, so the URL length does not limit the size of a zone or document.
 */

export const LENS_MODES = ["add", "replace", "clear", "unisolate"] as const;
export type LensMode = (typeof LENS_MODES)[number];
/** `isolate` = isolation or X-ray only without color (the viewer holds them in its own channel, not lens). */
export const LENS_ACTIONS = ["colorize", "transparent", "hide", "isolate"] as const;
export type LensAction = (typeof LENS_ACTIONS)[number];
export const AUTO_COLOR_SOURCES = [
  "ifcType",
  "attribute",
  "property",
  "quantity",
  "classification",
  "material",
  "model",
  "group",
] as const;
export type AutoColorSource = (typeof AUTO_COLOR_SOURCES)[number];

/** Filter rule (subset of `FilterRule` from `@ifc-lite/rules`) + symbolic AIM zone. */
export type LensFilterRule = { kind: string; [k: string]: unknown };
export interface LensFilterGroup {
  combinator: "AND" | "OR";
  rules: LensFilterRule[];
}
/** Symbolic zone: zone ids (objects.id), GUIDs are filled in by the client. */
export interface AimZoneRule {
  kind: "aim_zone";
  ids: string[];
}
/** Symbolic document (D-104 step 4): elements the document or its page relates to, GUIDs are filled in by the client. */
export interface AimDocumentRule {
  kind: "aim_document";
  /** objects.id of the document or of the reference to its part. */
  id: string;
  /** 1-based page; without it the whole document. */
  page?: number;
}

export interface LensWireRule {
  /** Name of the rule in the Lens panel (group label). */
  n: string;
  a: LensAction;
  /** Hex `#rrggbb`; missing for `isolate`. */
  c?: string;
  g: LensFilterGroup[];
}

export interface LensWire {
  r?: LensWireRule[];
  /** Isolate the union of all rules (colored and uncolored). */
  i?: 1;
  /** X-ray context from the union of rules: selected full, the rest translucent (D-105). Not combined with `i`. */
  x?: 1;
  /**
   * X-ray context for storeys only (D-140, #187): normalized labels (1NP, 2NP); the viewer hides elements of other storeys
   * while the X-ray from chat lasts. Applies only with `x`.
   */
  cs?: string[];
  ac?: { source: AutoColorSource; psetName?: string; propertyName?: string };
  /** Scope of `ac` (D-119): colors by value, legend and counts only for elements of these groups (AND within a group). */
  s?: LensFilterGroup[];
  /**
   * Legend size (D-119): `large` = Lens panel as a large window, `normal` = back to the bar,
   * `compact` = a small card with only the AIM chat lens, Lens panel closed (D-125).
   */
  l?: LegendSize;
}

export const LEGEND_SIZES = ["compact", "large", "normal"] as const;
export type LegendSize = (typeof LEGEND_SIZES)[number];

/** At most this many zones and documents in one message (each = one query to `/api/style-scope`). */
export const MAX_LENS_ZONES = 8;
/** Cap on zone GUIDs the client sends to the viewer (same as the fork bridge). */
export const MAX_ZONE_GUIDS = 5000;
const MAX_RULES = 24;
/** At most this many storeys in the X-ray context (like `xrayStoreys` of the fork bridge). */
export const MAX_CONTEXT_STOREYS = 8;
const HEX = /^#[0-9a-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(raw: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(raw)) return null;
  try {
    const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The `lens` op in wire format D-066 (base64url contains no `;` or `:`). */
export function lensOp(mode: LensMode, wire: LensWire | null, rev?: string): string {
  const arg = rev ? `${mode}~r=${rev.replace(/[^A-Za-z0-9_-]/g, "")}` : mode;
  return `lens:${arg}:${wire ? toBase64Url(JSON.stringify(wire)) : ""}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function validGroup(g: unknown): g is LensFilterGroup {
  if (!isObj(g) || (g.combinator !== "AND" && g.combinator !== "OR") || !Array.isArray(g.rules)) return false;
  return g.rules.length > 0 && g.rules.every((r) => isObj(r) && typeof r.kind === "string");
}

/** Unpacks the JSON of the `lens` op; input is from the URL, so faulty parts -> `null`. */
export function decodeLensWire(raw: string): LensWire | null {
  if (!raw) return {};
  const text = fromBase64Url(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;
  const out: LensWire = {};
  if (parsed.r !== undefined) {
    if (!Array.isArray(parsed.r) || parsed.r.length > MAX_RULES) return null;
    for (const r of parsed.r) {
      if (!isObj(r) || typeof r.n !== "string" || !(LENS_ACTIONS as readonly unknown[]).includes(r.a)) return null;
      const colorOk = r.a === "isolate" ? r.c === undefined : typeof r.c === "string" && HEX.test(r.c);
      if (!colorOk || !Array.isArray(r.g) || !r.g.every(validGroup)) return null;
    }
    out.r = parsed.r as LensWireRule[];
  }
  if (parsed.i === 1) out.i = 1;
  if (parsed.x === 1) out.x = 1;
  if (out.i && out.x) return null;
  if (parsed.cs !== undefined) {
    const ok = Array.isArray(parsed.cs) && parsed.cs.length > 0 && parsed.cs.length <= MAX_CONTEXT_STOREYS;
    if (!out.x || !ok || !(parsed.cs as unknown[]).every((v) => typeof v === "string" && v.length > 0 && v.length <= 60)) return null;
    out.cs = parsed.cs as string[];
  }
  if (parsed.ac !== undefined) {
    if (!isObj(parsed.ac) || !(AUTO_COLOR_SOURCES as readonly unknown[]).includes(parsed.ac.source)) return null;
    out.ac = parsed.ac as LensWire["ac"];
  }
  if (parsed.s !== undefined) {
    if (!out.ac || !Array.isArray(parsed.s) || parsed.s.length === 0 || !parsed.s.every(validGroup)) return null;
    out.s = parsed.s as LensFilterGroup[];
  }
  if (parsed.l !== undefined) {
    if (!(LEGEND_SIZES as readonly unknown[]).includes(parsed.l)) return null;
    out.l = parsed.l as LegendSize;
  }
  return out;
}

const DOC_KEY = /^doc:([0-9a-f-]{36})(?::([1-9][0-9]{0,4}))?$/i;

/**
 * Keys of the symbolic sets of a rule: zone id (`aim_zone`) or `doc:<id>[:<page>]`
 * (`aim_document`). Under this key the client holds the GUIDs from `/api/style-scope`.
 */
function scopeKeysOf(rule: LensFilterRule): string[] {
  if (rule.kind === "aim_zone" && Array.isArray(rule.ids)) {
    return (rule.ids as unknown[]).filter((id): id is string => typeof id === "string" && UUID.test(id));
  }
  if (rule.kind === "aim_document" && typeof rule.id === "string" && UUID.test(rule.id)) {
    return [documentScopeKey(rule.id, Number.isInteger(rule.page) && (rule.page as number) > 0 ? (rule.page as number) : undefined)];
  }
  return [];
}

/** Keys of zones and documents from all rules (without duplicates). */
export function lensScopeKeys(wire: LensWire): string[] {
  const keys = new Set<string>();
  // The value-color scope (`s`, D-119) can also carry a zone or document.
  for (const g of [...(wire.r ?? []).flatMap((r) => r.g), ...(wire.s ?? [])]) for (const rule of g.rules) for (const k of scopeKeysOf(rule)) keys.add(k);
  return [...keys].slice(0, MAX_LENS_ZONES);
}

/** Document key in the GUID map (`lensScopeKeys`, `lensBridgeMessage`). */
export function documentScopeKey(id: string, page?: number): string {
  return `doc:${id}${page ? `:${page}` : ""}`;
}

/**
 * Lens of the "Show in 3D" button with an open document (D-104 step 4, fork message
 * `DOCUMENT_SHOW_3D`): elements of the page or of the whole document stay full, the rest
 * of the model is translucent (X-ray, D-105). The rule carries the document name as a label.
 */
export function documentLensWire(id: string, name: string, page?: number): LensWire {
  const rule: LensFilterRule = { kind: "aim_document", id, ...(page ? { page } : {}) } satisfies AimDocumentRule;
  return {
    r: [{ n: (page ? `${name}, s. ${page}` : name).slice(0, 120), a: "isolate", g: [{ combinator: "AND", rules: [rule] }] }],
    x: 1,
  };
}

/** Query string of `/api/style-scope` for a key from `lensScopeKeys` (bad key -> `null`). */
export function scopeQuery(key: string): string | null {
  if (UUID.test(key)) return `zone=${encodeURIComponent(key)}`;
  const m = DOC_KEY.exec(key);
  if (!m) return null;
  return `document=${encodeURIComponent(m[1])}${m[2] ? `&page=${m[2]}` : ""}`;
}

/**
 * Bridge message `APPLY_LENS`: replaces `aim_zone` and `aim_document` rules with
 * `globalId` with GUIDs (`scopeGuids` by key from `lensScopeKeys`; a missing
 * zone or document = empty list, i.e. nothing).
 */
export function lensBridgeMessage(
  mode: LensMode,
  wire: LensWire,
  scopeGuids: ReadonlyMap<string, readonly string[]>,
  rev?: string,
): Record<string, unknown> {
  // The fork bridge accepts at most MAX_ZONE_GUIDS GlobalIds in one message in total.
  let budget = MAX_ZONE_GUIDS;
  for (const g of [...(wire.r ?? []).flatMap((r) => r.g), ...(wire.s ?? [])]) {
    for (const rule of g.rules) if (rule.kind === "globalId" && Array.isArray(rule.values)) budget -= rule.values.length;
  }
  const swap = (rule: LensFilterRule): LensFilterRule => {
    if (rule.kind !== "aim_zone" && rule.kind !== "aim_document") return rule;
    const guids = new Set<string>();
    for (const key of scopeKeysOf(rule)) for (const g of scopeGuids.get(key) ?? []) guids.add(g);
    const values = [...guids].slice(0, Math.max(0, budget));
    budget -= values.length;
    return { kind: "globalId", op: "in", values };
  };
  const rules = (wire.r ?? []).map((r) => ({
    name: r.n.slice(0, 120) || "výber",
    action: r.a,
    ...(r.c ? { color: r.c } : {}),
    groups: r.g.map((g) => ({ combinator: g.combinator, rules: g.rules.map(swap) })),
  }));
  return {
    type: "APPLY_LENS",
    mode,
    ...(rev ? { rev } : {}),
    ...(rules.length ? { rules } : {}),
    ...(wire.i ? { isolate: true } : {}),
    ...(wire.x ? { xray: true } : {}),
    ...(wire.x && wire.cs ? { xrayStoreys: wire.cs } : {}),
    ...(wire.ac ? { autoColor: wire.ac } : {}),
    ...(wire.ac && wire.s ? { autoColorScope: wire.s.map((g) => ({ combinator: g.combinator, rules: g.rules.map(swap) })) } : {}),
    ...(wire.l ? { legend: wire.l } : {}),
  };
}
