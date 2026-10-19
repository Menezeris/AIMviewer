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
 * `~fit=..~z=..~oh=..~ov=..~px=..~py=..` a `camera_sel:<arg>:<selektor>`, D-094/D-098, `lib/viewer-camera.ts`),
 * `view:<3d|2d|split>:<storeyGuid>`, `doc:<page>:<documentId>`.
 * Lens z chatu (D-096): `lens:<mode>[~r=<rev>]:<base64url JSON>`, formát v `lib/viewer-lens.ts`.
 */

import { LENS_MODES, decodeLensWire, lensBridgeMessage, type LensMode, type LensWire } from "./viewer-lens";
import { cameraMoveArgs, parseCameraMove, type CameraMove } from "./viewer-camera";

export interface OpsSelector {
  types?: string[];
  model?: string;
}

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

/** Panel vlastností po výbere (D-113): záložka AIM | IFC, sekcia, zvýraznená vlastnosť. */
export const PANEL_TABS = ["aim", "ifc"] as const;
export const PANEL_SECTIONS = ["properties", "quantities"] as const;
export interface SelectPanel {
  tab?: (typeof PANEL_TABS)[number];
  section?: (typeof PANEL_SECTIONS)[number];
  focus?: { pset: string; property: string };
}

export type ViewerOp =
  | { op: "colorize"; guids: string[]; color: string }
  | { op: "hide" | "show" | "isolate"; guids: string[] }
  | { op: "colorize_sel"; selector: OpsSelector; color: string }
  | { op: "hide_sel" | "show_sel" | "isolate_sel"; selector: OpsSelector }
  | { op: "select"; guid: string; panel?: SelectPanel }
  | { op: "show_all" }
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
  | { op: "section_gizmo"; showGizmo: boolean }
  | ({ op: "camera"; preset: CameraPreset; projection?: Projection; guids: string[]; selector?: OpsSelector } & CameraMove)
  | { op: "view"; mode: ViewMode; storeyGuid?: string }
  | { op: "doc"; documentId: string; page?: number }
  | { op: "lens"; mode: LensMode; rev?: string; wire: LensWire };

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
export function selectOp(guid: string, panel?: SelectPanel): string {
  const kv = [
    panel?.tab ? `t=${panel.tab}` : "",
    panel?.section ? `s=${panel.section}` : "",
    panel?.focus ? `p=${encName(panel.focus.pset)}~v=${encName(panel.focus.property)}` : "",
  ].filter(Boolean);
  return `select:${kv.length ? `~${kv.join("~")}` : ""}:${guid}`;
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
      // Výber je jeden prvok (D-082) - prípadné ďalšie GUIDy sa ignorujú.
      const panel = parsePanel(arg);
      out.push({ op, guid: guids[0], ...(panel ? { panel } : {}) });
    } else if (op === "show_all" || op === "reset_colors" || op === "section_clear" || op === "clear_focus" || op === "clear_selection") {
      out.push({ op });
    } else if (op === "section_gizmo" && (arg === "0" || arg === "1")) {
      out.push({ op, showGizmo: arg === "1" });
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
    } else if (op === "doc") {
      const documentId = joined;
      if (!UUID.test(documentId)) continue;
      const page = finite(arg, 1, 100_000);
      out.push({ op, documentId, ...(page !== undefined ? { page: Math.floor(page) } : {}) });
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
      return { type: "SELECT", guid: o.guid, ...(o.panel ? { panel: o.panel } : {}) };
    case "show_all":
      return { type: "SHOW_ALL" };
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
    case "camera":
      return {
        type: "SET_CAMERA",
        preset: o.preset,
        ...(o.projection ? { projection: o.projection } : {}),
        ...(o.guids.length > 0 ? { guids: o.guids } : {}),
        ...(o.selector ? { selector: o.selector } : {}),
        // Relatívne kroky sem nepatria: host z nich spraví pózu (applyCameraOp v ifc-viewer.tsx).
        ...(o.fit ? { fit: o.fit } : {}),
      };
    case "view":
      return { type: "SET_VIEW_MODE", mode: o.mode, ...(o.storeyGuid ? { storeyGuid: o.storeyGuid } : {}) };
    case "doc":
      return { type: "DOCUMENT_OPEN", documentId: o.documentId, ...(o.page ? { page: o.page } : {}) };
    case "lens":
      // Zónu (`aim_zone`) doplní klient pred odoslaním; tu ostane prázdna.
      return lensBridgeMessage(o.mode, o.wire, new Map(), o.rev);
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

export function viewModeOp(mode: ViewMode, storeyGuid?: string): string {
  return `view:${mode}:${storeyGuid ?? ""}`;
}

export function docOp(documentId: string, page?: number): string {
  return `doc:${page ?? ""}:${documentId}`;
}
