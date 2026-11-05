/**
 * List from chat (D-111): wire format of the `list` op in `/ifc?ops=` and its translation to the
 * bridge message `OPEN_LIST` of the viewer fork (`apps/viewer/src/aim/aimList.ts`).
 * The filters are the same groups as for Lens from chat (D-096), including the symbolic
 * zone `aim_zone` and document `aim_document`, which the client replaces with GUIDs before sending (`lensBridgeMessage`).
 * One source for the server (`lib/llm/list-tool.ts`) and the client. No dependencies.
 *
 * Op: `list::<base64url JSON>`. With `u: 1` it is an edit of an open list (`LIST_UPDATE`,
 * D-149): filters are added to the list's filters, `v` carries grouping, sums, sorting,
 * search and panel maximization (also on open), colors by column and the export offer;
 * `e` (only with `u`) adds or removes columns and classes and removes filters (D-149, step 2).
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
  "host",
] as const;
export type ListColumnSource = (typeof LIST_COLUMN_SOURCES)[number];

/**
 * Columns `source: "host"` (D-174, #277): values by GlobalId are computed by the host from the DB (derived links `v_space_elements`,
 * D-167), not by the viewer from the IFC file. The key `k` is symbolic, the client fetches the values from `/api/list-host-values`.
 */
export const LIST_HOST_KEYS = ["derived_referenced", "derived_boundary"] as const;
export type ListHostKey = (typeof LIST_HOST_KEYS)[number];
/** Cap on values of one host column and value length (same as in the fork design). */
export const LIST_HOST_MAX_VALUES = 20000;
export const LIST_HOST_MAX_VALUE_LENGTH = 200;
/** GlobalId -> cell text of one host column. */
export type ListHostValues = Record<string, string>;

/** List column (`ColumnDefinition` from `@ifc-lite/lists` without id). */
export interface ListColumnWire {
  s: ListColumnSource;
  /** Pset / Qto for property / quantity. */
  p?: string;
  /** Attribute, property, quantity or spatial level (Storey, Container...). */
  k: string;
  /** Column description. */
  l?: string;
}

/** Cell value by which rows to highlight are searched (D-171). */
export type ListCellValue = string | number;

/** Column width (D-171): px 56 to 800, `fit` = by content, `auto` = default. */
export type ListColumnWidth = number | "fit" | "auto";
export const LIST_MIN_COLUMN_WIDTH = 56;
export const LIST_MAX_COLUMN_WIDTH = 800;
/** `fit` / `auto` for all columns, or one by one. */
export type ListColumnWidthsWire = "fit" | "auto" | Array<{ c: ListColumnWire; w: ListColumnWidth }>;

/** Highlighting in the table (D-171, #274): rows, columns, cells and the sums row; all optional. */
export interface ListHighlightWire {
  /** Rows whose cell in column `c` equals one of the values `v`. */
  r?: { c: ListColumnWire; v: ListCellValue[] };
  /** Whole columns. */
  c?: ListColumnWire[];
  /** Cell in column `c` in rows where column `r.c` equals `r.v`. */
  x?: Array<{ c: ListColumnWire; r: { c: ListColumnWire; v: ListCellValue } }>;
  /** Sums row: `true` all, or only the sums of these columns. */
  s?: true | ListColumnWire[];
}

/** View of the table (D-149); unspecified stays unchanged, an empty array or text cancels. */
export interface ListViewWire {
  /** Lists panel over the whole viewer area (true) or back (false). */
  m?: boolean;
  /** Sorting; null = cancel. */
  o?: { c: ListColumnWire; d: "asc" | "desc" } | null;
  /** Columns with a sum. */
  sum?: ListColumnWire[];
  /** Grouping, outer first. */
  gb?: ListColumnWire[];
  /** Quick search in rows. */
  q?: string;
  /** Colors of elements in 3D by column (upstream "Color by"); null = cancel. */
  cb?: ListColumnWire | null;
  /** Format the viewer offers with a highlighted download button (the click is up to the user). */
  x?: ListExportFormat;
  /** Table filter "only visible in 3D" (D-171, #276): false shows all rows even under isolation. */
  vo?: boolean;
  /** Column widths (D-171, #275). */
  cw?: ListColumnWidthsWire;
  /** Highlighting (D-171, #274); null = cancel. */
  hl?: ListHighlightWire | null;
}

export const LIST_EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ListExportFormat = (typeof LIST_EXPORT_FORMATS)[number];

/** Kinds of filters (rules `FilterRule.kind`) that can be removed; `all` = all except classes. */
export const LIST_FILTER_KINDS = ["storey", "model", "property", "group", "globalId", "name", "predefinedType", "all"] as const;

/** Edit of the content of an open list (D-149, step 2); unspecified stays unchanged. */
export interface ListEditWire {
  /** Add columns (at the end). */
  ac?: ListColumnWire[];
  /** Remove columns. */
  rc?: ListColumnWire[];
  /** Add / remove IFC classes. */
  at?: string[];
  rt?: string[];
  /** Remove filters by kind. */
  rf?: string[];
}

export interface ListWire {
  /** Name of the list; not used for an edit (`u`). */
  n: string;
  g: LensFilterGroup[];
  /** Columns; empty for an edit (columns are not changed yet). */
  c: ListColumnWire[];
  /** 1 = run the table right after opening (D-148). */
  r?: 1;
  /** 1 = edit the open list instead of a new one (D-149). */
  u?: 1;
  v?: ListViewWire;
  /** Content edit, only with `u`. */
  e?: ListEditWire;
}

const MAX_COLUMNS = 40;
const MAX_GROUPS = 8;
const MAX_VIEW_COLUMNS = 8;
export const LIST_MAX_WIDTH_COLUMNS = 40;
export const LIST_MAX_HIGHLIGHT_ITEMS = 200;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isColumn(col: unknown): col is ListColumnWire {
  if (!isObj(col) || !(LIST_COLUMN_SOURCES as readonly unknown[]).includes(col.s) || typeof col.k !== "string") return false;
  if (col.s === "host" && !(LIST_HOST_KEYS as readonly unknown[]).includes(col.k)) return false;
  return !((col.s === "property" || col.s === "quantity") && (typeof col.p !== "string" || !col.p));
}

const isCellValue = (v: unknown): v is ListCellValue =>
  (typeof v === "string" && v.length <= 200) || (typeof v === "number" && Number.isFinite(v));

function isWidth(w: unknown): w is ListColumnWidth {
  return w === "fit" || w === "auto" || (typeof w === "number" && Number.isFinite(w) && w >= LIST_MIN_COLUMN_WIDTH && w <= LIST_MAX_COLUMN_WIDTH);
}

function isWidths(cw: unknown): cw is ListColumnWidthsWire {
  if (cw === "fit" || cw === "auto") return true;
  return Array.isArray(cw) && cw.length > 0 && cw.length <= LIST_MAX_WIDTH_COLUMNS && cw.every((x) => isObj(x) && isColumn(x.c) && isWidth(x.w));
}

function isHighlight(h: unknown): h is ListHighlightWire {
  if (!isObj(h)) return false;
  const { r, c, x, s } = h;
  if (r !== undefined) {
    if (!isObj(r) || !isColumn(r.c) || !Array.isArray(r.v) || r.v.length === 0 || r.v.length > LIST_MAX_HIGHLIGHT_ITEMS || !r.v.every(isCellValue)) return false;
  }
  if (c !== undefined && (!Array.isArray(c) || c.length > MAX_VIEW_COLUMNS || !c.every(isColumn))) return false;
  if (x !== undefined) {
    if (!Array.isArray(x) || x.length > LIST_MAX_HIGHLIGHT_ITEMS) return false;
    if (!x.every((cell) => isObj(cell) && isColumn(cell.c) && isObj(cell.r) && isColumn(cell.r.c) && isCellValue(cell.r.v))) return false;
  }
  return s === undefined || s === true || (Array.isArray(s) && s.length <= MAX_VIEW_COLUMNS && s.every(isColumn));
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
  if (v.vo !== undefined && typeof v.vo !== "boolean") return false;
  if (v.cw !== undefined && !isWidths(v.cw)) return false;
  if (v.hl !== undefined && v.hl !== null && !isHighlight(v.hl)) return false;
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

/** Unpacks the JSON of the `list` op; input is from the URL, faulty parts -> `null`. */
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

/** Filters as a single Lens rule - so the same zone filling applies to them. */
const asLens = (wire: ListWire): LensWire => ({ r: [{ n: wire.n, a: "isolate", g: wire.g }] });

/** Keys of zones and documents whose GUIDs the client must fetch before sending. */
export function listScopeKeys(wire: ListWire): string[] {
  return lensScopeKeys(asLens(wire));
}

/** Keys of host columns whose values the client must fetch before sending (columns of a new list and `edit.ac`). */
export function listHostKeys(wire: ListWire): ListHostKey[] {
  const cols = [...wire.c, ...(wire.e?.ac ?? [])];
  return [...new Set(cols.filter((c) => c.s === "host").map((c) => c.k as ListHostKey))];
}

/**
 * Bridge message `OPEN_LIST` or `LIST_UPDATE` (D-149); zones and documents are replaced with GUIDs from `scopeGuids`,
 * host columns get `values` from `hostValues` (column key -> GlobalId -> text, D-174).
 */
export function listBridgeMessage(
  wire: ListWire,
  scopeGuids: ReadonlyMap<string, readonly string[]>,
  hostValues: ReadonlyMap<string, ListHostValues> = new Map(),
): Record<string, unknown> {
  const columnDef = (c: ListColumnWire) => ({
    ...columnRef(c),
    ...(c.l ? { label: c.l } : {}),
    ...(c.s === "host" ? { values: hostValues.get(c.k) ?? {} } : {}),
  });
  const lens = lensBridgeMessage("add", asLens(wire), scopeGuids) as { rules?: Array<{ groups: unknown[] }> };
  const view = wire.v ? { view: viewMessage(wire.v) } : {};
  if (wire.u) {
    const edit = wire.e ? { edit: editMessage(wire.e, columnDef) } : {};
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
/** `edit` of the `LIST_UPDATE` message for the fork (`aim/aimListEditPlan.ts`). */
function editMessage(e: ListEditWire, columnDef: (c: ListColumnWire) => Record<string, unknown>): Record<string, unknown> {
  return {
    ...(e.ac ? { addColumns: e.ac.map(columnDef) } : {}),
    ...(e.rc ? { removeColumns: e.rc.map(columnRef) } : {}),
    ...(e.at ? { addTypes: e.at } : {}),
    ...(e.rt ? { removeTypes: e.rt } : {}),
    ...(e.rf ? { removeFilters: e.rf } : {}),
  };
}

const highlightMessage = (h: ListHighlightWire): Record<string, unknown> => ({
  ...(h.r ? { rows: { column: columnRef(h.r.c), values: h.r.v } } : {}),
  ...(h.c ? { columns: h.c.map(columnRef) } : {}),
  ...(h.x ? { cells: h.x.map((x) => ({ column: columnRef(x.c), row: { column: columnRef(x.r.c), value: x.r.v } })) } : {}),
  ...(h.s !== undefined ? { sum: h.s === true ? true : h.s.map(columnRef) } : {}),
});

/** `view` of the message for the fork (`aim/aimListViewPlan.ts`): columns by name, not id. */
function viewMessage(v: ListViewWire): Record<string, unknown> {
  return {
    ...(v.m !== undefined ? { maximize: v.m } : {}),
    ...(v.o !== undefined ? { sort: v.o && { column: columnRef(v.o.c), dir: v.o.d } } : {}),
    ...(v.sum ? { sum: v.sum.map(columnRef) } : {}),
    ...(v.gb ? { groupBy: v.gb.map(columnRef) } : {}),
    ...(v.q !== undefined ? { search: v.q } : {}),
    ...(v.cb !== undefined ? { colorBy: v.cb && columnRef(v.cb) } : {}),
    ...(v.x ? { export: v.x } : {}),
    ...(v.vo !== undefined ? { visibleOnly: v.vo } : {}),
    ...(v.cw !== undefined ? { columnWidths: v.cw === "fit" || v.cw === "auto" ? v.cw : v.cw.map((w) => ({ column: columnRef(w.c), width: w.w })) } : {}),
    ...(v.hl !== undefined ? { highlight: v.hl && highlightMessage(v.hl) } : {}),
  };
}
