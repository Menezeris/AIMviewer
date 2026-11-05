/**
 * Viewer operations (wire format `ops` in the URL `/ifc?ops=...`, D-066) - one source
 * for the server (tools compose them) and the client (`components/ifc-viewer.tsx` parses
 * them and sends them as bridge messages to the viewer fork).
 *
 * Format: `<op>:<arg>:<guid.guid...>` joined by `;`. It splits only on `;` and `:`,
 * so the argument may carry a dot and a minus (`h=-0.4`); the third field is IFC GUIDs
 * separated by a dot (the IFC base64 alphabet contains neither dot nor colon).
 *
 * Set variants `<op>_sel:<arg>:<selector>` carry the selector `t=IfcA.IfcB~m=Model`.
 * View (D-083): `section:<y|x|z>[~h=<m>][~p=<pct>][~f=1][~g=0|1]:<storeyGuid>` (g = section widget, #63),
 * section through elements (D-085) `section:<auto|y|x|z>~fit=<along|across|center>:<guid.guid...>`
 * and at an IFC world coordinate `section:<y|x|z>~c=<m>::`,
 * `section_clear::`, `section_gizmo:<0|1>:`, `camera:<preset>[~proj=o|p]:<guid.guid...>` (fit and relative steps
 * `~fit=..~z=..~oh=..~ov=..~px=..~py=..`, margin and target part `~mg=..~ar=..` (D-128) and `camera_sel:<arg>:<selector>`,
 * D-094/D-098, `lib/viewer-camera.ts`),
 * `view:<3d|2d|split>:<storeyGuid>`, `doc:<page>[~r=<x>_<y>_<w>_<h>][~h=<x>_<y>_<w>_<h>_...]:<documentId>`
 * (page crop in %, D-117; frames around text in %, four numbers each, D-123; `~l=s` = next to 3D, D-132).
 * Tabs and section box (D-132): `tab:<action>:<base64url JSON>`, `section_box:...`, format in `lib/viewer-tabs.ts`.
 * Views from Presentation (D-161): `view_activate::<base64url JSON>`, `view_capture::<base64url JSON>`, format in `lib/viewer-views.ts`.
 * Clash from AIM into the panel (D-164): `clash_open::<base64url JSON>`, format in `lib/viewer-clash.ts`; clashes are filled in by the host client (async).
 * IDS from AIM into the panels (D-162): `ids_open::<base64url JSON>`, format in `lib/viewer-ids.ts`; the XML is filled in by the host client (async), so there is no bridge message here.
 * Exact camera pose from a saved view (D-122): `pose:<px,py,pz,tx,ty,tz,ux,uy,uz>[~o=<m>][~proj=o|p]:`
 * (IFC world, m; `o` = half the height of the orthographic view).
 * Lens from chat (D-096): `lens:<mode>[~r=<rev>]:<base64url JSON>`, format in `lib/viewer-lens.ts`.
 * Panels (D-127): `panels:~<panel>=<open|close|toggle>~...:` (`all` only with `close`).
 * Panel content scroll (D-146, D-150): `panel_scroll:<up|down|top|bottom>:`, or `panel_scroll:-~p=<panel>~i=<text>~pct=<n>:`;
 * zoom `panel_zoom:<in|out|reset|n>~p=<panel>:`.
 * Camera rotation around (D-154): `auto_rotate:<start|stop>[~s=<°/s>][~d=<l|r>]:`.
 * PDF underlays in 3D (D-133 addendum): `underlays3d:<0|1>:` (viewer state, not written to the DB).
 * Individual underlays, transparency and saving (D-168): `underlays_set::<base64url JSON>`, format in `lib/viewer-underlays.ts`;
 * `underlays_load::` reloads the underlays from the DB (after `calibrate_underlay mode=restore`).
 * Camera position and direction on the PDF (D-161 point 8, #282): `planpos:<0|1>:` (viewer state, not written to the DB).
 * Route line (D-137): `route:<hex>:<x,y,z|...>` (empty points = delete), format in `lib/viewer-route.ts`.
 */

import { LENS_MODES, decodeLensWire, lensBridgeMessage, type LensMode, type LensWire } from "./viewer-lens";
import { parseSectionCapArg, sectionCapBridgeMessage, type SectionCapOp } from "./viewer-section-cap";
import { decodeListWire, listBridgeMessage, type ListWire } from "./viewer-list";
import {
  AUTO_ROTATE_ACTIONS,
  AUTO_ROTATE_SPEED,
  cameraMoveArgs,
  marginToPadding,
  parseCameraMove,
  type AutoRotateAction,
  type AutoRotateDirection,
  type BridgeViewpoint,
  type CameraMove,
} from "./viewer-camera";
import { decodeMeasureWire, type MeasurePoint, type MeasureSegment } from "./viewer-measure";
import { parseRouteOp } from "./viewer-route";
import { parseTabsOp, tabsBridgeMessage, type TabsOp } from "./viewer-tabs";
import { parseUnderlaysSetOp, underlaysSetBridgeMessage, type UnderlaysLoadOp, type UnderlaysSetOp } from "./viewer-underlays";
import { parseViewsOp, viewsBridgeMessage, type ViewsOp } from "./viewer-views";
import { parseClashOp, type ClashOpenOp } from "./viewer-clash";
import { parseIdsOp, type IdsOpenOp } from "./viewer-ids";

export interface OpsSelector {
  types?: string[];
  model?: string;
}

/** Page crop of a document (D-117): x, y = top-left corner, w, h = size, all in % of the page. */
export interface DocRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop and frames: the wire (op) carries percentages, the fork expects page fractions (0-1). */
const toFraction = (r: DocRegion) => ({ x: r.x / 100, y: r.y / 100, w: r.w / 100, h: r.h / 100 });
const pctList = (r: DocRegion) => [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(2)).join("_");

export const SECTION_AXES = ["y", "x", "z"] as const;
export type SectionAxis = (typeof SECTION_AXES)[number];
/** Section through an element (D-085): along / across the longer horizontal side, or through the center on the axis. */
export const SECTION_FITS = ["along", "across", "center"] as const;
export type SectionFit = (typeof SECTION_FITS)[number];
/** At most this many section target elements - same limit as the fork bridge. */
export const MAX_SECTION_TARGETS = 100;
/** Range of the plane coordinate in the IFC world (m) - same as the fork bridge. */
export const SECTION_COORDINATE_LIMIT = 1e7;
/** keep = keep the direction, section = perpendicular to the active section (D-094). */
export const CAMERA_PRESETS = ["top", "bottom", "front", "back", "left", "right", "iso", "fit_all", "keep", "section"] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];
export const VIEW_MODES = ["3d", "2d", "split"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export type Projection = "perspective" | "orthographic";

/** Section height above the storey level (m) - range accepted by both the server and the client. */
export const SECTION_OFFSET_RANGE = { min: -5, max: 20 } as const;

/**
 * Properties panel after selection (D-113): section and highlighted property. The AIM | IFC tab
 * was dropped (D-127); `t=` is still read from the wire for older links, the server does not send it.
 */
export const PANEL_TABS = ["aim", "ifc"] as const;
export const PANEL_SECTIONS = ["properties", "quantities"] as const;
export interface SelectPanel {
  tab?: (typeof PANEL_TABS)[number];
  section?: (typeof PANEL_SECTIONS)[number];
  focus?: { pset: string; property: string };
}

/**
 * Viewer panels from chat (D-127, D-150): the panel name is an id from the fork's panel registry (`bcf`, `compare`, `lens`,
 * `properties`, `lists`...; historical `underlays` and `model_tree`). The list is not here, the fork holds it and returns it
 * in `view_state.panels` with shortcuts; the host only checks the shape of the name, an unknown name is reported by the viewer in `APPLIED`.
 */
export const PANEL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export const PANEL_ACTIONS = ["open", "close", "toggle"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];
export type PanelsRequest = Record<string, PanelAction>;
/**
 * Panel width and side (D-172, #320): `width_pct` 5 to 90 % of the viewer window, `side` where to pin the panel (`left`, `right`,
 * `bottom`, `free`); at least one of them. The behavior depending on where the panel is is handled by the viewer (right column 14 to 60 %,
 * floating window, pinning), the host only needs the shape.
 */
export const PANEL_WIDTH_PCT = { min: 5, max: 90 } as const;
export const PANEL_SIDES = ["left", "right", "bottom", "free"] as const;
export type PanelSide = (typeof PANEL_SIDES)[number];
export interface PanelLayoutRequest {
  panel: string;
  widthPct?: number;
  side?: PanelSide;
}
/** Panel content scroll (D-146, D-150): by a page up / down, to the start, to the end; names match the fork bridge. */
export const PANEL_SCROLLS = ["up", "down", "top", "bottom"] as const;
export type PanelScroll = (typeof PANEL_SCROLLS)[number];
/** Scroll target: direction, item by text or position in % (exactly one); missing `panel` = properties panel. */
export interface PanelScrollTarget {
  direction?: PanelScroll;
  item?: string;
  percent?: number;
  panel?: string;
}
/** Panel content zoom (D-150): step `in` / `out`, `reset` or a multiple within the viewer's range. */
export const PANEL_ZOOM_RANGE = { min: 0.5, max: 2.5 } as const;
export const PANEL_ZOOM_STEPS = ["in", "out", "reset"] as const;
export type PanelZoom = (typeof PANEL_ZOOM_STEPS)[number] | number;
export const PANEL_ITEM_MAX = 80;

export type ViewerOp =
  | { op: "colorize"; guids: string[]; color: string }
  | { op: "hide" | "show" | "isolate"; guids: string[] }
  | { op: "colorize_sel"; selector: OpsSelector; color: string }
  | { op: "hide_sel" | "show_sel" | "isolate_sel"; selector: OpsSelector }
  | { op: "select"; guid: string; /** All GUIDs of the selection when there are several (#217); `guid` is the first. */ guids?: string[]; panel?: SelectPanel }
  /** Selection of all currently visible elements (#315): bridge `SELECT {visible: true}`; an older viewer drops the message. */
  | { op: "select_visible" }
  | { op: "show_all" }
  /** Cancels only the isolation and X-ray from chat (bridge `APPLY_LENS unisolate`), section, hidden elements and colors stay (D-151). */
  | { op: "clear_isolation" }
  | { op: "reset_colors" }
  /** Cancels the orange highlight from show_in_3d, leaves other colors (D-101, #94). */
  | { op: "clear_focus" }
  | { op: "clear_selection" }
  | {
      op: "section";
      /** Missing only for `fit` along/across - the viewer picks the axis from the elements' bounds. */
      axis?: SectionAxis;
      storeyGuid?: string;
      offsetM?: number;
      position?: number;
      guids?: string[];
      fit?: SectionFit;
      coordinate?: number;
      flipped?: boolean;
      /** false = hide the section widget (quad and outline), the section stays (#63). */
      showGizmo?: boolean;
    }
  | { op: "section_clear" }
  /** Appearance of the section cap (D-120), `lib/viewer-section-cap.ts`. */
  | SectionCapOp
  | { op: "section_gizmo"; showGizmo: boolean }
  | ({ op: "camera"; preset: CameraPreset; projection?: Projection; guids: string[]; selector?: OpsSelector } & CameraMove)
  /** Exact pose (D-122): the fork transfers it to the camera as `SET_CAMERA {viewpoint}` (D-098). */
  | { op: "pose"; viewpoint: BridgeViewpoint; projection?: Projection }
  /** documentId = drawing of the storey chosen by the host (D-176); without it the viewer chooses itself. */
  | { op: "view"; mode: ViewMode; storeyGuid?: string; documentId?: string }
  /** layout split = card next to 3D, otherwise a tab over the whole area (D-132). */
  | { op: "doc"; documentId: string; page?: number; region?: DocRegion; highlights?: DocRegion[]; layout?: "split" }
  /** Viewer tabs and section box (D-132), `lib/viewer-tabs.ts`. */
  | TabsOp
  /** View from Presentation (D-161): activation and saving of the current state, `lib/viewer-views.ts`. */
  | ViewsOp
  | IdsOpenOp
  | ClashOpenOp
  | { op: "lens"; mode: LensMode; rev?: string; wire: LensWire }
  /** List from chat into the Lists panel (D-111), format in `lib/viewer-list.ts`. */
  | { op: "list"; wire: ListWire }
  /** Dimensions in the IFC world into the fork's Measure tool (D-124), format in `lib/viewer-measure.ts`; empty segments = delete the host's dimensions (D-152). */
  | { op: "measure"; segments: MeasureSegment[]; keep?: boolean }
  /** Route line in the IFC world (D-137), format in `lib/viewer-route.ts`; empty points = delete. */
  | { op: "route"; color: string; points: MeasurePoint[] }
  /** Opening / closing of panels (D-127). */
  | { op: "panels"; panels?: PanelsRequest; panelLayout?: PanelLayoutRequest }
  /** Panel content scroll (D-146, D-150). */
  | ({ op: "panel_scroll" } & PanelScrollTarget)
  /** Panel content zoom (D-150). */
  | { op: "panel_zoom"; zoom: PanelZoom; panel?: string }
  /** Continuous rotation of the camera around the target (D-154); speed and direction only with `start`. */
  | { op: "auto_rotate"; action: AutoRotateAction; speedDegS?: number; direction?: AutoRotateDirection }
  /** Show / hide PDF underlays on the 3D canvas (D-133 addendum), viewer state only. */
  | { op: "underlays3d"; show: boolean }
  /** Individual underlays in 3D: visibility, transparency, saving (D-168). */
  | UnderlaysSetOp
  /** Underlays from the DB into the viewer again (after a calibration restore), performed by the host client. */
  | UnderlaysLoadOp
  | { op: "planpos"; show: boolean };

const HEX6 = /^[0-9a-fA-F]{6}$/;
/** UUID of the document in `view:...~d=`. */
const DOC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
 * Page crop from `r=x_y_w_h` (D-117): percentages, clipped to the page; empty or
 * outside the page = no crop (the card opens whole).
 */
export function parseDocRegion(raw: string | undefined): DocRegion | undefined {
  if (!raw) return undefined;
  const parts = raw.split("_").map((v) => finite(v, -1000, 1000));
  if (parts.length !== 4 || parts.some((v) => v === undefined)) return undefined;
  return clampDocRegion({ x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! });
}

/** Crop from the tool parameter `region` ({x, y, width, height} in %, D-117); undefined = faulty or outside the page. */
export function docRegionInput(raw: unknown): DocRegion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = [r.x, r.y, r.width, r.height];
  if (!n.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  const [x, y, w, h] = n as number[];
  return clampDocRegion({ x, y, w, h });
}

/** Crop clipped to the page (0-100 %), at least 1 % per axis; undefined = entirely outside the page. */
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

/** At most this many frames at once (D-123), as in the fork. */
export const MAX_DOC_HIGHLIGHTS = 20;

/**
 * Frame around text (D-123): clipped to the page like a crop, but without the 1 % minimum,
 * because a text line is usually 0.4-1 % of the page high (at least 0.1 %).
 */
export function clampDocHighlight(r: DocRegion): DocRegion | undefined {
  const axis = (start: number, size: number): [number, number] | undefined => {
    const lo = Math.max(0, start);
    const hi = Math.min(100, start + size);
    if (!(hi - lo > 0)) return undefined;
    // A dimension inside the page stays exact (without the subtraction that adds rounding error).
    const len = Math.max(0.1, Math.min(start < 0 ? start + size : size, 100 - lo));
    return [Math.min(lo, 100 - len), len];
  };
  const x = axis(r.x, r.w);
  const y = axis(r.y, r.h);
  return x && y ? { x: x[0], y: y[0], w: x[1], h: y[1] } : undefined;
}

/** Frames from `h=x_y_w_h_x_y_w_h...` (D-123); invalid ones are omitted. */
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

/** Frames from the tool parameter `highlights` ([{x, y, width, height}] in %, D-123); invalid ones are omitted. */
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

/** Name of a pset/property into `ops`: the separators `: ; . ~` must not pass. */
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

/** `~t=ifc~s=quantities~p=<pset>~v=<property>` -> panel; nothing valid = undefined. */
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

/** Selection op (D-082) with an optional panel (D-113). */
export function selectOp(guid: string | readonly string[], panel?: SelectPanel): string {
  const kv = [
    panel?.tab ? `t=${panel.tab}` : "",
    panel?.section ? `s=${panel.section}` : "",
    panel?.focus ? `p=${encName(panel.focus.pset)}~v=${encName(panel.focus.property)}` : "",
  ].filter(Boolean);
  return `select:${kv.length ? `~${kv.join("~")}` : ""}:${typeof guid === "string" ? guid : guid.join(".")}`;
}

const vec = (n: number[], i: number) => ({ x: n[i], y: n[i + 1], z: n[i + 2] });

/** `px,py,pz,tx,ty,tz,ux,uy,uz~o=..~proj=..` -> pose; outside the fork bridge's range = null. */
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

/**
 * `~lens=close~bcf=open` -> panels; `all` only with `close`. Panel width and side (D-172) go in the same message
 * in keys with the prefix `+` (not valid panel names): `~+panel=properties~+w=40~+s=left`, so that the panel
 * is first opened and then set. Nothing valid = null.
 */
function parsePanels(arg: string): { panels?: PanelsRequest; panelLayout?: PanelLayoutRequest } | null {
  const [, kv] = parseArg(arg);
  const panels: PanelsRequest = {};
  for (const [k, v] of Object.entries(kv)) {
    if (!(PANEL_ACTIONS as readonly string[]).includes(v) || !PANEL_NAME.test(k)) continue;
    if (k !== "all" || v === "close") panels[k] = v as PanelAction;
  }
  let panelLayout: PanelLayoutRequest | undefined;
  if (kv["+panel"] !== undefined && PANEL_NAME.test(kv["+panel"])) {
    const widthPct = kv["+w"] !== undefined ? finite(kv["+w"], PANEL_WIDTH_PCT.min, PANEL_WIDTH_PCT.max) : undefined;
    const side = (PANEL_SIDES as readonly string[]).includes(kv["+s"]) ? (kv["+s"] as PanelSide) : undefined;
    if (widthPct !== undefined || side !== undefined) {
      panelLayout = { panel: kv["+panel"], ...(widthPct !== undefined ? { widthPct } : {}), ...(side ? { side } : {}) };
    }
  }
  if (Object.keys(panels).length === 0 && !panelLayout) return null;
  return { ...(Object.keys(panels).length > 0 ? { panels } : {}), ...(panelLayout ? { panelLayout } : {}) };
}

/** Op for rotating around (D-154): `auto_rotate:start~s=5~d=r:` or `auto_rotate:stop:`. */
export function autoRotateOp(action: AutoRotateAction, speedDegS?: number, direction?: AutoRotateDirection): string {
  const kv = action === "start" ? [...(speedDegS !== undefined ? [`s=${speedDegS}`] : []), ...(direction ? [`d=${direction === "left" ? "l" : "r"}`] : [])] : [];
  return `auto_rotate:${[action, ...kv].join("~")}:`;
}

/**
 * Panel scroll op (D-146, D-150): `panel_scroll:down:` (properties panel), or head `-` with parameters
 * `~p=<panel>~i=<text, encodeURIComponent and ~ as %7E>~pct=<0-100>`; direction, `i` and `pct` are mutually exclusive.
 */
export function panelScrollOp(target: PanelScroll | PanelScrollTarget): string {
  const t: PanelScrollTarget = typeof target === "string" ? { direction: target } : target;
  const kv = [
    ...(t.panel ? [`p=${t.panel}`] : []),
    ...(t.item !== undefined ? [`i=${encodeURIComponent(t.item).replace(/~/g, "%7E")}`] : []),
    ...(t.percent !== undefined ? [`pct=${t.percent}`] : []),
  ];
  return `panel_scroll:${[t.direction ?? "-", ...kv].join("~")}:`;
}

function parsePanelScroll(arg: string): PanelScrollTarget | null {
  const [head, kv] = parseArg(arg);
  const direction = (PANEL_SCROLLS as readonly string[]).includes(head) ? (head as PanelScroll) : undefined;
  let item: string | undefined;
  if (kv.i !== undefined) {
    try { item = decodeURIComponent(kv.i); } catch { return null; }
    if (item.trim().length === 0 || item.length > PANEL_ITEM_MAX) return null;
  }
  const percent = kv.pct !== undefined ? finite(kv.pct, 0, 100) : undefined;
  if (kv.pct !== undefined && percent === undefined) return null;
  if ([direction, item, percent].filter((v) => v !== undefined).length !== 1) return null;
  if (kv.p !== undefined && !PANEL_NAME.test(kv.p)) return null;
  if (direction === undefined && head !== "-") return null;
  return { ...(direction ? { direction } : {}), ...(item !== undefined ? { item } : {}), ...(percent !== undefined ? { percent } : {}), ...(kv.p ? { panel: kv.p } : {}) };
}

/** Panel zoom op (D-150): `panel_zoom:in~p=bcf:`, `panel_zoom:1.5:`. */
export function panelZoomOp(zoom: PanelZoom, panel?: string): string {
  return `panel_zoom:${zoom}${panel ? `~p=${panel}` : ""}:`;
}

function parsePanelZoom(arg: string): { zoom: PanelZoom; panel?: string } | null {
  const [head, kv] = parseArg(arg);
  const step = (PANEL_ZOOM_STEPS as readonly string[]).includes(head) ? (head as PanelZoom) : undefined;
  const zoom = step ?? finite(head, PANEL_ZOOM_RANGE.min, PANEL_ZOOM_RANGE.max);
  if (zoom === undefined || (kv.p !== undefined && !PANEL_NAME.test(kv.p))) return null;
  return { zoom, ...(kv.p ? { panel: kv.p } : {}) };
}

/** Underlays op in 3D (D-133 addendum): `underlays3d:0:` hides, `underlays3d:1:` shows. */
export function underlays3dOp(show: boolean): string {
  return `underlays3d:${show ? 1 : 0}:`;
}

/** Camera position on PDF op (D-161 point 8, #282): `planpos:0:` hides the dot and direction, `planpos:1:` shows. */
export function planPositionOp(show: boolean): string {
  return `planpos:${show ? 1 : 0}:`;
}

/** Panels op (D-127): `panels:~lens=close~...:`; with `layout` (D-172) also `~+panel=<name>~+w=<%>~+s=<side>`. */
export function panelsOp(panels: PanelsRequest | undefined, layout?: PanelLayoutRequest): string {
  const kv = [
    ...Object.entries(panels ?? {}).map(([k, v]) => `${k}=${v}`),
    ...(layout
      ? [`+panel=${layout.panel}`, ...(layout.widthPct !== undefined ? [`+w=${layout.widthPct}`] : []), ...(layout.side ? [`+s=${layout.side}`] : [])]
      : []),
  ];
  return `panels:~${kv.join("~")}:`;
}

/** Parses `ops`; unknown or faulty parts are silently dropped (input is from the URL). */
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
      // Selection as a click (D-082); several GUIDs = multi-select (#217), the panel belongs to the first.
      const panel = parsePanel(arg);
      const all = [...new Set(guids)];
      out.push({ op, guid: all[0], ...(all.length > 1 ? { guids: all } : {}), ...(panel ? { panel } : {}) });
    } else if (op === "select_visible" || op === "show_all" || op === "clear_isolation" || op === "reset_colors" || op === "section_clear" || op === "clear_focus" || op === "clear_selection") {
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
        // Section through elements: the GUIDs are targets, not a storey.
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
      // A section needs a storey (horizontal) or a position in percent.
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
      const [mode, kv] = parseArg(arg);
      if (!(VIEW_MODES as readonly string[]).includes(mode)) continue;
      const documentId = kv.d && DOC_ID.test(kv.d) ? kv.d : undefined;
      out.push({ op, mode: mode as ViewMode, ...(guids[0] ? { storeyGuid: guids[0] } : {}), ...(documentId ? { documentId } : {}) });
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
      // An empty body = delete the host's dimensions (D-152); `keep` without segments makes no sense.
      const segments = joined === "" ? (arg === "keep" ? null : []) : decodeMeasureWire(joined);
      if (segments) out.push({ op, segments, ...(arg === "keep" ? { keep: true } : {}) });
    } else if (op === "route") {
      const line = parseRouteOp(arg, joined);
      if (line) out.push({ op, ...line });
    } else if (op === "tab" || op === "section_box") {
      const t = parseTabsOp(op, arg, joined);
      if (t) out.push(t);
    } else if (op === "view_activate" || op === "view_capture") {
      const v = parseViewsOp(op, joined);
      if (v) out.push(v);
    } else if (op === "underlays_load") {
      out.push({ op });
    } else if (op === "underlays_set") {
      const u = parseUnderlaysSetOp(joined);
      if (u) out.push(u);
    } else if (op === "ids_open") {
      const ids = parseIdsOp(joined);
      if (ids) out.push(ids);
    } else if (op === "clash_open") {
      const clash = parseClashOp(joined);
      if (clash) out.push(clash);
    } else if (op === "panels") {
      const parsed = parsePanels(arg);
      if (parsed) out.push({ op, ...parsed });
    } else if (op === "auto_rotate") {
      const [action, kv] = parseArg(arg);
      if (!(AUTO_ROTATE_ACTIONS as readonly string[]).includes(action)) continue;
      const speed = kv.s !== undefined ? Number(kv.s) : undefined;
      const speedOk = speed !== undefined && Number.isFinite(speed) && speed >= AUTO_ROTATE_SPEED.min && speed <= AUTO_ROTATE_SPEED.max;
      const direction = kv.d === "l" ? "left" : kv.d === "r" ? "right" : undefined;
      out.push({
        op,
        action: action as AutoRotateAction,
        ...(action === "start" && speedOk ? { speedDegS: speed } : {}),
        ...(action === "start" && direction ? { direction } : {}),
      });
    } else if (op === "panel_scroll") {
      const target = parsePanelScroll(arg);
      if (target) out.push({ op, ...target });
    } else if (op === "panel_zoom") {
      const z = parsePanelZoom(arg);
      if (z) out.push({ op, ...z });
    } else if (op === "underlays3d" || op === "planpos") {
      if (arg === "0" || arg === "1") out.push({ op, show: arg === "1" });
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

/** Op -> bridge message of the viewer fork (`apps/viewer/src/aim/`, D-066/D-082/D-083). */
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
    case "select_visible":
      return { type: "SELECT", visible: true };
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
        // Relative steps do not belong here: the host makes a pose from them (applyCameraOp in ifc-viewer.tsx).
        ...(o.fit ? { fit: o.fit } : {}),
        // Margin and target part (D-128): the fork frames `frameBounds` with the margin; an older fork ignores them.
        ...(o.marginPercent !== undefined ? { padding: marginToPadding(o.marginPercent) } : {}),
        ...(o.area ? { area: o.area } : {}),
      };
    case "pose":
      return { type: "SET_CAMERA", preset: "keep", viewpoint: o.viewpoint, ...(o.projection ? { projection: o.projection } : {}) };
    case "view":
      return { type: "SET_VIEW_MODE", mode: o.mode, ...(o.storeyGuid ? { storeyGuid: o.storeyGuid } : {}), ...(o.documentId ? { documentId: o.documentId } : {}) };
    case "doc":
      return {
        type: "DOCUMENT_OPEN",
        documentId: o.documentId,
        ...(o.page ? { page: o.page } : {}),
        // The fork expects page fractions (0-1), the wire carries percentages.
        ...(o.region ? { region: toFraction(o.region) } : {}),
        // Frames (D-123): the fork draws them on page `page`; empty = cancels the old ones.
        ...(o.highlights?.length ? { highlights: o.highlights.map(toFraction) } : {}),
        ...(o.layout ? { layout: o.layout } : {}),
      };
    case "tab":
    case "section_box":
      return tabsBridgeMessage(o);
    case "view_activate":
    case "view_capture":
      return viewsBridgeMessage(o);
    case "underlays_load":
      // The host client fetches the underlays from /api/underlay only on execution (async), so the message is composed by `applyOps` in ifc-viewer.tsx.
      throw new Error("underlays_load sa vykoná v klientovi hosta (reloadUnderlays), nie cez opToBridgeMessage");
    case "clash_open":
      // The host client fetches the clashes from /api/clash only on execution (async), so the message is composed by `applyOps` in ifc-viewer.tsx.
      throw new Error("clash_open sa vykoná v klientovi hosta (openClash), nie cez opToBridgeMessage");
    case "ids_open":
      // The host client fetches the XML from /api/ids only on execution (async), so the message is composed by `applyOps` in ifc-viewer.tsx.
      throw new Error("ids_open sa vykoná v klientovi hosta (openIds), nie cez opToBridgeMessage");
    case "lens":
      // The zone (`aim_zone`) and document (`aim_document`) are filled in by the client before sending; they stay empty here.
      return lensBridgeMessage(o.mode, o.wire, new Map(), o.rev);
    case "list":
      // The zone is filled in by the client before sending, as with Lens.
      return listBridgeMessage(o.wire, new Map());
    case "measure":
      return { type: "MEASURE_SHOW", segments: o.segments, ...(o.keep ? { keep: true } : {}) };
    case "route":
      return { type: "ROUTE_SHOW", points: o.points, color: o.color };
    case "panels":
      return {
        type: "SET_PANELS",
        ...(o.panels ? { panels: o.panels } : {}),
        ...(o.panelLayout
          ? {
              panel_layout: {
                panel: o.panelLayout.panel,
                ...(o.panelLayout.widthPct !== undefined ? { width_pct: o.panelLayout.widthPct } : {}),
                ...(o.panelLayout.side ? { side: o.panelLayout.side } : {}),
              },
            }
          : {}),
      };
    case "panel_scroll":
      return {
        type: "SCROLL_PANEL",
        ...(o.direction ? { direction: o.direction } : {}),
        ...(o.item !== undefined ? { item: o.item } : {}),
        ...(o.percent !== undefined ? { percent: o.percent } : {}),
        ...(o.panel ? { panel: o.panel } : {}),
      };
    case "panel_zoom":
      return { type: "ZOOM_PANEL", zoom: o.zoom, ...(o.panel ? { panel: o.panel } : {}) };
    case "auto_rotate":
      return {
        type: "AUTO_ROTATE",
        action: o.action,
        ...(o.speedDegS !== undefined ? { speedDegS: o.speedDegS } : {}),
        ...(o.direction ? { direction: o.direction } : {}),
      };
    case "underlays3d":
      return { type: "SET_UNDERLAYS_3D", show: o.show };
    case "underlays_set":
      return underlaysSetBridgeMessage(o);
    case "planpos":
      return { type: "SET_PLAN_POSITION", show: o.show };
  }
}

// ── Builders (server) ────────────────────────────────────────────────────────

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

/** Only the widget of the active section (#63): `section_gizmo:<0|1>:`. */
export const sectionGizmoOp = (show: boolean) => `section_gizmo:${show ? 1 : 0}:`;

function cameraArg(preset: CameraPreset, projection?: Projection, move: CameraMove = {}): string {
  const proj = projection ? [`proj=${projection === "orthographic" ? "o" : "p"}`] : [];
  return [preset, ...proj, ...cameraMoveArgs(move)].join("~");
}

export function cameraOp(preset: CameraPreset, guids: string[] = [], projection?: Projection, move?: CameraMove): string {
  return `camera:${cameraArg(preset, projection, move)}:${guids.join(".")}`;
}

/** Camera on a set of elements by selector (D-094) - expanded by the viewer as `*_sel`. */
export function cameraSelOp(preset: CameraPreset, selector: OpsSelector, projection?: Projection, move?: CameraMove): string {
  const fields = [
    ...(selector.types?.length ? [`t=${selector.types.join(".")}`] : []),
    ...(selector.model ? [`m=${selector.model}`] : []),
  ];
  return `camera_sel:${cameraArg(preset, projection, move)}:${fields.join("~")}`;
}

/** Exact camera pose (D-122), e.g. from a saved view. */
export function poseOp(vp: BridgeViewpoint, projection?: Projection): string {
  const nums = [vp.position, vp.target, vp.up].flatMap((v) => [v.x, v.y, v.z]);
  const kv = [
    ...(vp.orthoSize !== undefined ? [`o=${vp.orthoSize}`] : []),
    ...(projection ? [`proj=${projection === "orthographic" ? "o" : "p"}`] : []),
  ];
  return `pose:${[nums.join(","), ...kv].join("~")}:`;
}

export function viewModeOp(mode: ViewMode, storeyGuid?: string, documentId?: string): string {
  return `view:${mode}${documentId && DOC_ID.test(documentId) ? `~d=${documentId}` : ""}:${storeyGuid ?? ""}`;
}

export function docOp(documentId: string, page?: number, region?: DocRegion, highlights?: DocRegion[], layout?: "split"): string {
  const r = region ? `~r=${pctList(region)}` : "";
  const h = highlights?.length ? `~h=${highlights.map(pctList).join("_")}` : "";
  const l = layout === "split" ? "~l=s" : "";
  return `doc:${page ?? ""}${r}${h}${l}:${documentId}`;
}
