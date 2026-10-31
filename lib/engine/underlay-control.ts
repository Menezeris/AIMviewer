import { historyOf, planeAxisDistance, removeCalibration, restoreCalibration, toGeorefV2, type GeorefCalibration, type RemoveResult, type RestoreResult } from "../data/georef";
import type { UnderlaysSetRequest } from "../viewer-underlays";

/**
 * Režimy `calibrate_underlay` na ovládanie podkladov (D-168, #323): `list`, `show_in_3d`, `hide`, `set_opacity`.
 * Nikdy nemenia polohu (affine) ani nespúšťajú výpočet kalibrácie; menia len viditeľnosť a priehľadnosť vo vieweri
 * (`SET_UNDERLAYS_3D`) a s `persist` ich viewer uloží cez `UNDERLAY_SAVE` ako dnes. Logika je tu, závislosti (DB,
 * živý viewer) v `underlay-control-runtime.ts`, aby sa dala testovať bez nich.
 */

export const UNDERLAY_CONTROL_MODES = ["list", "show_in_3d", "hide", "set_opacity", "history", "restore", "remove"] as const;
export type ControlMode = (typeof UNDERLAY_CONTROL_MODES)[number];

export const isControlMode = (m: unknown): m is ControlMode => (UNDERLAY_CONTROL_MODES as readonly unknown[]).includes(m);

/** Dokument s kalibráciou (`properties._georef`) z DB. */
export interface CalibratedDocument {
  id: string;
  object_ref: string | null;
  name: string | null;
  georef: unknown;
}

/** Podlažie podľa mena, kódu alebo GUID; v federácii môže mať jeden štítok viac GUID (ASR, VZT). */
export interface ResolvedFloor {
  name: string;
  guids: string[];
}

/** Podklad v stave viewera (`get_viewer_state.underlays`). */
export interface ViewerUnderlay {
  document_id: string;
  name?: string | null;
  page: number;
  storey_guid?: string | null;
  storey_z?: number | null;
  discipline?: string | null;
  calibrated_at?: string | null;
  visible: boolean;
  opacity: number;
  saved?: { visible: boolean; opacity: number };
  overridden?: boolean;
}

/** Čo viewer o podkladoch povedal; `underlays` null = starý viewer (pole v stave chýba) alebo viewer nie je. */
export interface ViewerSnapshot {
  connected: boolean;
  /** Prečo nie je (bez kanála, bez odpovede). */
  reason?: string;
  underlays: ViewerUnderlay[] | null;
  underlays_3d: boolean | null;
}

export interface ControlDeps {
  /** Dokumenty s `_georef` (aspoň jedna kalibrácia). */
  documents: () => Promise<CalibratedDocument[]>;
  /** Podlažia podľa GUID (meno na výpis). */
  floorNames: (guids: string[]) => Promise<Map<string, string>>;
  /** Podlažie z `floor` (meno, kód, UUID alebo IFC GUID); null = nenájdené. */
  floor: (ref: string) => Promise<ResolvedFloor | null>;
  viewer: () => Promise<ViewerSnapshot>;
  /** `UNDERLAY_WRITE_ENABLED`: bez neho sa `persist` ani `restore` neuloží. */
  writeEnabled: boolean;
  /** Zápis `restore` a `remove`: `apply` zlúči do aktuálneho `_georef` (prečítaného tesne pred zápisom). */
  write: (documentId: string, apply: (stored: unknown) => RestoreResult | RemoveResult) => Promise<RestoreResult | RemoveResult>;
  now: () => Date;
}

export interface ControlResult {
  text: string;
  isError: boolean;
  /** Príkaz do viewera (`SET_UNDERLAYS_3D`); chýba pri `list` a pri chybe. */
  command?: UnderlaysSetRequest;
  /** Popis príkazu pre odkaz a log. */
  label?: string;
  /** Viewer má načítať podklady z DB nanovo (`restore`, op `underlays_load`). */
  reload?: boolean;
}

export class UnderlayControlError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Predvolená priehľadnosť kalibrácie bez `opacity` (`calibrate_underlay` ju zapisuje 0,6). */
const DEFAULT_OPACITY = 0.6;

interface Entry {
  doc: CalibratedDocument;
  cal: GeorefCalibration;
  /** Kalibrácia strany už nie je živá, je len v histórii (po mode=remove). */
  removed?: boolean;
}

const label = (d: CalibratedDocument) => d.object_ref ?? d.name ?? d.id;

function entriesOf(docs: CalibratedDocument[], withHistory = false): Entry[] {
  return docs.flatMap((doc) => {
    const live = toGeorefV2(doc.georef).calibrations.map((cal) => ({ doc, cal }));
    if (!withHistory) return live;
    // Zmazaná kalibrácia (mode=remove) ostala len v histórii: strana bez živej kalibrácie sa dá ešte obnoviť (D-176).
    const pages = new Set(live.map((e) => e.cal.page));
    const gone = new Map<number, Entry>();
    for (const h of historyOf(doc.georef)) if (!pages.has(h.page) && !gone.has(h.page)) gone.set(h.page, { doc, cal: h.calibration, removed: true });
    return [...live, ...gone.values()];
  });
}

function pageOf(args: Record<string, unknown>): number | undefined {
  if (args.page === undefined) return undefined;
  const page = Number(args.page);
  if (!Number.isInteger(page) || page < 1) throw new UnderlayControlError("page je číslo strany od 1.");
  return page;
}

const textOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

interface Target {
  doc: CalibratedDocument;
  cal: GeorefCalibration;
  floor: string | null;
  /** cal je len záznam z histórie (živá kalibrácia strany bola zmazaná). */
  removed: boolean;
}

/**
 * `mode=remove` na reze (D-179): strana môže niesť viac kalibrácií roviny. So `section_plane {axis, coordinate_m}` sa
 * berie kalibrácia najbližšej roviny rovnakej orientácie; bez neho viac kalibrácií na jednej strane je chyba so
 * zoznamom, nie ticho prvá.
 */
function pickByPlane(candidates: Entry[], sectionPlane: unknown): Entry[] {
  const s = sectionPlane as { axis?: unknown; coordinate_m?: unknown } | undefined;
  const given = s !== undefined && s !== null;
  if (given && ((s.axis !== "x" && s.axis !== "y") || typeof s.coordinate_m !== "number" || !Number.isFinite(s.coordinate_m))) {
    throw new UnderlayControlError("section_plane pri mode=remove je {axis: 'x' | 'y', coordinate_m: číslo v m}.");
  }
  const byPage = new Map<string, Entry[]>();
  for (const e of candidates) byPage.set(`${e.doc.id}#${e.cal.page}`, [...(byPage.get(`${e.doc.id}#${e.cal.page}`) ?? []), e]);
  const out: Entry[] = [];
  for (const group of byPage.values()) {
    const planes = group.filter((e) => e.cal.plane);
    if (given) {
      const { axis, coordinate_m: c } = s as { axis: "x" | "y"; coordinate_m: number };
      const scored = planes
        .map((e) => ({ e, d: planeAxisDistance(e.cal.plane, axis, c) }))
        .filter((x): x is { e: Entry; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d);
      if (scored.length === 0) {
        throw new UnderlayControlError(`Strana ${group[0].cal.page} dokumentu ${label(group[0].doc)} nemá kalibráciu roviny ${axis} (orientácia ${axis === "x" ? "X = c" : "Y = c"}). ${describePlanes(planes)}`);
      }
      out.push(scored[0].e);
    } else if (planes.length > 1) {
      throw new UnderlayControlError(`Strana ${group[0].cal.page} dokumentu ${label(group[0].doc)} má ${planes.length} kalibrácie rezu: ${describePlanes(planes)} Zadaj section_plane {axis, coordinate_m} (zmaže sa najbližšia rovina).`);
    } else out.push(...group);
  }
  return out;
}

function describePlanes(planes: Entry[]): string {
  if (planes.length === 0) return "";
  return planes
    .map((e) => {
      const p = e.cal.plane!;
      const n: [number, number, number] = [p.u[1] * p.v[2] - p.u[2] * p.v[1], p.u[2] * p.v[0] - p.u[0] * p.v[2], p.u[0] * p.v[1] - p.u[1] * p.v[0]];
      const axis = Math.abs(n[0]) >= Math.abs(n[1]) ? "x" : "y";
      const k = axis === "x" ? 0 : 1;
      return `${axis} = ${(Math.round(p.origin[k] * 1000) / 1000).toString()} m (${e.cal.source}${e.cal.calibrated_at ? `, ${e.cal.calibrated_at.slice(0, 10)}` : ""})`;
    })
    .join("; ") + ".";
}

/** Podklad z `document_id` alebo `floor` (+ `page`); nejednoznačnosť a chýbajúca kalibrácia sú chyby s radou. */
async function resolveTarget(args: Record<string, unknown>, deps: ControlDeps, viewer: ViewerSnapshot, withHistory = false, bySection = false): Promise<Target> {
  const documentId = textOf(args.document_id);
  const floorRef = textOf(args.floor);
  if (!documentId && !floorRef) throw new UnderlayControlError("Zadaj document_id (UUID alebo object_ref výkresu) alebo floor.");
  if (documentId && floorRef) throw new UnderlayControlError("Zadaj buď document_id, alebo floor, nie oboje.");
  const page = pageOf(args);
  const entries = entriesOf(await deps.documents(), withHistory);
  let candidates: Entry[];
  if (documentId) {
    candidates = entries.filter((e) => (UUID_RE.test(documentId) ? e.doc.id.toLowerCase() === documentId.toLowerCase() : e.doc.object_ref === documentId));
    if (candidates.length === 0) {
      throw new UnderlayControlError(`Dokument ${documentId} nemá kalibráciu podkladu (alebo neexistuje). Zoznam: calibrate_underlay mode=list; kalibrácia: mode=auto.`);
    }
  } else {
    const floor = await deps.floor(floorRef!);
    if (!floor) throw new UnderlayControlError(`Podlažie ${floorRef} nie je v AIM.`);
    candidates = entries.filter((e) => !e.cal.plane && !!e.cal.storey_guid && floor.guids.includes(e.cal.storey_guid));
    if (candidates.length === 0) {
      throw new UnderlayControlError(`Podlažie ${floor.name} nemá kalibrovaný podklad. Kalibrácia: calibrate_underlay mode=auto s document_id výkresu pôdorysu.`);
    }
  }
  if (page !== undefined) {
    const onPage = candidates.filter((e) => e.cal.page === page);
    if (onPage.length === 0) {
      const have = [...new Set(candidates.map((e) => e.cal.page))].sort((a, b) => a - b);
      throw new UnderlayControlError(`Kalibrovaná je strana ${have.join(", ")}, nie ${page}. Viewer pozná na dokumente jednu kalibrovanú stranu.`);
    }
    candidates = onPage;
  }
  if (bySection) candidates = pickByPlane(candidates, args.section_plane);
  const distinct = new Map(candidates.map((e) => [`${e.doc.id}#${e.cal.page}`, e]));
  if (distinct.size > 1) {
    const options = [...distinct.values()]
      .map((e) => `${label(e.doc)} (document_id ${e.doc.id}, strana ${e.cal.page}${e.cal.discipline ? `, ${e.cal.discipline}` : ""})`)
      .join("; ");
    throw new UnderlayControlError(`Nejednoznačné, ${distinct.size} podklady: ${options}. Zadaj document_id${new Set(candidates.map((e) => e.doc.id)).size === 1 ? " a page" : ""}.`);
  }
  const hit = [...distinct.values()][0];
  // Viewer pozná na document_id jednu kalibrovanú stranu: nesedí = chyba, nie ticho iný podklad.
  const known = viewer.underlays?.find((u) => u.document_id.toLowerCase() === hit.doc.id.toLowerCase());
  if (known && known.page !== hit.cal.page) {
    throw new UnderlayControlError(`Viewer pozná na dokumente ${label(hit.doc)} stranu ${known.page}, nie ${hit.cal.page}; zadaj page=${known.page} alebo obnov stránku viewera.`);
  }
  const names = hit.cal.storey_guid ? await deps.floorNames([hit.cal.storey_guid]) : new Map<string, string>();
  const floor = hit.cal.storey_guid ? (names.get(hit.cal.storey_guid) ?? null) : null;
  return { doc: hit.doc, cal: hit.cal, floor, removed: hit.removed === true };
}

function optionalBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new UnderlayControlError(`${key} je true alebo false.`);
  return v;
}

export async function execUnderlayControl(args: Record<string, unknown>, deps: ControlDeps): Promise<ControlResult> {
  try {
    return await run(args, deps);
  } catch (err) {
    if (err instanceof UnderlayControlError) return { text: err.message, isError: true };
    return { text: `Chyba podkladov: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

async function run(args: Record<string, unknown>, deps: ControlDeps): Promise<ControlResult> {
  const mode = args.mode;
  if (!isControlMode(mode)) throw new UnderlayControlError(`mode ovládania podkladov je ${UNDERLAY_CONTROL_MODES.join(" | ")}.`);
  if (mode === "history") return { text: JSON.stringify(await history(args, deps)), isError: false };
  if (mode === "restore") return restore(args, deps);
  if (mode === "remove") return remove(args, deps);
  const viewer = await deps.viewer();
  if (mode === "list") return { text: JSON.stringify(await list(deps, viewer)), isError: false };

  const persist = optionalBool(args, "persist") === true;
  const only = optionalBool(args, "only") === true;
  let opacity: number | undefined;
  if (mode === "set_opacity") {
    if (typeof args.opacity !== "number" || !Number.isFinite(args.opacity) || args.opacity < 0 || args.opacity > 1) {
      throw new UnderlayControlError("set_opacity potrebuje opacity: číslo 0 až 1 (0 priehľadný, 1 plne viditeľný).");
    }
    opacity = args.opacity;
  }
  const t = await resolveTarget(args, deps, viewer);
  const command: UnderlaysSetRequest =
    mode === "show_in_3d"
      ? { show: true, underlays: [{ document_id: t.doc.id, visible: true }], only, persist }
      : mode === "hide"
        ? { underlays: [{ document_id: t.doc.id, visible: false }], persist }
        : { underlays: [{ document_id: t.doc.id, opacity }], persist };
  const what = { show_in_3d: "zobraziť v 3D", hide: "skryť", set_opacity: `priehľadnosť ${opacity}` }[mode];
  const notes = [
    "Mení sa len viditeľnosť a priehľadnosť vo vieweri; poloha (affine) a kalibrácia ostávajú.",
    persist
      ? deps.writeEnabled
        ? "persist: viewer pošle UNDERLAY_SAVE a host stránka ho uloží (kalibrácia a source ostanú, mení sa len visible a opacity)."
        : "persist: zápis podkladov je vypnutý (UNDERLAY_WRITE_ENABLED), zmena sa neuloží a po obnove stránky zmizne."
      : "Bez persist ide o stav viewera; po obnove stránky sa vráti uložená viditeľnosť a priehľadnosť.",
  ];
  if (!viewer.connected) notes.push(`Viewer sa nepodarilo prečítať (${viewer.reason ?? "bez odpovede"}); príkaz sa pošle, potvrdenie nižšie.`);
  else if (viewer.underlays === null) {
    notes.push("Viewer je starší (get_viewer_state nemá pole underlays): rozšírený SET_UNDERLAYS_3D nepozná, jednotlivé podklady a priehľadnosť sa nezmenia. Obnov stránku viewera po nasadení novej verzie.");
  }
  return {
    text: JSON.stringify({
      mode,
      target: { document_id: t.doc.id, object_ref: t.doc.object_ref, name: t.doc.name, page: t.cal.page, floor: t.floor },
      command: { ...command },
      action: what,
      notes,
    }),
    isError: false,
    command,
    label: `Podklad ${label(t.doc)}: ${what}`,
  };
}

const NO_VIEWER: ViewerSnapshot = { connected: false, underlays: null, underlays_3d: null };

/** Čitateľný súhrn kalibrácie (bez bodov): poloha, mierka, natočenie, kvalita. */
function summary(c: GeorefCalibration) {
  const [a, , tx, cc, , ty] = c.affine;
  return {
    page: c.page,
    source: c.source,
    calibrated_at: c.calibrated_at ?? null,
    offset_m: [Math.round(tx * 1000) / 1000, Math.round(ty * 1000) / 1000],
    rotation_deg: Math.round(Math.atan2(cc, a) * 18000 / Math.PI) / 100,
    scale_m_per_pt: Math.round(Math.hypot(a, cc) * 1e6) / 1e6,
    median_mm: c.quality?.median_mm ?? null,
    p90_mm: c.quality?.p90_mm ?? null,
    visible: c.visible ?? true,
    opacity: c.opacity ?? DEFAULT_OPACITY,
  };
}

function indexOf(args: Record<string, unknown>): number {
  const i = args.index;
  if (typeof i !== "number" || !Number.isInteger(i) || i < 0) throw new UnderlayControlError("restore potrebuje index: celé číslo od 0 (0 = najnovší záznam z mode=history).");
  return i;
}

/** História prepisov kalibrácie strany (`_georef.history`, najnovšia prvá): index sa dá dať do `restore`. */
async function history(args: Record<string, unknown>, deps: ControlDeps) {
  const t = await resolveTarget(args, deps, NO_VIEWER, true);
  const entries = historyOf(t.doc.georef).filter((h) => h.page === t.cal.page);
  return {
    target: { document_id: t.doc.id, object_ref: t.doc.object_ref, name: t.doc.name, page: t.cal.page, floor: t.floor },
    current: t.removed ? null : summary(t.cal),
    ...(t.removed ? { removed: true } : {}),
    count: entries.length,
    history: entries.map((h, index) => ({ index, replaced_at: h.replaced_at, replaced_by: h.replaced_by, reason: h.reason, ...summary(h.calibration) })),
    note: entries.length === 0 ? "Zatiaľ sa nič neprepísalo (história drží najviac 10 prepisov polohy alebo kalibrácie, nie zmeny visible a opacity)." : "Obnova: mode=restore s týmto document_id, page a index.",
  };
}

/** Vráti záznam histórie do kalibrácie; aktuálna kalibrácia ide do histórie. Nič sa nepočíta. */
async function restore(args: Record<string, unknown>, deps: ControlDeps): Promise<ControlResult> {
  const index = indexOf(args);
  const t = await resolveTarget(args, deps, NO_VIEWER, true);
  if (!deps.writeEnabled) throw new UnderlayControlError("Zápis kalibrácie je vypnutý (UNDERLAY_WRITE_ENABLED), obnova sa neuloží.");
  const result = await deps.write(t.doc.id, (stored) =>
    restoreCalibration(stored, t.cal.page, index, { by: "mcp", reason: `restore index ${index}`, at: deps.now().toISOString() }),
  );
  if (!result.ok || !("restored" in result)) throw new UnderlayControlError(`Strana ${t.cal.page} nemá v histórii záznam s indexom ${index}. Zoznam: mode=history.`);
  return {
    text: JSON.stringify({
      mode: "restore",
      target: { document_id: t.doc.id, object_ref: t.doc.object_ref, name: t.doc.name, page: t.cal.page, floor: t.floor },
      restored: summary(result.restored),
      replaced: result.replaced ? summary(result.replaced) : null,
      history_count: historyOf(result.georef).filter((h) => h.page === t.cal.page).length,
      note: "Obnovená kalibrácia je uložená; predošlá aktuálna išla do histórie (obnova sa dá vrátiť). Viewer dostane podklady nanovo (UNDERLAYS_LOAD).",
    }),
    isError: false,
    reload: true,
    label: `Podklad ${label(t.doc)}: obnova kalibrácie`,
  };
}

/**
 * Zmaže kalibráciu podkladu (D-176, #284): len na výslovný pokyn používateľa. Ručná kalibrácia z panela len s `force`.
 * Zmazaná kalibrácia ide do `_georef.history`, takže `restore` ju vráti; viewer dostane podklady nanovo.
 */
async function remove(args: Record<string, unknown>, deps: ControlDeps): Promise<ControlResult> {
  const t = await resolveTarget(args, deps, NO_VIEWER, false, true);
  if (!deps.writeEnabled) throw new UnderlayControlError("Zápis kalibrácie je vypnutý (UNDERLAY_WRITE_ENABLED), zmazanie sa neuloží.");
  const force = optionalBool(args, "force") === true;
  const result = await deps.write(t.doc.id, (stored) =>
    removeCalibration(stored, t.cal, force, { by: "mcp", reason: "remove", at: deps.now().toISOString() }),
  );
  if (!result.ok) {
    if (result.reason === "manual_exists") {
      throw new UnderlayControlError(`Strana ${t.cal.page} má ručnú kalibráciu z panela Underlays (${result.existing.calibrated_at ?? "bez dátumu"}); zmaže ju len force=true na výslovný pokyn. Zmazanie sa dá vrátiť cez mode=restore.`);
    }
    throw new UnderlayControlError(`Kalibrácia strany ${t.cal.page} už v dokumente nie je (zmazal ju iný zásah). Zoznam: mode=list.`);
  }
  if (!("removed" in result)) throw new UnderlayControlError("Zmazanie vrátilo neočakávaný výsledok.");
  return {
    text: JSON.stringify({
      mode: "remove",
      target: { document_id: t.doc.id, object_ref: t.doc.object_ref, name: t.doc.name, page: t.cal.page, floor: t.floor },
      removed: summary(result.removed),
      remaining_calibrations: toGeorefV2(result.georef).calibrations.length,
      history_count: historyOf(result.georef).filter((h) => h.page === t.cal.page).length,
      note: "Kalibrácia je zmazaná a uložená v histórii (najnovší záznam, index 0): vráti ju mode=restore s týmto document_id, page a index=0. Viewer dostane podklady nanovo (UNDERLAYS_LOAD).",
    }),
    isError: false,
    reload: true,
    label: `Podklad ${label(t.doc)}: kalibrácia zmazaná`,
  };
}

interface ListRow {
  document_id: string;
  object_ref: string | null;
  name: string | null;
  page: number;
  floor: string | null;
  visible: boolean;
  opacity: number;
  saved_visible: boolean;
  saved_opacity: number;
  overridden?: boolean;
  source: "auto" | "manual" | null;
  calibrated_at: string | null;
  underlays_3d: boolean | null;
}

async function list(deps: ControlDeps, viewer: ViewerSnapshot) {
  const entries = entriesOf(await deps.documents());
  const guids = [...new Set(entries.map((e) => e.cal.storey_guid).filter((g): g is string => !!g))];
  const floors = guids.length > 0 ? await deps.floorNames(guids) : new Map<string, string>();
  const live = new Map((viewer.underlays ?? []).map((u) => [`${u.document_id.toLowerCase()}#${u.page}`, u]));
  const seen = new Set<string>();
  const rows: ListRow[] = entries.map(({ doc, cal }) => {
    const key = `${doc.id.toLowerCase()}#${cal.page}`;
    const u = live.get(key);
    if (u) seen.add(key);
    const savedVisible = u?.saved?.visible ?? cal.visible ?? true;
    const savedOpacity = u?.saved?.opacity ?? cal.opacity ?? DEFAULT_OPACITY;
    return {
      document_id: doc.id,
      object_ref: doc.object_ref,
      name: doc.name,
      page: cal.page,
      floor: cal.storey_guid ? (floors.get(cal.storey_guid) ?? null) : null,
      visible: u?.visible ?? savedVisible,
      opacity: u?.opacity ?? savedOpacity,
      saved_visible: savedVisible,
      saved_opacity: savedOpacity,
      ...(u ? { overridden: u.overridden === true } : {}),
      source: cal.source,
      calibrated_at: cal.calibrated_at ?? null,
      underlays_3d: viewer.underlays_3d,
    };
  });
  // Podklady, ktoré viewer pozná, ale v DB nie sú (kalibrácia ešte neuložená).
  for (const [key, u] of live) {
    if (seen.has(key)) continue;
    rows.push({
      document_id: u.document_id,
      object_ref: null,
      name: u.name ?? null,
      page: u.page,
      floor: u.storey_guid ? (floors.get(u.storey_guid) ?? null) : null,
      visible: u.visible,
      opacity: u.opacity,
      saved_visible: u.saved?.visible ?? u.visible,
      saved_opacity: u.saved?.opacity ?? u.opacity,
      overridden: u.overridden === true,
      source: null,
      calibrated_at: u.calibrated_at ?? null,
      underlays_3d: viewer.underlays_3d,
    });
  }
  const source = !viewer.connected
    ? { viewer: "nie je", reason: viewer.reason ?? "bez odpovede", note: "Len z DB: visible a opacity sú uložené hodnoty, underlays_3d neznáme." }
    : viewer.underlays === null
      ? { viewer: "starý", note: "Viewer je starší (get_viewer_state nemá pole underlays): visible a opacity sú uložené hodnoty z DB." }
      : { viewer: "živý" };
  return { count: rows.length, ...source, underlays: rows };
}
