/**
 * Lens z chatu (D-096): wire formát op `lens` v `/ifc?ops=` a jej preklad na
 * bridge správu `APPLY_LENS` forku viewera (`apps/viewer/src/aim/aimLens.ts`).
 * Jeden zdroj pre server (`lib/llm/style-lens.ts` skladá) aj klienta
 * (`components/ifc-viewer.tsx` dopĺňa zónu a posiela). Bez závislostí.
 *
 * Op: `lens:<mode>[~r=<rev>]:<base64url JSON>`. JSON nesie pravidlá Lens
 * (`FilterGroup` z `@ifc-lite/rules`) zostavené na serveri. Čo pozná len graf
 * AIM, ide symbolicky: zóna s prvkami v miestnostiach ako pravidlo `aim_zone`
 * s id zón, prvky dokumentu alebo jeho strany (D-104 krok 4) ako `aim_document`.
 * Klient si GUIDy stiahne z `/api/style-scope` a nahradí ich pravidlom
 * `globalId`, takže dĺžka URL neobmedzuje veľkosť zóny ani dokumentu.
 */

export const LENS_MODES = ["add", "replace", "clear", "unisolate"] as const;
export type LensMode = (typeof LENS_MODES)[number];
/** `isolate` = len do izolácie alebo X-ray bez farby (viewer ich drží vlastným kanálom, nie lens). */
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
/** Symbolický dokument (D-104 krok 4): prvky, ktorých sa dokument alebo jeho strana týka, GUIDy doplní klient. */
export interface AimDocumentRule {
  kind: "aim_document";
  /** objects.id dokumentu alebo odkazu na jeho časť. */
  id: string;
  /** 1-based strana; bez nej celý dokument. */
  page?: number;
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
  /** X-ray context zo zjednotenia pravidiel: vybrané plné, zvyšok priesvitný (D-105). S `i` sa nekombinuje. */
  x?: 1;
  /**
   * Kontext X-ray len pre podlažia (D-140, #187): normalizované štítky (1NP, 2NP); prvky ostatných podlaží viewer
   * skryje, kým X-ray z chatu trvá. Platí len s `x`.
   */
  cs?: string[];
  ac?: { source: AutoColorSource; psetName?: string; propertyName?: string };
  /** Rozsah `ac` (D-119): farby podľa hodnoty, legenda a počty len pre prvky týchto skupín (AND v skupine). */
  s?: LensFilterGroup[];
  /**
   * Veľkosť legendy (D-119): `large` = panel Lens ako veľké okno, `normal` = späť do lišty,
   * `compact` = malá karta len s AIM chat lens, panel Lens zavretý (D-125).
   */
  l?: LegendSize;
}

export const LEGEND_SIZES = ["compact", "large", "normal"] as const;
export type LegendSize = (typeof LEGEND_SIZES)[number];

/** Najviac zón a dokumentov v jednej správe (každý = jeden dopyt na `/api/style-scope`). */
export const MAX_LENS_ZONES = 8;
/** Strop GUIDov zóny, ktoré klient pošle do viewera (rovnaký ako most forku). */
export const MAX_ZONE_GUIDS = 5000;
const MAX_RULES = 24;
/** Najviac podlaží v kontexte X-ray (ako `xrayStoreys` mosta forku). */
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
 * Kľúče symbolických množín pravidla: id zóny (`aim_zone`) alebo `doc:<id>[:<strana>]`
 * (`aim_document`). Pod týmto kľúčom klient drží GUIDy z `/api/style-scope`.
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

/** Kľúče zón a dokumentov zo všetkých pravidiel (bez duplicít). */
export function lensScopeKeys(wire: LensWire): string[] {
  const keys = new Set<string>();
  // Aj rozsah farieb podľa hodnoty (`s`, D-119) môže niesť zónu alebo dokument.
  for (const g of [...(wire.r ?? []).flatMap((r) => r.g), ...(wire.s ?? [])]) for (const rule of g.rules) for (const k of scopeKeysOf(rule)) keys.add(k);
  return [...keys].slice(0, MAX_LENS_ZONES);
}

/** Kľúč dokumentu v mape GUIDov (`lensScopeKeys`, `lensBridgeMessage`). */
export function documentScopeKey(id: string, page?: number): string {
  return `doc:${id}${page ? `:${page}` : ""}`;
}

/**
 * Lens tlačidla "Ukázať v 3D" pri otvorenom dokumente (D-104 krok 4, správa forku
 * `DOCUMENT_SHOW_3D`): prvky strany alebo celého dokumentu ostanú plné, zvyšok
 * modelu priesvitný (X-ray, D-105). Pravidlo nesie meno dokumentu ako štítok.
 */
export function documentLensWire(id: string, name: string, page?: number): LensWire {
  const rule: LensFilterRule = { kind: "aim_document", id, ...(page ? { page } : {}) } satisfies AimDocumentRule;
  return {
    r: [{ n: (page ? `${name}, s. ${page}` : name).slice(0, 120), a: "isolate", g: [{ combinator: "AND", rules: [rule] }] }],
    x: 1,
  };
}

/** Query string `/api/style-scope` pre kľúč z `lensScopeKeys` (zlý kľúč -> `null`). */
export function scopeQuery(key: string): string | null {
  if (UUID.test(key)) return `zone=${encodeURIComponent(key)}`;
  const m = DOC_KEY.exec(key);
  if (!m) return null;
  return `document=${encodeURIComponent(m[1])}${m[2] ? `&page=${m[2]}` : ""}`;
}

/**
 * Bridge správa `APPLY_LENS`: pravidlá `aim_zone` a `aim_document` nahradí
 * `globalId` s GUIDmi (`scopeGuids` podľa kľúča z `lensScopeKeys`; chýbajúca
 * zóna alebo dokument = prázdny zoznam, teda nič).
 */
export function lensBridgeMessage(
  mode: LensMode,
  wire: LensWire,
  scopeGuids: ReadonlyMap<string, readonly string[]>,
  rev?: string,
): Record<string, unknown> {
  // Most forku prijme spolu najviac MAX_ZONE_GUIDS GlobalId v jednej správe.
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
