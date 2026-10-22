/**
 * Viewer operácie (wire formát `ops` v URL `/ifc?ops=...`, D-066) - jeden zdroj
 * pre server (tools ich skladajú) aj klienta (`components/ifc-viewer.tsx` ich
 * parsuje a posiela ako bridge správy do forku viewera).
 *
 * Formát: `<op>:<arg>:<guid.guid...>` spájané `;`. Delí sa len na `;` a `:`,
 * takže argument smie niesť bodku aj mínus (`h=-0.4`); tretie pole sú IFC GUID
 * oddelené bodkou (base64 abeceda IFC bodku ani dvojbodku neobsahuje).
 *
 * Množinové varianty `<op>_sel:<arg>:<selektor>` nesú selektor `t=IfcA.IfcB~m=Model`.
 * Pohľad (D-083): `section:<y|x|z>[~h=<m>][~p=<pct>][~f=1][~g=0|1]:<storeyGuid>` (g = widget rezu, #63),
 * rez cez prvky (D-085) `section:<auto|y|x|z>~fit=<along|across|center>:<guid.guid...>`
 * a na súradnici IFC sveta `section:<y|x|z>~c=<m>::`,
 * `section_clear::`, `section_gizmo:<0|1>:`, `camera:<preset>[~proj=o|p]:<guid.guid...>` (fit a relatívne kroky
 * `~fit=..~z=..~oh=..~ov=..~px=..~py=..`, okraj a časť cieľa `~mg=..~ar=..` (D-128) a `camera_sel:<arg>:<selektor>`,
 * D-094/D-098, `lib/viewer-camera.ts`),
 * `view:<3d|2d|split>:<storeyGuid>`, `doc:<page>[~r=<x>_<y>_<w>_<h>][~h=<x>_<y>_<w>_<h>_...]:<documentId>`
 * (výrez strany v %, D-117; rámiky okolo textu v %, po štyroch číslach, D-123; `~l=s` = vedľa 3D, D-132).
 * Záložky a rezný box (D-132): `tab:<action>:<base64url JSON>`, `section_box:...`, formát v `lib/viewer-tabs.ts`.
 * Presná póza kamery z uloženého pohľadu (D-122): `pose:<px,py,pz,tx,ty,tz,ux,uy,uz>[~o=<m>][~proj=o|p]:`
 * (IFC svet, m; `o` = polovica výšky ortografického pohľadu).
 * Lens z chatu (D-096): `lens:<mode>[~r=<rev>]:<base64url JSON>`, formát v `lib/viewer-lens.ts`.
 * Panely (D-127): `panels:~<panel>=<open|close|toggle>~...:` (`all` len `close`).
 * Čiara trasy (D-137): `route:<hex>:<x,y,z|...>` (prázdne body = zmazať), formát v `lib/viewer-route.ts`.
 */

import { LENS_MODES, decodeLensWire, lensBridgeMessage, type LensMode, type LensWire } from "./viewer-lens";
import { parseSectionCapArg, sectionCapBridgeMessage, type SectionCapOp } from "./viewer-section-cap";
import { decodeListWire, listBridgeMessage, type ListWire } from "./viewer-list";
import { cameraMoveArgs, marginToPadding, parseCameraMove, type BridgeViewpoint, type CameraMove } from "./viewer-camera";
import { decodeMeasureWire, type MeasurePoint, type MeasureSegment } from "./viewer-measure";
import { parseRouteOp } from "./viewer-route";
import { parseTabsOp, tabsBridgeMessage, type TabsOp } from "./viewer-tabs";

export interface OpsSelector {
  types?: string[];
  model?: string;
}

/** Výrez strany dokumentu (D-117): x, y = ľavý horný roh, w, h = rozmer, všetko v % strany. */
export interface DocRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Výrez a rámiky: drôt (op) nesie percentá, fork čaká zlomky strany (0-1). */
const toFraction = (r: DocRegion) => ({ x: r.x / 100, y: r.y / 100, w: r.w / 100, h: r.h / 100 });
const pctList = (r: DocRegion) => [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(2)).join("_");

export const SECTION_AXES = ["y", "x", "z"] as const;
export type SectionAxis = (typeof SECTION_AXES)[number];
/** Rez cez prvok (D-085): pozdĺž / naprieč dlhšej vodorovnej strany, alebo stredom na osi. */
export const SECTION_FITS = ["along", "across", "center"] as const;
export type SectionFit = (typeof SECTION_FITS)[number];
/** Najviac cieľových prvkov rezu - rovnaký limit ako most forku. */
export const MAX_SECTION_TARGETS = 100;
/** Rozsah súradnice roviny v IFC svete (m) - rovnaký ako most forku. */
export const SECTION_COORDINATE_LIMIT = 1e7;
/** keep = zachovať smer, section = kolmo na aktívny rez (D-094). */
export const CAMERA_PRESETS = ["top", "bottom", "front", "back", "left", "right", "iso", "fit_all", "keep", "section"] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];
export const VIEW_MODES = ["3d", "2d", "split"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export type Projection = "perspective" | "orthographic";

/** Výška rezu nad úrovňou podlažia (m) - rozsah, ktorý server aj klient prijmú. */
export const SECTION_OFFSET_RANGE = { min: -5, max: 20 } as const;

/**
 * Panel vlastností po výbere (D-113): sekcia a zvýraznená vlastnosť. Záložka AIM | IFC
 * zanikla (D-127); `t=` sa z drôtu ešte prečíta kvôli starším odkazom, server ho neposiela.
 */
export const PANEL_TABS = ["aim", "ifc"] as const;
export const PANEL_SECTIONS = ["properties", "quantities"] as const;
export interface SelectPanel {
  tab?: (typeof PANEL_TABS)[number];
  section?: (typeof PANEL_SECTIONS)[number];
  focus?: { pset: string; property: string };
}

/** Panely viewera z chatu (D-127): mená zhodné s mostom forku (`view-protocol.ts`). */
export const VIEWER_PANELS = ["lens", "properties", "underlays", "documents", "lists", "model_tree"] as const;
export type ViewerPanel = (typeof VIEWER_PANELS)[number];
export const PANEL_ACTIONS = ["open", "close", "toggle"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];
export type PanelsRequest = Partial<Record<ViewerPanel | "all", PanelAction>>;

export type ViewerOp =
  | { op: "colorize"; guids: string[]; color: string }
  | { op: "hide" | "show" | "isolate"; guids: string[] }
  | { op: "colorize_sel"; selector: OpsSelector; color: string }
  | { op: "hide_sel" | "show_sel" | "isolate_sel"; selector: OpsSelector }
  | { op: "select"; guid: string; /** Všetky GUIDy výberu, keď je ich viac (#217); `guid` je prvý. */ guids?: string[]; panel?: SelectPanel }
  | { op: "show_all" }
  /** Zruší len izoláciu a X-ray z chatu (bridge `APPLY_LENS unisolate`), rez, skryté prvky a farby ostanú (D-151). */
  | { op: "clear_isolation" }
  | { op: "reset_colors" }
  /** Zruší oranžové zvýraznenie z show_in_3d, ostatné farby nechá (D-101, #94). */
  | { op: "clear_focus" }
  | { op: "clear_selection" }
  | {
      op: "section";
      /** Chýba len pri `fit` along/across - os volí viewer podľa obálky prvkov. */
      axis?: SectionAxis;
      storeyGuid?: string;
      offsetM?: number;
      position?: number;
      guids?: string[];
      fit?: SectionFit;
      coordinate?: number;
      flipped?: boolean;
      /** false = skryť widget rezu (quad a obrys), rez ostáva (#63). */
      showGizmo?: boolean;
    }
  | { op: "section_clear" }
  /** Vzhľad reznej plochy (D-120), `lib/viewer-section-cap.ts`. */
  | SectionCapOp
  | { op: "section_gizmo"; showGizmo: boolean }
  | ({ op: "camera"; preset: CameraPreset; projection?: Projection; guids: string[]; selector?: OpsSelector } & CameraMove)
  /** Presná póza (D-122): fork ju prenesie do kamery ako `SET_CAMERA {viewpoint}` (D-098). */
  | { op: "pose"; viewpoint: BridgeViewpoint; projection?: Projection }
  | { op: "view"; mode: ViewMode; storeyGuid?: string }
  /** layout split = karta vedľa 3D, inak záložka na celú plochu (D-132). */
  | { op: "doc"; documentId: string; page?: number; region?: DocRegion; highlights?: DocRegion[]; layout?: "split" }
  /** Záložky viewera a rezný box (D-132), `lib/viewer-tabs.ts`. */
  | TabsOp
  | { op: "lens"; mode: LensMode; rev?: string; wire: LensWire }
  /** Zoznam z chatu do panela Lists (D-111), formát v `lib/viewer-list.ts`. */
  | { op: "list"; wire: ListWire }
  /** Kóty v IFC svete do nástroja Measure forku (D-124), formát v `lib/viewer-measure.ts`. */
  | { op: "measure"; segments: MeasureSegment[]; keep?: boolean }
  /** Čiara trasy v IFC svete (D-137), formát v `lib/viewer-route.ts`; prázdne body = zmazať. */
  | { op: "route"; color: string; points: MeasurePoint[] }
  /** Otvorenie / zatvorenie panelov (D-127). */
  | { op: "panels"; panels: PanelsRequest };

const HEX6 = /^[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSelector(raw: string): OpsSelector | null {
  const sel: OpsSelector = {};
  for (const field of raw.split("~")) {
    if (field.startsWith("t=")) {
      const types = field.slice(2).split(".").filter(Boolean);
      if (types.length > 0) sel.types = types;
    } else if (field.startsWith("m=")) {
      const model = field.slice(2).trim();
      if (model) sel.model = model;
    }
  }
  return sel.types || sel.model ? sel : null;
}

/** `head~k=v~k=v` -> [head, {k: v}] */
function parseArg(arg: string): [string, Record<string, string>] {
  const [head, ...rest] = arg.split("~");
  const kv: Record<string, string> = {};
  for (const r of rest) {
    const i = r.indexOf("=");
    if (i > 0) kv[r.slice(0, i)] = r.slice(i + 1);
  }
  return [head, kv];
}

/**
 * Výrez strany z `r=x_y_w_h` (D-117): percentá, orezané do strany; prázdny alebo
 * mimo strany = bez výrezu (karta sa otvorí celá).
 */
export function parseDocRegion(raw: string | undefined): DocRegion | undefined {
  if (!raw) return undefined;
  const parts = raw.split("_").map((v) => finite(v, -1000, 1000));
  if (parts.length !== 4 || parts.some((v) => v === undefined)) return undefined;
  return clampDocRegion({ x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! });
}

/** Výrez z parametra toolu `region` ({x, y, width, height} v %, D-117); undefined = chybný alebo mimo strany. */
export function docRegionInput(raw: unknown): DocRegion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = [r.x, r.y, r.width, r.height];
  if (!n.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  const [x, y, w, h] = n as number[];
  return clampDocRegion({ x, y, w, h });
}

/** Výrez orezaný do strany (0-100 %), najmenej 1 % na os; undefined = celý mimo strany. */
export function clampDocRegion(r: DocRegion): DocRegion | undefined {
  const axis = (start: number, size: number): [number, number] | undefined => {
    const lo = Math.max(0, start);
    const hi = Math.min(100, start + size);
    if (!(hi - lo > 0)) return undefined;
    const len = Math.max(1, hi - lo);
    return [Math.min(lo, 100 - len), len];
  };
  const x = axis(r.x, r.w);
  const y = axis(r.y, r.h);
  return x && y ? { x: x[0], y: y[0], w: x[1], h: y[1] } : undefined;
}

/** Najviac rámikov naraz (D-123), rovnako ako vo forku. */
export const MAX_DOC_HIGHLIGHTS = 20;

/**
 * Rámik okolo textu (D-123): orezaný do strany ako výrez, ale bez 1 % minima,
 * lebo riadok textu býva vysoký 0,4-1 % strany (najmenej 0,1 %).
 */
export function clampDocHighlight(r: DocRegion): DocRegion | undefined {
  const axis = (start: number, size: number): [number, number] | undefined => {
    const lo = Math.max(0, start);
    const hi = Math.min(100, start + size);
    if (!(hi - lo > 0)) return undefined;
    // Rozmer vnútri strany ostáva presný (bez odčítania, ktoré pridá chybu zaokrúhlenia).
    const len = Math.max(0.1, Math.min(start < 0 ? start + size : size, 100 - lo));
    return [Math.min(lo, 100 - len), len];
  };
  const x = axis(r.x, r.w);
  const y = axis(r.y, r.h);
  return x && y ? { x: x[0], y: y[0], w: x[1], h: y[1] } : undefined;
}

/** Rámiky z `h=x_y_w_h_x_y_w_h...` (D-123); neplatné vynechá. */
export function parseDocHighlights(raw: string | undefined): DocRegion[] {
  if (!raw) return [];
  const n = raw.split("_").map((v) => finite(v, -1000, 1000));
  const out: DocRegion[] = [];
  for (let i = 0; i + 3 < n.length && out.length < MAX_DOC_HIGHLIGHTS; i += 4) {
    const [x, y, w, h] = n.slice(i, i + 4);
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    const r = clampDocHighlight({ x, y, w, h });
    if (r) out.push(r);
  }
  return out;
}

/** Rámiky z parametra toolu `highlights` ([{x, y, width, height}] v %, D-123); neplatné vynechá. */
export function docHighlightsInput(raw: unknown): DocRegion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const r = item as Record<string, unknown>;
      const n = [r.x, r.y, r.width, r.height];
      if (!n.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
      const [x, y, w, h] = n as number[];
      return clampDocHighlight({ x, y, w, h });
    })
    .filter((r): r is DocRegion => r !== undefined)
    .slice(0, MAX_DOC_HIGHLIGHTS);
}

function finite(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Meno psetu/vlastnosti do `ops`: oddeľovače `: ; . ~` nesmú prejsť. */
const encName = (v: string) => encodeURIComponent(v).replace(/\./g, "%2E").replace(/~/g, "%7E");
function decName(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const out = decodeURIComponent(v);
    return out.length > 0 && out.length <= 200 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** `~t=ifc~s=quantities~p=<pset>~v=<vlastnosť>` -> panel; nič platné = undefined. */
function parsePanel(arg: string): SelectPanel | undefined {
  const [, kv] = parseArg(arg);
  const panel: SelectPanel = {};
  if ((PANEL_TABS as readonly string[]).includes(kv.t)) panel.tab = kv.t as SelectPanel["tab"];
  if ((PANEL_SECTIONS as readonly string[]).includes(kv.s)) panel.section = kv.s as SelectPanel["section"];
  const pset = decName(kv.p);
  const property = decName(kv.v);
  if (pset && property) panel.focus = { pset, property };
  return panel.tab || panel.section || panel.focus ? panel : undefined;
}

/** Op výberu (D-082) s voliteľným panelom (D-113). */
export function selectOp(guid: string | readonly string[], panel?: SelectPanel): string {
  const kv = [
    panel?.tab ? `t=${panel.tab}` : "",
    panel?.section ? `s=${panel.section}` : "",
    panel?.focus ? `p=${encName(panel.focus.pset)}~v=${encName(panel.focus.property)}` : "",
  ].filter(Boolean);
  return `select:${kv.length ? `~${kv.join("~")}` : ""}:${typeof guid === "string" ? guid : guid.join(".")}`;
}

const vec = (n: number[], i: number) => ({ x: n[i], y: n[i + 1], z: n[i + 2] });

/** `px,py,pz,tx,ty,tz,ux,uy,uz~o=..~proj=..` -> póza; mimo rozsahu mosta forku = null. */
function parsePose(arg: string): { viewpoint: BridgeViewpoint; projection?: Projection } | null {
  const [head, kv] = parseArg(arg);
  const n = head.split(",").map((v) => finite(v, -SECTION_COORDINATE_LIMIT, SECTION_COORDINATE_LIMIT));
  if (n.length !== 9 || n.some((v) => v === undefined)) return null;
  const nums = n as number[];
  if (Math.hypot(nums[6], nums[7], nums[8]) <= 1e-6) return null;
  const orthoSize = finite(kv.o, 1e-3, SECTION_COORDINATE_LIMIT);
  if (kv.o !== undefined && orthoSize === undefined) return null;
  const projection = kv.proj === "o" ? "orthographic" : kv.proj === "p" ? "perspective" : undefined;
  return {
    viewpoint: { position: vec(nums, 0), target: vec(nums, 3), up: vec(nums, 6), ...(orthoSize !== undefined ? { orthoSize } : {}) },
    ...(projection ? { projection } : {}),
  };
}

/** `~lens=close~properties=open` -> panely; `all` len s `close`, nič platné = null. */
function parsePanels(arg: string): PanelsRequest | null {
  const [, kv] = parseArg(arg);
  const out: PanelsRequest = {};
  for (const [k, v] of Object.entries(kv)) {
    if (!(PANEL_ACTIONS as readonly string[]).includes(v)) continue;
    if ((VIEWER_PANELS as readonly string[]).includes(k) || (k === "all" && v === "close")) out[k as ViewerPanel | "all"] = v as PanelAction;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Op panelov (D-127): `panels:~lens=close~...:`. */
export function panelsOp(panels: PanelsRequest): string {
  const kv = Object.entries(panels).map(([k, v]) => `${k}=${v}`);
  return `panels:~${kv.join("~")}:`;
}

/** Rozparsuje `ops`; neznáme alebo chybné časti sa ticho zahodia (vstup je z URL). */
export function parseOps(raw: string): ViewerOp[] {
  const out: ViewerOp[] = [];
  for (const part of raw.split(";")) {
    const [op, arg = "", joined = ""] = part.split(":");
    const guids = joined.split(".").filter(Boolean);
    const sel = op.endsWith("_sel") ? parseSelector(joined) : null;
    if (op === "colorize" && guids.length > 0 && HEX6.test(arg)) {
      out.push({ op, guids, color: `#${arg}` });
    } else if ((op === "hide" || op === "show" || op === "isolate") && guids.length > 0) {
      out.push({ op, guids });
    } else if (op === "colorize_sel" && sel && HEX6.test(arg)) {
      out.push({ op, selector: sel, color: `#${arg}` });
    } else if ((op === "hide_sel" || op === "show_sel" || op === "isolate_sel") && sel) {
      out.push({ op, selector: sel });
    } else if (op === "select" && guids.length > 0) {
      // Výber ako klik (D-082); viac GUIDov = viacnásobný výber (#217), panel patrí prvému.
      const panel = parsePanel(arg);
      const all = [...new Set(guids)];
      out.push({ op, guid: all[0], ...(all.length > 1 ? { guids: all } : {}), ...(panel ? { panel } : {}) });
    } else if (op === "show_all" || op === "clear_isolation" || op === "reset_colors" || op === "section_clear" || op === "clear_focus" || op === "clear_selection") {
      out.push({ op });
    } else if (op === "section_gizmo" && (arg === "0" || arg === "1")) {
      out.push({ op, showGizmo: arg === "1" });
    } else if (op === "section_cap") {
      const cap = parseSectionCapArg(arg);
      if (cap) out.push(cap);
    } else if (op === "section") {
      const [axis, kv] = parseArg(arg);
      const flip = {
        ...(kv.f === "1" ? { flipped: true } : {}),
        ...(kv.g === "0" || kv.g === "1" ? { showGizmo: kv.g === "1" } : {}),
      };
      if (kv.fit !== undefined) {
        // Rez cez prvky: GUIDy sú ciele, nie podlažie.
        const fit = kv.fit as SectionFit;
        if (!(SECTION_FITS as readonly string[]).includes(fit)) continue;
        if (guids.length === 0 || guids.length > MAX_SECTION_TARGETS) continue;
        const auto = fit === "along" || fit === "across";
        if (auto ? axis !== "auto" : !(SECTION_AXES as readonly string[]).includes(axis)) continue;
        out.push({ op, ...(auto ? {} : { axis: axis as SectionAxis }), guids, fit, ...flip });
        continue;
      }
      if (!(SECTION_AXES as readonly string[]).includes(axis)) continue;
      const coordinate = finite(kv.c, -SECTION_COORDINATE_LIMIT, SECTION_COORDINATE_LIMIT);
      if (kv.c !== undefined) {
        if (coordinate === undefined || guids.length > 0) continue;
        out.push({ op, axis: axis as SectionAxis, coordinate, ...flip });
        continue;
      }
      const offsetM = finite(kv.h, SECTION_OFFSET_RANGE.min, SECTION_OFFSET_RANGE.max);
      const position = finite(kv.p, 0, 100);
      const storeyGuid = guids[0];
      // Rez potrebuje podlažie (vodorovný) alebo polohu v percentách.
      if (!storeyGuid && position === undefined) continue;
      if (storeyGuid && axis !== "y") continue;
      out.push({
        op,
        axis: axis as SectionAxis,
        ...(storeyGuid ? { storeyGuid, offsetM: offsetM ?? 1.2 } : {}),
        ...(position !== undefined && !storeyGuid ? { position } : {}),
        ...flip,
      });
    } else if (op === "camera" || op === "camera_sel") {
      const [preset, kv] = parseArg(arg);
      if (!(CAMERA_PRESETS as readonly string[]).includes(preset)) continue;
      if (op === "camera_sel" && !sel) continue;
      const projection = kv.proj === "o" ? "orthographic" : kv.proj === "p" ? "perspective" : undefined;
      out.push({
        op: "camera",
        preset: preset as CameraPreset,
        guids: sel ? [] : guids,
        ...(sel ? { selector: sel } : {}),
        ...(projection ? { projection } : {}),
        ...parseCameraMove(kv),
      });
    } else if (op === "pose") {
      const pose = parsePose(arg);
      if (pose) out.push({ op, ...pose });
    } else if (op === "view") {
      if (!(VIEW_MODES as readonly string[]).includes(arg)) continue;
      out.push({ op, mode: arg as ViewMode, ...(guids[0] ? { storeyGuid: guids[0] } : {}) });
    } else if (op === "lens") {
      const [mode, kv] = parseArg(arg);
      if (!(LENS_MODES as readonly string[]).includes(mode)) continue;
      const wire = decodeLensWire(joined);
      if (!wire) continue;
      const rev = kv.r && /^[A-Za-z0-9_-]{1,64}$/.test(kv.r) ? kv.r : undefined;
      out.push({ op, mode: mode as LensMode, ...(rev ? { rev } : {}), wire });
    } else if (op === "list") {
      const wire = decodeListWire(joined);
      if (wire) out.push({ op, wire });
    } else if (op === "measure") {
      const segments = decodeMeasureWire(joined);
      if (segments) out.push({ op, segments, ...(arg === "keep" ? { keep: true } : {}) });
    } else if (op === "route") {
      const line = parseRouteOp(arg, joined);
      if (line) out.push({ op, ...line });
    } else if (op === "tab" || op === "section_box") {
      const t = parseTabsOp(op, arg, joined);
      if (t) out.push(t);
    } else if (op === "panels") {
      const panels = parsePanels(arg);
      if (panels) out.push({ op, panels });
    } else if (op === "doc") {
      const documentId = joined;
      if (!UUID.test(documentId)) continue;
      const [pageArg, kv] = parseArg(arg);
      const page = finite(pageArg, 1, 100_000);
      const region = parseDocRegion(kv.r);
      const highlights = parseDocHighlights(kv.h);
      out.push({
        op,
        documentId,
        ...(page !== undefined ? { page: Math.floor(page) } : {}),
        ...(region ? { region } : {}),
        ...(highlights.length > 0 ? { highlights } : {}),
        ...(kv.l === "s" ? { layout: "split" as const } : {}),
      });
    }
  }
  return out;
}

/** Op -> bridge správa forku viewera (`apps/viewer/src/aim/`, D-066/D-082/D-083). */
export function opToBridgeMessage(o: ViewerOp): Record<string, unknown> {
  switch (o.op) {
    case "colorize":
      return { type: "COLORIZE", guids: o.guids, color: o.color };
    case "hide":
      return { type: "HIDE", guids: o.guids };
    case "show":
      return { type: "SHOW", guids: o.guids };
    case "isolate":
      return { type: "ISOLATE", guids: o.guids };
    case "colorize_sel":
      return { type: "COLORIZE", selector: o.selector, color: o.color };
    case "hide_sel":
      return { type: "HIDE", selector: o.selector };
    case "show_sel":
      return { type: "SHOW", selector: o.selector };
    case "isolate_sel":
      return { type: "ISOLATE", selector: o.selector };
    case "select":
      return { type: "SELECT", guid: o.guid, ...(o.guids ? { guids: o.guids } : {}), ...(o.panel ? { panel: o.panel } : {}) };
    case "show_all":
      return { type: "SHOW_ALL" };
    case "clear_isolation":
      return { type: "APPLY_LENS", mode: "unisolate" };
    case "reset_colors":
      return { type: "RESET_COLORS" };
    case "clear_focus":
      return { type: "CLEAR_FOCUS" };
    case "clear_selection":
      return { type: "CLEAR_SELECTION" };
    case "section": {
      const { op: _op, ...rest } = o;
      void _op;
      return { type: "SET_SECTION", action: "set", ...rest };
    }
    case "section_clear":
      return { type: "SET_SECTION", action: "clear" };
    case "section_gizmo":
      return { type: "SET_SECTION", action: "gizmo", showGizmo: o.showGizmo };
    case "section_cap":
      return sectionCapBridgeMessage(o);
    case "camera":
      return {
        type: "SET_CAMERA",
        preset: o.preset,
        ...(o.projection ? { projection: o.projection } : {}),
        ...(o.guids.length > 0 ? { guids: o.guids } : {}),
        ...(o.selector ? { selector: o.selector } : {}),
        // Relatívne kroky sem nepatria: host z nich spraví pózu (applyCameraOp v ifc-viewer.tsx).
        ...(o.fit ? { fit: o.fit } : {}),
        // Okraj a časť cieľa (D-128): fork rámuje `frameBounds` s okrajom; starší fork ich ignoruje.
        ...(o.marginPercent !== undefined ? { padding: marginToPadding(o.marginPercent) } : {}),
        ...(o.area ? { area: o.area } : {}),
      };
    case "pose":
      return { type: "SET_CAMERA", preset: "keep", viewpoint: o.viewpoint, ...(o.projection ? { projection: o.projection } : {}) };
    case "view":
      return { type: "SET_VIEW_MODE", mode: o.mode, ...(o.storeyGuid ? { storeyGuid: o.storeyGuid } : {}) };
    case "doc":
      return {
        type: "DOCUMENT_OPEN",
        documentId: o.documentId,
        ...(o.page ? { page: o.page } : {}),
        // Fork čaká zlomky strany (0-1), drôt nesie percentá.
        ...(o.region ? { region: toFraction(o.region) } : {}),
        // Rámiky (D-123): fork ich nakreslí na strane `page`; prázdne = staré zruší.
        ...(o.highlights?.length ? { highlights: o.highlights.map(toFraction) } : {}),
        ...(o.layout ? { layout: o.layout } : {}),
      };
    case "tab":
    case "section_box":
      return tabsBridgeMessage(o);
    case "lens":
      // Zónu (`aim_zone`) a dokument (`aim_document`) doplní klient pred odoslaním; tu ostanú prázdne.
      return lensBridgeMessage(o.mode, o.wire, new Map(), o.rev);
    case "list":
      // Zónu doplní klient pred odoslaním, ako pri Lens.
      return listBridgeMessage(o.wire, new Map());
    case "measure":
      return { type: "MEASURE_SHOW", segments: o.segments, ...(o.keep ? { keep: true } : {}) };
    case "route":
      return { type: "ROUTE_SHOW", points: o.points, color: o.color };
    case "panels":
      return { type: "SET_PANELS", panels: o.panels };
  }
}

// ── Buildery (server) ────────────────────────────────────────────────────────

export function sectionOp(p: {
  storeyGuid?: string;
  offsetM?: number;
  axis?: SectionAxis;
  position?: number;
  guids?: string[];
  fit?: SectionFit;
  coordinate?: number;
  flipped?: boolean;
  showGizmo?: boolean;
}): string {
  const kv: string[] = [];
  let axis: string = p.storeyGuid ? "y" : (p.axis ?? "y");
  let tail = p.storeyGuid ?? "";
  if (p.fit) {
    if (p.fit !== "center") axis = "auto";
    kv.push(`fit=${p.fit}`);
    tail = (p.guids ?? []).join(".");
  } else if (p.storeyGuid) kv.push(`h=${p.offsetM ?? 1.2}`);
  else if (p.coordinate !== undefined) kv.push(`c=${p.coordinate}`);
  else if (p.position !== undefined) kv.push(`p=${p.position}`);
  if (p.flipped) kv.push("f=1");
  if (p.showGizmo !== undefined) kv.push(`g=${p.showGizmo ? 1 : 0}`);
  return `section:${[axis, ...kv].join("~")}:${tail}`;
}

export const SECTION_CLEAR_OP = "section_clear::";

/** Len widget aktívneho rezu (#63): `section_gizmo:<0|1>:`. */
export const sectionGizmoOp = (show: boolean) => `section_gizmo:${show ? 1 : 0}:`;

function cameraArg(preset: CameraPreset, projection?: Projection, move: CameraMove = {}): string {
  const proj = projection ? [`proj=${projection === "orthographic" ? "o" : "p"}`] : [];
  return [preset, ...proj, ...cameraMoveArgs(move)].join("~");
}

export function cameraOp(preset: CameraPreset, guids: string[] = [], projection?: Projection, move?: CameraMove): string {
  return `camera:${cameraArg(preset, projection, move)}:${guids.join(".")}`;
}

/** Kamera na množinu prvkov podľa selektora (D-094) - rozloží ju viewer ako `*_sel`. */
export function cameraSelOp(preset: CameraPreset, selector: OpsSelector, projection?: Projection, move?: CameraMove): string {
  const fields = [
    ...(selector.types?.length ? [`t=${selector.types.join(".")}`] : []),
    ...(selector.model ? [`m=${selector.model}`] : []),
  ];
  return `camera_sel:${cameraArg(preset, projection, move)}:${fields.join("~")}`;
}

/** Presná póza kamery (D-122), napr. z uloženého pohľadu. */
export function poseOp(vp: BridgeViewpoint, projection?: Projection): string {
  const nums = [vp.position, vp.target, vp.up].flatMap((v) => [v.x, v.y, v.z]);
  const kv = [
    ...(vp.orthoSize !== undefined ? [`o=${vp.orthoSize}`] : []),
    ...(projection ? [`proj=${projection === "orthographic" ? "o" : "p"}`] : []),
  ];
  return `pose:${[nums.join(","), ...kv].join("~")}:`;
}

export function viewModeOp(mode: ViewMode, storeyGuid?: string): string {
  return `view:${mode}:${storeyGuid ?? ""}`;
}

export function docOp(documentId: string, page?: number, region?: DocRegion, highlights?: DocRegion[], layout?: "split"): string {
  const r = region ? `~r=${pctList(region)}` : "";
  const h = highlights?.length ? `~h=${highlights.map(pctList).join("_")}` : "";
  const l = layout === "split" ? "~l=s" : "";
  return `doc:${page ?? ""}${r}${h}${l}:${documentId}`;
}
