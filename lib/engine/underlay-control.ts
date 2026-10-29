import { toGeorefV2, type GeorefCalibration } from "../data/georef";
import type { UnderlaysSetRequest } from "../viewer-underlays";

/**
 * Režimy `calibrate_underlay` na ovládanie podkladov (D-168, #323): `list`, `show_in_3d`, `hide`, `set_opacity`.
 * Nikdy nemenia polohu (affine) ani nespúšťajú výpočet kalibrácie; menia len viditeľnosť a priehľadnosť vo vieweri
 * (`SET_UNDERLAYS_3D`) a s `persist` ich viewer uloží cez `UNDERLAY_SAVE` ako dnes. Logika je tu, závislosti (DB,
 * živý viewer) v `underlay-control-runtime.ts`, aby sa dala testovať bez nich.
 */

export const UNDERLAY_CONTROL_MODES = ["list", "show_in_3d", "hide", "set_opacity"] as const;
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
  /** `UNDERLAY_WRITE_ENABLED`: bez neho sa `persist` neuloží. */
  writeEnabled: boolean;
}

export interface ControlResult {
  text: string;
  isError: boolean;
  /** Príkaz do viewera (`SET_UNDERLAYS_3D`); chýba pri `list` a pri chybe. */
  command?: UnderlaysSetRequest;
  /** Popis príkazu pre odkaz a log. */
  label?: string;
}

export class UnderlayControlError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Predvolená priehľadnosť kalibrácie bez `opacity` (`calibrate_underlay` ju zapisuje 0,6). */
const DEFAULT_OPACITY = 0.6;

interface Entry {
  doc: CalibratedDocument;
  cal: GeorefCalibration;
}

const label = (d: CalibratedDocument) => d.object_ref ?? d.name ?? d.id;

function entriesOf(docs: CalibratedDocument[]): Entry[] {
  return docs.flatMap((doc) => toGeorefV2(doc.georef).calibrations.map((cal) => ({ doc, cal })));
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
}

/** Podklad z `document_id` alebo `floor` (+ `page`); nejednoznačnosť a chýbajúca kalibrácia sú chyby s radou. */
async function resolveTarget(args: Record<string, unknown>, deps: ControlDeps, viewer: ViewerSnapshot): Promise<Target> {
  const documentId = textOf(args.document_id);
  const floorRef = textOf(args.floor);
  if (!documentId && !floorRef) throw new UnderlayControlError("Zadaj document_id (UUID alebo object_ref výkresu) alebo floor.");
  if (documentId && floorRef) throw new UnderlayControlError("Zadaj buď document_id, alebo floor, nie oboje.");
  const page = pageOf(args);
  const entries = entriesOf(await deps.documents());
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
  return { doc: hit.doc, cal: hit.cal, floor };
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
