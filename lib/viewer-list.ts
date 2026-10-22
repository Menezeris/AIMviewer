/**
 * Zoznam z chatu (D-111): wire formát op `list` v `/ifc?ops=` a jej preklad na
 * bridge správu `OPEN_LIST` forku viewera (`apps/viewer/src/aim/aimList.ts`).
 * Filtre sú tie isté skupiny ako pri Lens z chatu (D-096) vrátane symbolickej
 * zóny `aim_zone` a dokumentu `aim_document`, ktoré klient pred odoslaním nahradí GUIDmi (`lensBridgeMessage`).
 * Jeden zdroj pre server (`lib/llm/list-tool.ts`) aj klienta. Bez závislostí.
 *
 * Op: `list::<base64url JSON>`. S `u: 1` je to úprava otvoreného zoznamu (`LIST_UPDATE`,
 * D-149): filtre pribudnú k filtrom zoznamu, `v` nesie zoskupenie, súčty, zoradenie,
 * hľadanie a maximalizáciu panela (aj pri otvorení), farby podľa stĺpca a ponuku exportu;
 * `e` (len s `u`) pridá alebo odoberie stĺpce a triedy a odoberie filtre (D-149, krok 2).
 */

import {
  fromBase64Url,
  lensBridgeMessage,
  lensScopeKeys,
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

/** Pohľad na tabuľku (D-149); nezadané sa nemení, prázdne pole alebo text zruší. */
export interface ListViewWire {
  /** Panel Lists na celú plochu viewera (true) alebo späť (false). */
  m?: boolean;
  /** Zoradenie; null = zrušiť. */
  o?: { c: ListColumnWire; d: "asc" | "desc" } | null;
  /** Stĺpce so súčtom. */
  sum?: ListColumnWire[];
  /** Zoskupenie, vonkajšie prvé. */
  gb?: ListColumnWire[];
  /** Rýchle hľadanie v riadkoch. */
  q?: string;
  /** Farby prvkov v 3D podľa stĺpca (upstream "Color by"); null = zrušiť. */
  cb?: ListColumnWire | null;
  /** Formát, ktorý viewer ponúkne zvýrazneným tlačidlom na stiahnutie (klik je na používateľovi). */
  x?: ListExportFormat;
}

export const LIST_EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ListExportFormat = (typeof LIST_EXPORT_FORMATS)[number];

/** Druhy filtrov (pravidlá `FilterRule.kind`), ktoré sa dajú odobrať; `all` = všetky okrem tried. */
export const LIST_FILTER_KINDS = ["storey", "model", "property", "group", "globalId", "name", "predefinedType", "all"] as const;

/** Úprava obsahu otvoreného zoznamu (D-149, krok 2); nezadané sa nemení. */
export interface ListEditWire {
  /** Pridať stĺpce (na koniec). */
  ac?: ListColumnWire[];
  /** Odobrať stĺpce. */
  rc?: ListColumnWire[];
  /** Pridať / odobrať IFC triedy. */
  at?: string[];
  rt?: string[];
  /** Odobrať filtre podľa druhu. */
  rf?: string[];
}

export interface ListWire {
  /** Názov zoznamu; pri úprave (`u`) sa nepoužije. */
  n: string;
  g: LensFilterGroup[];
  /** Stĺpce; pri úprave prázdne (stĺpce sa zatiaľ nemenia). */
  c: ListColumnWire[];
  /** 1 = tabuľku po otvorení rovno spustiť (D-148). */
  r?: 1;
  /** 1 = upraviť otvorený zoznam namiesto nového (D-149). */
  u?: 1;
  v?: ListViewWire;
  /** Úprava obsahu, len s `u`. */
  e?: ListEditWire;
}

const MAX_COLUMNS = 40;
const MAX_GROUPS = 8;
const MAX_VIEW_COLUMNS = 8;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isColumn(col: unknown): col is ListColumnWire {
  if (!isObj(col) || !(LIST_COLUMN_SOURCES as readonly unknown[]).includes(col.s) || typeof col.k !== "string") return false;
  return !((col.s === "property" || col.s === "quantity") && (typeof col.p !== "string" || !col.p));
}

function isView(v: unknown): v is ListViewWire {
  if (!isObj(v)) return false;
  if (v.m !== undefined && typeof v.m !== "boolean") return false;
  if (v.o !== undefined && v.o !== null && (!isObj(v.o) || !isColumn(v.o.c) || (v.o.d !== "asc" && v.o.d !== "desc"))) return false;
  for (const key of ["sum", "gb"] as const) {
    const cols = v[key];
    if (cols !== undefined && (!Array.isArray(cols) || cols.length > MAX_VIEW_COLUMNS || !cols.every(isColumn))) return false;
  }
  if (v.cb !== undefined && v.cb !== null && !isColumn(v.cb)) return false;
  if (v.x !== undefined && !(LIST_EXPORT_FORMATS as readonly unknown[]).includes(v.x)) return false;
  return v.q === undefined || (typeof v.q === "string" && v.q.length <= 200);
}

const MAX_EDIT_ITEMS = 16;
const isIfcClass = (t: unknown) => typeof t === "string" && /^Ifc[A-Za-z0-9]{1,60}$/i.test(t);

function isEdit(e: unknown): e is ListEditWire {
  if (!isObj(e) || Object.keys(e).length === 0) return false;
  const list = (raw: unknown, ok: (x: unknown) => boolean) =>
    raw === undefined || (Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_EDIT_ITEMS && raw.every(ok));
  return list(e.ac, isColumn) && list(e.rc, isColumn) && list(e.at, isIfcClass) && list(e.rt, isIfcClass)
    && list(e.rf, (k) => (LIST_FILTER_KINDS as readonly unknown[]).includes(k));
}

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
  if (!isObj(parsed) || typeof parsed.n !== "string" || parsed.n.length > 120) return null;
  if (parsed.u !== undefined && parsed.u !== 1) return null;
  const update = parsed.u === 1;
  if (!update && !parsed.n) return null;
  if (parsed.v !== undefined && !isView(parsed.v)) return null;
  if (parsed.e !== undefined && (!update || !isEdit(parsed.e))) return null;
  const { g, c } = parsed;
  if (!Array.isArray(g) || g.length > MAX_GROUPS) return null;
  for (const grp of g) {
    if (!isObj(grp) || (grp.combinator !== "AND" && grp.combinator !== "OR") || !Array.isArray(grp.rules)) return null;
    if (grp.rules.length === 0 || !grp.rules.every((r) => isObj(r) && typeof r.kind === "string")) return null;
  }
  if (parsed.r !== undefined && parsed.r !== 1) return null;
  if (!Array.isArray(c) || c.length > MAX_COLUMNS || (update ? c.length > 0 : c.length === 0)) return null;
  if (!c.every(isColumn)) return null;
  return parsed as unknown as ListWire;
}

/** Filtre ako jediné pravidlo Lens - tak sa na ne použije to isté doplnenie zóny. */
const asLens = (wire: ListWire): LensWire => ({ r: [{ n: wire.n, a: "isolate", g: wire.g }] });

/** Kľúče zón a dokumentov, ktorých GUIDy musí klient stiahnuť pred odoslaním. */
export function listScopeKeys(wire: ListWire): string[] {
  return lensScopeKeys(asLens(wire));
}

/** Bridge správa `OPEN_LIST` alebo `LIST_UPDATE` (D-149); zóny a dokumenty nahradí GUIDmi z `scopeGuids`. */
export function listBridgeMessage(wire: ListWire, scopeGuids: ReadonlyMap<string, readonly string[]>): Record<string, unknown> {
  const lens = lensBridgeMessage("add", asLens(wire), scopeGuids) as { rules?: Array<{ groups: unknown[] }> };
  const view = wire.v ? { view: viewMessage(wire.v) } : {};
  if (wire.u) {
    const edit = wire.e ? { edit: editMessage(wire.e) } : {};
    return { type: "LIST_UPDATE", groups: wire.g.length ? lens.rules?.[0]?.groups ?? [] : [], ...view, ...edit };
  }
  return {
    type: "OPEN_LIST",
    name: wire.n,
    ...(wire.r ? { run: true } : {}),
    groups: lens.rules?.[0]?.groups ?? [],
    columns: wire.c.map(columnDef),
    ...view,
  };
}

const columnRef = (c: ListColumnWire) => ({ source: c.s, propertyName: c.k, ...(c.p ? { psetName: c.p } : {}) });
const columnDef = (c: ListColumnWire) => ({ ...columnRef(c), ...(c.l ? { label: c.l } : {}) });

/** `edit` správy `LIST_UPDATE` pre fork (`aim/aimListEditPlan.ts`). */
function editMessage(e: ListEditWire): Record<string, unknown> {
  return {
    ...(e.ac ? { addColumns: e.ac.map(columnDef) } : {}),
    ...(e.rc ? { removeColumns: e.rc.map(columnRef) } : {}),
    ...(e.at ? { addTypes: e.at } : {}),
    ...(e.rt ? { removeTypes: e.rt } : {}),
    ...(e.rf ? { removeFilters: e.rf } : {}),
  };
}

/** `view` správy pre fork (`aim/aimListViewPlan.ts`): stĺpce menom, nie id. */
function viewMessage(v: ListViewWire): Record<string, unknown> {
  return {
    ...(v.m !== undefined ? { maximize: v.m } : {}),
    ...(v.o !== undefined ? { sort: v.o && { column: columnRef(v.o.c), dir: v.o.d } } : {}),
    ...(v.sum ? { sum: v.sum.map(columnRef) } : {}),
    ...(v.gb ? { groupBy: v.gb.map(columnRef) } : {}),
    ...(v.q !== undefined ? { search: v.q } : {}),
    ...(v.cb !== undefined ? { colorBy: v.cb && columnRef(v.cb) } : {}),
    ...(v.x ? { export: v.x } : {}),
  };
}
