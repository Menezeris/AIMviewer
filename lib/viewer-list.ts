/**
 * Zoznam z chatu (D-111): wire formát op `list` v `/ifc?ops=` a jej preklad na
 * bridge správu `OPEN_LIST` forku viewera (`apps/viewer/src/aim/aimList.ts`).
 * Filtre sú tie isté skupiny ako pri Lens z chatu (D-096) vrátane symbolickej
 * zóny `aim_zone`, ktorú klient pred odoslaním nahradí GUIDmi (`lensBridgeMessage`).
 * Jeden zdroj pre server (`lib/llm/list-tool.ts`) aj klienta. Bez závislostí.
 *
 * Op: `list::<base64url JSON>`.
 */

import {
  fromBase64Url,
  lensBridgeMessage,
  lensZoneIds,
  toBase64Url,
  type LensFilterGroup,
  type LensWire,
} from "./viewer-lens";

export const LIST_COLUMN_SOURCES = [
  "attribute",
  "property",
  "quantity",
  "material",
  "classification",
  "spatial",
  "model",
] as const;
export type ListColumnSource = (typeof LIST_COLUMN_SOURCES)[number];

/** Stĺpec zoznamu (`ColumnDefinition` z `@ifc-lite/lists` bez id). */
export interface ListColumnWire {
  s: ListColumnSource;
  /** Pset / Qto pri property / quantity. */
  p?: string;
  /** Atribút, vlastnosť, množstvo alebo úroveň priestoru (Storey, Container...). */
  k: string;
  /** Popis stĺpca. */
  l?: string;
}

export interface ListWire {
  n: string;
  g: LensFilterGroup[];
  c: ListColumnWire[];
}

const MAX_COLUMNS = 40;
const MAX_GROUPS = 8;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function listOp(wire: ListWire): string {
  return `list::${toBase64Url(JSON.stringify(wire))}`;
}

/** Rozbalí JSON op `list`; vstup je z URL, chybné časti -> `null`. */
export function decodeListWire(raw: string): ListWire | null {
  const text = fromBase64Url(raw);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(parsed) || typeof parsed.n !== "string" || !parsed.n || parsed.n.length > 120) return null;
  const { g, c } = parsed;
  if (!Array.isArray(g) || g.length > MAX_GROUPS) return null;
  for (const grp of g) {
    if (!isObj(grp) || (grp.combinator !== "AND" && grp.combinator !== "OR") || !Array.isArray(grp.rules)) return null;
    if (grp.rules.length === 0 || !grp.rules.every((r) => isObj(r) && typeof r.kind === "string")) return null;
  }
  if (!Array.isArray(c) || c.length === 0 || c.length > MAX_COLUMNS) return null;
  for (const col of c) {
    if (!isObj(col) || !(LIST_COLUMN_SOURCES as readonly unknown[]).includes(col.s) || typeof col.k !== "string") return null;
    if ((col.s === "property" || col.s === "quantity") && (typeof col.p !== "string" || !col.p)) return null;
  }
  return parsed as unknown as ListWire;
}

/** Filtre ako jediné pravidlo Lens - tak sa na ne použije to isté doplnenie zóny. */
const asLens = (wire: ListWire): LensWire => ({ r: [{ n: wire.n, a: "isolate", g: wire.g }] });

/** Id zón, ktorých GUIDy musí klient stiahnuť pred odoslaním. */
export function listZoneIds(wire: ListWire): string[] {
  return lensZoneIds(asLens(wire));
}

/** Bridge správa `OPEN_LIST`; zóny (`aim_zone`) nahradí GUIDmi z `zoneGuids`. */
export function listBridgeMessage(wire: ListWire, zoneGuids: ReadonlyMap<string, readonly string[]>): Record<string, unknown> {
  const lens = lensBridgeMessage("add", asLens(wire), zoneGuids) as { rules?: Array<{ groups: unknown[] }> };
  return {
    type: "OPEN_LIST",
    name: wire.n,
    groups: lens.rules?.[0]?.groups ?? [],
    columns: wire.c.map((c) => ({
      source: c.s,
      propertyName: c.k,
      ...(c.p ? { psetName: c.p } : {}),
      ...(c.l ? { label: c.l } : {}),
    })),
  };
}
