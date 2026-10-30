/**
 * `_georef` dokumentu (D-072, v2 D-133) - čisté typy, validácia a zlúčenie kalibrácií.
 *
 * v1 = jedna kalibrácia (strana PDF -> vodorovná rovina podlažia). v2 = zoznam kalibrácií
 * dokumentu, každá pre stranu a rovinu: bez `plane` presne v1 (podlažie `storey_guid`), so
 * `plane` zvislá alebo iná rovina v IFC svete (rez, D-132). `source` rozlišuje ručnú
 * kalibráciu z panela Underlays (`manual`) a automatickú (`auto`, `calibrate_underlay`);
 * automatická ručnú bez `force` neprepíše.
 *
 * Bez `server-only`, aby bola logika testovateľná (vzor `capture-placement.ts`).
 */

export type Tuple2 = [number, number];
export type Tuple3 = [number, number, number];

/** Rovina podkladu v IFC svete (m): bod = origin + u·s + v·t; u × v = normála ku kamere. */
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

/** Jedna kalibrácia: strana PDF (body, vľavo dole) -> metre roviny (u, v). */
export interface GeorefCalibration {
  page: number;
  page_size: Tuple2;
  storey_guid?: string | null;
  storey_z?: number | null;
  plane?: GeorefPlane | null;
  affine: [number, number, number, number, number, number];
  calibration: { pdf_pt: Tuple2; ifc_m: Tuple2 }[];
  /** Výrez strany v % (x, y, w, h, vľavo hore), keď strana nesie viac výkresov. */
  region?: [number, number, number, number] | null;
  source: "manual" | "auto";
  quality?: GeorefQuality | null;
  opacity?: number;
  visible?: boolean;
  discipline?: string | null;
  calibrated_at?: string | null;
}

/** Najviac toľko predošlých kalibrácií drží `_georef.history` (D-168). */
export const MAX_GEOREF_HISTORY = 10;

/** Kto prepísal kalibráciu: `mcp` = calibrate_underlay, `panel` = ručná úprava v paneli Underlays. */
export type GeorefHistoryBy = "mcp" | "panel";

/** Predošlá kalibrácia strany pred prepisom polohy alebo kalibrácie (D-168); najnovšia prvá. */
export interface GeorefHistoryEntry {
  page: number;
  /** Celý záznam `calibrations[]` pred prepisom. */
  calibration: GeorefCalibration;
  replaced_at: string;
  replaced_by: GeorefHistoryBy;
  reason: string;
}

export interface GeorefV2 {
  version: 2;
  calibrations: GeorefCalibration[];
  /** Ohraničená história prepisov (D-168); chýba, kým sa nič neprepísalo. Do viewera sa neposiela. */
  history?: GeorefHistoryEntry[];
}

/** v1 (D-072) - tvar, ktorý číta dnešný fork (`parsePlacement`). */
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
  // Jednotkové a kolmé (tolerancia na zaokrúhlenie JSON).
  return Math.abs(len(u) - 1) < 1e-6 && Math.abs(len(v) - 1) < 1e-6 && Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) < 1e-6;
}

/** Validácia jednej kalibrácie v2 (untrusted vstup route aj toolu). */
export function isValidCalibration(raw: unknown): raw is GeorefCalibration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const g = raw as Record<string, unknown>;
  if (!num(g.page) || !Number.isInteger(g.page) || g.page < 1) return false;
  if (!tuple(g.page_size, 2) || (g.page_size as number[])[0] <= 0 || (g.page_size as number[])[1] <= 0) return false;
  if (!tuple(g.affine, 6)) return false;
  const a = g.affine as number[];
  if (!(Math.abs(a[0] * a[4] - a[1] * a[3]) > 0)) return false;
  // Aspoň 1 bod: jednobodová kalibrácia panela (#317) nesie mierku a natočenie v affine.
  if (!Array.isArray(g.calibration) || g.calibration.length < 1) return false;
  for (const c of g.calibration as { pdf_pt?: unknown; ifc_m?: unknown }[]) {
    if (!c || typeof c !== "object" || !tuple(c.pdf_pt, 2) || !tuple(c.ifc_m, 2)) return false;
  }
  if (g.source !== "manual" && g.source !== "auto") return false;
  const hasPlane = g.plane !== undefined && g.plane !== null;
  if (hasPlane && !validPlane(g.plane)) return false;
  // Bez roviny je to pôdorys podlažia: storey_guid a storey_z sú povinné (ako v1).
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

/** v1 -> položka v2 (pôdorys bez roviny). */
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

/** História z uloženého `_georef`: neplatné záznamy vypadnú, najviac `MAX_GEOREF_HISTORY`. */
export function historyOf(stored: unknown): GeorefHistoryEntry[] {
  const raw = stored && typeof stored === "object" ? (stored as { history?: unknown }).history : undefined;
  return Array.isArray(raw) ? raw.filter(isHistoryEntry).slice(0, MAX_GEOREF_HISTORY) : [];
}

/** Uložený `_georef` (v1 alebo v2, aj neplatný) -> v2; neplatné položky vypadnú, história ostane. */
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

/** Rovnaké miesto = tá istá strana a rovina (pôdorys: podlažie; rez: rovina do 1 cm a 0,1°). */
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

export type MergeResult =
  | { ok: true; georef: GeorefV2; replaced: GeorefCalibration | null; /** Predošlá kalibrácia išla do `history`. */ history_added: boolean }
  | { ok: false; reason: "manual_exists"; existing: GeorefCalibration };

const sameNumbers = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

/** Kto a prečo prepisuje kalibráciu; s ním sa predošlá kalibrácia zapíše do `history` (D-168). */
export interface HistoryMeta {
  by: GeorefHistoryBy;
  reason: string;
  at: string;
}

/**
 * Rovnaká poloha a kalibrácia (mierka, natočenie, posun, body, rovina, výrez)? Zmena len `visible`, `opacity`,
 * `quality`, `discipline` alebo `calibrated_at` nie je prepis polohy a do histórie nejde (D-168).
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

/** Pridá záznam na začiatok histórie (najnovší prvý), najviac `MAX_GEOREF_HISTORY`. */
function pushHistory(history: GeorefHistoryEntry[], previous: GeorefCalibration, meta: HistoryMeta): GeorefHistoryEntry[] {
  const entry: GeorefHistoryEntry = { page: previous.page, calibration: previous, replaced_at: meta.at, replaced_by: meta.by, reason: meta.reason.slice(0, MAX_REASON) };
  return [entry, ...history].slice(0, MAX_GEOREF_HISTORY);
}

/**
 * Zapíše kalibráciu do `_georef` (v1 alebo v2 na vstupe): nahradí položku na tom istom
 * mieste. Automatická neprepíše ručnú bez `force` (ručné dorovnanie je posledné slovo).
 * S `meta` sa prepísaná kalibrácia s inou polohou zapíše do `history` (D-168).
 */
export function mergeCalibration(stored: unknown, next: GeorefCalibration, force = false, meta?: HistoryMeta): MergeResult {
  const cur = toGeorefV2(stored);
  const i = cur.calibrations.findIndex((c) => sameSlot(c, next));
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
 * Vráti záznam histórie `index` (0 = najnovší z histórie strany `page`) do `calibrations`. Aktuálna kalibrácia toho
 * miesta ide do histórie (obnova sa dá vrátiť), obnovený záznam z nej odíde. Ručnú kalibráciu prepíše: je to výslovná
 * voľba, nie výpočet.
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
 * Zmaže kalibráciu na mieste `target` (D-176, #284). Ručná kalibrácia z panela sa zmaže len s `force`. Zmazaná
 * kalibrácia ide na začiatok `history` (najnovší prvý), takže `restoreCalibration` ju vráti; história drží najviac
 * `MAX_GEOREF_HISTORY` záznamov, najstarší vypadne. Ostatné kalibrácie dokumentu ostávajú.
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
 * Uloženie viditeľnosti a priehľadnosti z viewera (D-168, `SET_UNDERLAYS_3D` s `persist`): viewer pošle v1 s nezmeneným
 * `affine` a `calibration`. Ak sedí na existujúcu kalibráciu tej istej strany a podlažia, zmenia sa len `visible` a
 * `opacity`; `source`, `quality`, `calibrated_at` a ostatné polia ostanú (auto ostane auto). Null = poloha sa líši alebo
 * kalibrácia neexistuje, ide bežná cesta (ručná kalibrácia z panela).
 */
export function visibilityOnlyUpdate(stored: unknown, v1: GeorefV1): GeorefCalibration | null {
  const probe = calibrationFromV1(v1);
  const existing = toGeorefV2(stored).calibrations.find((c) => sameSlot(c, probe));
  if (!existing) return null;
  if (!sameNumbers(existing.affine, v1.affine) || !sameNumbers(existing.page_size, v1.page_size)) return null;
  // v1 nesie najviac 2 body (primaryV1 ich skracuje), auto kalibrácia ich môže mať viac: porovná sa začiatok.
  if (existing.calibration.length < v1.calibration.length) return null;
  if (!v1.calibration.every((c, i) => sameNumbers(c.pdf_pt, existing.calibration[i].pdf_pt) && sameNumbers(c.ifc_m, existing.calibration[i].ifc_m))) return null;
  return {
    ...existing,
    ...(v1.opacity !== undefined ? { opacity: v1.opacity } : {}),
    ...(v1.visible !== undefined ? { visible: v1.visible } : {}),
  };
}

/**
 * Pre dnešný fork (`parsePlacement` číta len v1): prvá kalibrácia bez roviny ako v1.
 * Ručná má prednosť pred automatickou na tej istej strane. Null, keď pôdorysná nie je.
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
    // v1 server aj panel berú 1 alebo 2 body.
    calibration: pick.calibration.slice(0, 2),
    ...(pick.opacity !== undefined ? { opacity: pick.opacity } : {}),
    ...(pick.visible !== undefined ? { visible: pick.visible } : {}),
    discipline: pick.discipline ?? null,
    calibrated_at: pick.calibrated_at ?? null,
  };
}
