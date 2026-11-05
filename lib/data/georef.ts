/**
 * `_georef` of a document (D-072, v2 D-133) - pure types, validation and merging of calibrations.
 *
 * v1 = one calibration (PDF page -> horizontal plane of the storey). v2 = a list of calibrations
 * of the document, each for a page and a plane: without `plane` exactly v1 (storey `storey_guid`), with
 * `plane` a vertical or other plane in the IFC world (section, D-132). `source` distinguishes a manual
 * calibration from the Underlays panel (`manual`) and an automatic one (`auto`, `calibrate_underlay`);
 * an automatic one does not overwrite a manual one without `force`.
 *
 * Without `server-only`, so that the logic is testable (pattern `capture-placement.ts`).
 */

export type Tuple2 = [number, number];
export type Tuple3 = [number, number, number];

/** Plane of the underlay in the IFC world (m): point = origin + u*s + v*t; u x v = normal towards the camera. */
export interface GeorefPlane {
  origin: Tuple3;
  u: Tuple3;
  v: Tuple3;
}

export interface GeorefQuality {
  method: string;
  median_mm: number | null;
  p90_mm: number | null;
  cv_max_mm: number | null;
  start_points: number;
}

/** One calibration: PDF page (points, bottom left) -> meters of the plane (u, v). */
export interface GeorefCalibration {
  page: number;
  page_size: Tuple2;
  storey_guid?: string | null;
  storey_z?: number | null;
  plane?: GeorefPlane | null;
  affine: [number, number, number, number, number, number];
  calibration: { pdf_pt: Tuple2; ifc_m: Tuple2 }[];
  /** Page crop in % (x, y, w, h, top left) when the page carries several drawings. */
  region?: [number, number, number, number] | null;
  source: "manual" | "auto";
  quality?: GeorefQuality | null;
  opacity?: number;
  visible?: boolean;
  discipline?: string | null;
  calibrated_at?: string | null;
}

/** `_georef.history` keeps at most this many previous calibrations (D-168). */
export const MAX_GEOREF_HISTORY = 10;

/** Who overwrote the calibration: `mcp` = calibrate_underlay, `panel` = manual edit in the Underlays panel. */
export type GeorefHistoryBy = "mcp" | "panel";

/** Previous calibration of a page before the placement or calibration was overwritten (D-168); newest first. */
export interface GeorefHistoryEntry {
  page: number;
  /** The whole `calibrations[]` record before the overwrite. */
  calibration: GeorefCalibration;
  replaced_at: string;
  replaced_by: GeorefHistoryBy;
  reason: string;
}

export interface GeorefV2 {
  version: 2;
  calibrations: GeorefCalibration[];
  /** Bounded history of overwrites (D-168); absent until something was overwritten. Not sent to the viewer. */
  history?: GeorefHistoryEntry[];
}

/** v1 (D-072) - the shape read by today's fork (`parsePlacement`). */
export interface GeorefV1 {
  version: 1;
  storey_guid: string;
  storey_z: number;
  page: number;
  page_size: Tuple2;
  affine: [number, number, number, number, number, number];
  calibration: { pdf_pt: Tuple2; ifc_m: Tuple2 }[];
  opacity?: number;
  visible?: boolean;
  discipline?: string | null;
  calibrated_at?: string | null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const tuple = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(num);
const optStr = (v: unknown) => v === undefined || v === null || typeof v === "string";

function validPlane(p: unknown): p is GeorefPlane {
  if (!p || typeof p !== "object") return false;
  const g = p as Record<string, unknown>;
  if (!tuple(g.origin, 3) || !tuple(g.u, 3) || !tuple(g.v, 3)) return false;
  const u = g.u as number[];
  const v = g.v as number[];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  // Unit and perpendicular (tolerance for JSON rounding).
  return Math.abs(len(u) - 1) < 1e-6 && Math.abs(len(v) - 1) < 1e-6 && Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) < 1e-6;
}

/** Validation of one v2 calibration (untrusted input of both the route and the tool). */
export function isValidCalibration(raw: unknown): raw is GeorefCalibration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  if (!num(g.page) || !Number.isInteger(g.page) || g.page < 1) return false;
  if (!tuple(g.page_size, 2) || (g.page_size as number[])[0] <= 0 || (g.page_size as number[])[1] <= 0) return false;
  if (!tuple(g.affine, 6)) return false;
  const a = g.affine as number[];
  if (!(Math.abs(a[0] * a[4] - a[1] * a[3]) > 0)) return false;
  // At least 1 point: the panel's single-point calibration (#317) carries scale and rotation in the affine.
  if (!Array.isArray(g.calibration) || g.calibration.length < 1) return false;
  for (const c of g.calibration as { pdf_pt?: unknown; ifc_m?: unknown }[]) {
    if (!c || typeof c !== "object" || !tuple(c.pdf_pt, 2) || !tuple(c.ifc_m, 2)) return false;
  }
  if (g.source !== "manual" && g.source !== "auto") return false;
  const hasPlane = g.plane !== undefined && g.plane !== null;
  if (hasPlane && !validPlane(g.plane)) return false;
  // Without a plane it is a storey floor plan: storey_guid and storey_z are required (as in v1).
  if (!hasPlane && (typeof g.storey_guid !== "string" || !g.storey_guid || !num(g.storey_z))) return false;
  if (!optStr(g.storey_guid) || (g.storey_z !== undefined && g.storey_z !== null && !num(g.storey_z))) return false;
  if (g.region !== undefined && g.region !== null && !tuple(g.region, 4)) return false;
  if (g.opacity !== undefined && !num(g.opacity)) return false;
  if (g.visible !== undefined && typeof g.visible !== "boolean") return false;
  if (!optStr(g.discipline) || !optStr(g.calibrated_at)) return false;
  return true;
}

export function isValidGeorefV2(raw: unknown): raw is GeorefV2 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  return g.version === 2 && Array.isArray(g.calibrations) && g.calibrations.length <= 50 && g.calibrations.every(isValidCalibration);
}

/** v1 -> v2 item (floor plan without a plane). */
export function calibrationFromV1(v1: GeorefV1, source: "manual" | "auto" = "manual"): GeorefCalibration {
  return {
    page: v1.page,
    page_size: v1.page_size,
    storey_guid: v1.storey_guid,
    storey_z: v1.storey_z,
    plane: null,
    affine: v1.affine,
    calibration: v1.calibration,
    source,
    ...(v1.opacity !== undefined ? { opacity: v1.opacity } : {}),
    ...(v1.visible !== undefined ? { visible: v1.visible } : {}),
    discipline: v1.discipline ?? null,
    calibrated_at: v1.calibrated_at ?? null,
  };
}

const MAX_REASON = 200;

function isHistoryEntry(raw: unknown): raw is GeorefHistoryEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const h = raw as Record<string, unknown>;
  return (
    isValidCalibration(h.calibration) &&
    num(h.page) && h.page === (h.calibration as GeorefCalibration).page &&
    typeof h.replaced_at === "string" &&
    (h.replaced_by === "mcp" || h.replaced_by === "panel") &&
    typeof h.reason === "string" && h.reason.length <= MAX_REASON
  );
}

/** History from the stored `_georef`: invalid records drop out, at most `MAX_GEOREF_HISTORY`. */
export function historyOf(stored: unknown): GeorefHistoryEntry[] {
  const raw = stored && typeof stored === "object" ? (stored as { history?: unknown }).history : undefined;
  return Array.isArray(raw) ? raw.filter(isHistoryEntry).slice(0, MAX_GEOREF_HISTORY) : [];
}

/** Stored `_georef` (v1 or v2, even invalid) -> v2; invalid items drop out, the history stays. */
export function toGeorefV2(raw: unknown): GeorefV2 {
  const base = calibrationsOf(raw);
  const history = historyOf(raw);
  return history.length > 0 ? { ...base, history } : base;
}

function calibrationsOf(raw: unknown): GeorefV2 {
  if (isValidGeorefV2(raw)) return { version: 2, calibrations: raw.calibrations };
  if (raw && typeof raw === "object" && (raw as { version?: unknown }).version === 1) {
    const g = raw as GeorefV1;
    const c = calibrationFromV1(g);
    if (isValidCalibration(c)) return { version: 2, calibrations: [c] };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as { calibrations?: unknown }).calibrations)) {
    return { version: 2, calibrations: (raw as { calibrations: unknown[] }).calibrations.filter(isValidCalibration) };
  }
  return { version: 2, calibrations: [] };
}

/** Same place = the same page and plane (floor plan: storey; section: plane within 1 cm and 0.1 degrees). */
export function sameSlot(a: GeorefCalibration, b: GeorefCalibration): boolean {
  if (a.page !== b.page) return false;
  if (JSON.stringify(a.region ?? null) !== JSON.stringify(b.region ?? null)) return false;
  if (!a.plane || !b.plane) return !a.plane && !b.plane && a.storey_guid === b.storey_guid;
  const n = (p: GeorefPlane): Tuple3 => [
    p.u[1] * p.v[2] - p.u[2] * p.v[1],
    p.u[2] * p.v[0] - p.u[0] * p.v[2],
    p.u[0] * p.v[1] - p.u[1] * p.v[0],
  ];
  const na = n(a.plane);
  const nb = n(b.plane);
  const cos = Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]);
  const d = [0, 1, 2].reduce((s, i) => s + (b.plane!.origin[i] - a.plane!.origin[i]) * na[i], 0);
  return cos > Math.cos((0.1 * Math.PI) / 180) && Math.abs(d) < 0.01;
}

/**
 * Distance of the calibration plane from the vertical plane `axis` = `coordinate` (x: X = c, y: Y = c) in meters; `null` when the
 * orientation does not match (the plane normal differs from the axis by more than 1 degree) or the calibration is not a section.
 */
export function planeAxisDistance(plane: GeorefPlane | null | undefined, axis: "x" | "y", coordinate: number): number | null {
  if (!plane) return null;
  const { u, v, origin } = plane;
  const n: Tuple3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len === 0) return null;
  const k = axis === "x" ? 0 : 1;
  if (Math.abs(n[k]) / len < Math.cos(Math.PI / 180)) return null;
  return Math.abs(origin[k] - coordinate);
}

export type MergeResult =
  | { ok: true; georef: GeorefV2; replaced: GeorefCalibration | null; /** The previous calibration went to `history`. */ history_added: boolean }
  | { ok: false; reason: "manual_exists"; existing: GeorefCalibration };

const sameNumbers = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

/** Who overwrites the calibration and why; with it the previous calibration is written to `history` (D-168). */
export interface HistoryMeta {
  by: GeorefHistoryBy;
  reason: string;
  at: string;
}

/**
 * Same placement and calibration (scale, rotation, offset, points, plane, crop)? A change of only `visible`, `opacity`,
 * `quality`, `discipline` or `calibrated_at` is not an overwrite of the placement and does not go to the history (D-168).
 */
export function samePlacement(a: GeorefCalibration, b: GeorefCalibration): boolean {
  const planeSame = !a.plane || !b.plane ? !a.plane && !b.plane : sameNumbers([...a.plane.origin, ...a.plane.u, ...a.plane.v], [...b.plane.origin, ...b.plane.u, ...b.plane.v]);
  return (
    a.page === b.page &&
    sameNumbers(a.affine, b.affine) &&
    sameNumbers(a.page_size, b.page_size) &&
    a.calibration.length === b.calibration.length &&
    a.calibration.every((c, i) => sameNumbers(c.pdf_pt, b.calibration[i].pdf_pt) && sameNumbers(c.ifc_m, b.calibration[i].ifc_m)) &&
    planeSame &&
    (a.storey_guid ?? null) === (b.storey_guid ?? null) &&
    JSON.stringify(a.region ?? null) === JSON.stringify(b.region ?? null)
  );
}

/** Adds a record to the start of the history (newest first), at most `MAX_GEOREF_HISTORY`. */
function pushHistory(history: GeorefHistoryEntry[], previous: GeorefCalibration, meta: HistoryMeta): GeorefHistoryEntry[] {
  const entry: GeorefHistoryEntry = { page: previous.page, calibration: previous, replaced_at: meta.at, replaced_by: meta.by, reason: meta.reason.slice(0, MAX_REASON) };
  return [entry, ...history].slice(0, MAX_GEOREF_HISTORY);
}

/**
 * Writes a calibration into `_georef` (v1 or v2 on input): replaces the item at the same
 * place. An automatic one does not overwrite a manual one without `force` (a manual adjustment has the last word).
 * With `meta` an overwritten calibration with a different placement is written to `history` (D-168).
 */
export function mergeCalibration(stored: unknown, next: GeorefCalibration, force = false, meta?: HistoryMeta): MergeResult {
  const cur = toGeorefV2(stored);
  let i = cur.calibrations.findIndex((c) => sameSlot(c, next));
  // A section without a crop has one calibration on a page: another plane (a corrected section mark) replaces the old one, which goes to the history.
  if (i < 0 && next.plane && !next.region) i = cur.calibrations.findIndex((c) => c.page === next.page && !!c.plane && !c.region);
  const existing = i >= 0 ? cur.calibrations[i] : null;
  if (existing && existing.source === "manual" && next.source === "auto" && !force) {
    return { ok: false, reason: "manual_exists", existing };
  }
  const calibrations = [...cur.calibrations];
  if (i >= 0) calibrations[i] = next;
  else calibrations.push(next);
  const record = !!existing && !!meta && !samePlacement(existing, next);
  const history = record ? pushHistory(cur.history ?? [], existing, meta) : (cur.history ?? []);
  return { ok: true, georef: { version: 2, calibrations, ...(history.length > 0 ? { history } : {}) }, replaced: existing, history_added: record };
}

export type RestoreResult =
  | { ok: true; georef: GeorefV2; restored: GeorefCalibration; replaced: GeorefCalibration | null }
  | { ok: false; reason: "no_history" };

/**
 * Returns the history record `index` (0 = newest of the history of page `page`) to `calibrations`. The current calibration of that
 * place goes to the history (a restore can be undone), the restored record leaves it. It overwrites a manual calibration: it is an explicit
 * choice, not a computation.
 */
export function restoreCalibration(stored: unknown, page: number, index: number, meta: HistoryMeta): RestoreResult {
  const cur = toGeorefV2(stored);
  const all = cur.history ?? [];
  const onPage = all.map((h, at) => ({ h, at })).filter(({ h }) => h.page === page);
  const pick = onPage[index];
  if (!pick) return { ok: false, reason: "no_history" };
  const restored = pick.h.calibration;
  const i = cur.calibrations.findIndex((c) => sameSlot(c, restored));
  const replaced = i >= 0 ? cur.calibrations[i] : null;
  const calibrations = [...cur.calibrations];
  if (i >= 0) calibrations[i] = restored;
  else calibrations.push(restored);
  const rest = all.filter((_, at) => at !== pick.at);
  const history = replaced ? pushHistory(rest, replaced, meta) : rest;
  return { ok: true, georef: { version: 2, calibrations, ...(history.length > 0 ? { history } : {}) }, restored, replaced };
}

export type RemoveResult =
  | { ok: true; georef: GeorefV2; removed: GeorefCalibration }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "manual_exists"; existing: GeorefCalibration };

/**
 * Deletes the calibration at place `target` (D-176, #284). A manual calibration from the panel is deleted only with `force`. The deleted
 * calibration goes to the start of `history` (newest first), so `restoreCalibration` brings it back; the history holds at most
 * `MAX_GEOREF_HISTORY` records, the oldest drops out. The other calibrations of the document stay.
 */
export function removeCalibration(stored: unknown, target: GeorefCalibration, force: boolean, meta: HistoryMeta): RemoveResult {
  const cur = toGeorefV2(stored);
  const i = cur.calibrations.findIndex((c) => sameSlot(c, target));
  if (i < 0) return { ok: false, reason: "not_found" };
  const removed = cur.calibrations[i];
  if (removed.source === "manual" && !force) return { ok: false, reason: "manual_exists", existing: removed };
  const calibrations = cur.calibrations.filter((_, at) => at !== i);
  const history = pushHistory(cur.history ?? [], removed, meta);
  return { ok: true, georef: { version: 2, calibrations, history }, removed };
}

/**
 * Saving visibility and opacity from the viewer (D-168, `SET_UNDERLAYS_3D` with `persist`): the viewer sends v1 with an unchanged
 * `affine` and `calibration`. If it matches an existing calibration of the same page and storey, only `visible` and
 * `opacity` change; `source`, `quality`, `calibrated_at` and the other fields stay (auto stays auto). Null = the placement differs or the
 * calibration does not exist, the normal path applies (manual calibration from the panel).
 */
export function visibilityOnlyUpdate(stored: unknown, v1: GeorefV1): GeorefCalibration | null {
  const probe = calibrationFromV1(v1);
  const existing = toGeorefV2(stored).calibrations.find((c) => sameSlot(c, probe));
  if (!existing) return null;
  if (!sameNumbers(existing.affine, v1.affine) || !sameNumbers(existing.page_size, v1.page_size)) return null;
  // v1 carries at most 2 points (primaryV1 shortens them), an auto calibration may have more: the beginning is compared.
  if (existing.calibration.length < v1.calibration.length) return null;
  if (!v1.calibration.every((c, i) => sameNumbers(c.pdf_pt, existing.calibration[i].pdf_pt) && sameNumbers(c.ifc_m, existing.calibration[i].ifc_m))) return null;
  return {
    ...existing,
    ...(v1.opacity !== undefined ? { opacity: v1.opacity } : {}),
    ...(v1.visible !== undefined ? { visible: v1.visible } : {}),
  };
}

/**
 * For today's fork (`parsePlacement` reads only v1): the first calibration without a plane as v1.
 * A manual one takes precedence over an automatic one on the same page. Null when there is no floor plan one.
 */
export function primaryV1(g: GeorefV2): GeorefV1 | null {
  const plans = g.calibrations.filter((c) => !c.plane && c.storey_guid && typeof c.storey_z === "number");
  const pick = plans.find((c) => c.source === "manual") ?? plans[0];
  if (!pick) return null;
  return {
    version: 1,
    storey_guid: pick.storey_guid!,
    storey_z: pick.storey_z!,
    page: pick.page,
    page_size: pick.page_size,
    affine: pick.affine,
    // The server and the panel accept 1 or 2 points for v1.
    calibration: pick.calibration.slice(0, 2),
    ...(pick.opacity !== undefined ? { opacity: pick.opacity } : {}),
    ...(pick.visible !== undefined ? { visible: pick.visible } : {}),
    discipline: pick.discipline ?? null,
    calibrated_at: pick.calibrated_at ?? null,
  };
}

/**
 * `georefV2` for the viewer (UNDERLAYS_LOAD and DOCUMENTS_LOAD, D-179): all valid calibrations of the document, without the history
 * (D-168). Null when the document has no calibration.
 */
export function georefV2Wire(stored: unknown): GeorefV2 | null {
  if (stored === undefined || stored === null) return null;
  const v2 = toGeorefV2(stored);
  return v2.calibrations.length > 0 ? { version: 2, calibrations: v2.calibrations } : null;
}

/** Calibration fields the viewer may change when saving a v2 item; `mark`, `quality` and other unknown ones stay. */
const EDITABLE_FIELDS = ["page_size", "plane", "affine", "calibration", "region", "storey_guid", "storey_z", "discipline", "opacity", "visible"] as const;

export type EditResult =
  | { ok: true; georef: GeorefV2; calibration: GeorefCalibration; history_added: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Saving a v2 item from the viewer (D-179, `UNDERLAY_SAVE` of a section): finds the calibration of the page by page and plane
 * (`sameSlot`), otherwise by `index` if the page matches and both are sections (the viewer changed the plane). Unknown fields (`mark`,
 * `quality`) stay. A change of placement (`samePlacement`) writes `source: manual`, `calibrated_at` and the previous calibration to the
 * history (D-168); a change of only `visible`/`opacity` leaves `source` and `calibrated_at` as they were.
 */
export function editCalibration(stored: unknown, incoming: GeorefCalibration, index: number | undefined, meta: HistoryMeta): EditResult {
  const cur = toGeorefV2(stored);
  let i = cur.calibrations.findIndex((c) => sameSlot(c, incoming));
  if (i < 0 && index !== undefined && Number.isInteger(index)) {
    const byIndex = cur.calibrations[index];
    if (byIndex && byIndex.page === incoming.page && !!byIndex.plane && !!incoming.plane) i = index;
  }
  if (i < 0) return { ok: false, reason: "not_found" };
  const existing = cur.calibrations[i];
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (incoming[k] !== undefined) patch[k] = incoming[k];
  const moved = !samePlacement(existing, { ...existing, ...patch } as GeorefCalibration);
  const next = {
    ...existing,
    ...patch,
    ...(moved ? { source: "manual" as const, calibrated_at: incoming.calibrated_at ?? meta.at } : {}),
  } as GeorefCalibration;
  const calibrations = [...cur.calibrations];
  calibrations[i] = next;
  const history = moved ? pushHistory(cur.history ?? [], existing, meta) : (cur.history ?? []);
  return { ok: true, georef: { version: 2, calibrations, ...(history.length > 0 ? { history } : {}) }, calibration: next, history_added: moved };
}
