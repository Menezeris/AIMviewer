/**
 * Lens z chatu (D-096): wire formát op `lens` v `/ifc?ops=` a jej preklad na
 * bridge správu `APPLY_LENS` forku viewera (`apps/viewer/src/aim/aimLens.ts`).
 * Jeden zdroj pre server (`lib/llm/style-lens.ts` skladá) aj klienta
 * (`components/ifc-viewer.tsx` dopĺňa zónu a posiela). Bez závislostí.
 *
 * Op: `lens:<mode>[~r=<rev>]:<base64url JSON>`. JSON nesie pravidlá Lens
 * (`FilterGroup` z `@ifc-lite/rules`) zostavené na serveri. Čo pozná len graf
 * AIM (zóna s prvkami v miestnostiach), ide symbolicky ako pravidlo `aim_zone`
 * s id zón; klient si GUIDy stiahne z `/api/style-scope` a nahradí ho
 * pravidlom `globalId`, takže dĺžka URL neobmedzuje veľkosť zóny.
 */

export const LENS_MODES = ["add", "replace", "clear", "unisolate"] as const;
export type LensMode = (typeof LENS_MODES)[number];
/** `isolate` = len do izolácie bez farby (viewer izoluje kanálom izolácie, nie lens). */
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

/** Pravidlo filtra (podmnožina `FilterRule` z `@ifc-lite/rules`) + symbolická zóna AIM. */
export type LensFilterRule = { kind: string; [k: string]: unknown };
export interface LensFilterGroup {
  combinator: "AND" | "OR";
  rules: LensFilterRule[];
}
/** Symbolická zóna: id zón (objects.id), GUIDy doplní klient. */
export interface AimZoneRule {
  kind: "aim_zone";
  ids: string[];
}

export interface LensWireRule {
  /** Názov pravidla v paneli Lens (štítok skupiny). */
  n: string;
  a: LensAction;
  /** Hex `#rrggbb`; pri `isolate` chýba. */
  c?: string;
  g: LensFilterGroup[];
}

export interface LensWire {
  r?: LensWireRule[];
  /** Izolovať zjednotenie všetkých pravidiel (farebné aj bez farby). */
  i?: 1;
  ac?: { source: AutoColorSource; psetName?: string; propertyName?: string };
}

/** Najviac zón v jednej správe (každá = jeden dopyt na `/api/style-scope`). */
export const MAX_LENS_ZONES = 8;
/** Strop GUIDov zóny, ktoré klient pošle do viewera (rovnaký ako most forku). */
export const MAX_ZONE_GUIDS = 5000;
const MAX_RULES = 24;
const HEX = /^#[0-9a-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(raw)) return null;
  try {
    const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Op `lens` vo wire formáte D-066 (`;` a `:` base64url neobsahuje). */
export function lensOp(mode: LensMode, wire: LensWire | null, rev?: string): string {
  const arg = rev ? `${mode}~r=${rev.replace(/[^A-Za-z0-9_-]/g, "")}` : mode;
  return `lens:${arg}:${wire ? toBase64Url(JSON.stringify(wire)) : ""}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function validGroup(g: unknown): g is LensFilterGroup {
  if (!isObj(g) || (g.combinator !== "AND" && g.combinator !== "OR") || !Array.isArray(g.rules)) return false;
  return g.rules.length > 0 && g.rules.every((r) => isObj(r) && typeof r.kind === "string");
}

/** Rozbalí JSON op `lens`; vstup je z URL, takže chybné časti -> `null`. */
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
  if (parsed.ac !== undefined) {
    if (!isObj(parsed.ac) || !(AUTO_COLOR_SOURCES as readonly unknown[]).includes(parsed.ac.source)) return null;
    out.ac = parsed.ac as LensWire["ac"];
  }
  return out;
}

/** Id zón zo všetkých pravidiel `aim_zone` (bez duplicít). */
export function lensZoneIds(wire: LensWire): string[] {
  const ids = new Set<string>();
  for (const r of wire.r ?? []) {
    for (const g of r.g) {
      for (const rule of g.rules) {
        if (rule.kind === "aim_zone" && Array.isArray(rule.ids)) {
          for (const id of rule.ids) if (typeof id === "string" && UUID.test(id)) ids.add(id);
        }
      }
    }
  }
  return [...ids].slice(0, MAX_LENS_ZONES);
}

/**
 * Bridge správa `APPLY_LENS`: pravidlá `aim_zone` nahradí `globalId` s GUIDmi
 * zón (`zoneGuids` podľa id zóny; chýbajúca zóna = prázdny zoznam, teda nič).
 */
export function lensBridgeMessage(
  mode: LensMode,
  wire: LensWire,
  zoneGuids: ReadonlyMap<string, readonly string[]>,
  rev?: string,
): Record<string, unknown> {
  // Most forku prijme spolu najviac MAX_ZONE_GUIDS GlobalId v jednej správe.
  let budget = MAX_ZONE_GUIDS;
  for (const r of wire.r ?? []) {
    for (const g of r.g) {
      for (const rule of g.rules) if (rule.kind === "globalId" && Array.isArray(rule.values)) budget -= rule.values.length;
    }
  }
  const swap = (rule: LensFilterRule): LensFilterRule => {
    if (rule.kind !== "aim_zone") return rule;
    const ids = Array.isArray(rule.ids) ? (rule.ids as unknown[]).map(String) : [];
    const guids = new Set<string>();
    for (const id of ids) for (const g of zoneGuids.get(id) ?? []) guids.add(g);
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
    ...(wire.ac ? { autoColor: wire.ac } : {}),
  };
}
