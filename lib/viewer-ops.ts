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
 * Pohľad (D-083): `section:<y|x|z>[~h=<m>][~p=<pct>][~f=1]:<storeyGuid>`,
 * rez cez prvky (D-085) `section:<auto|y|x|z>~fit=<along|across|center>:<guid.guid...>`
 * a na súradnici IFC sveta `section:<y|x|z>~c=<m>::`,
 * `section_clear::`, `camera:<preset>[~proj=o|p]:<guid.guid...>`,
 * `view:<3d|2d|split>:<storeyGuid>`, `doc:<page>:<documentId>`.
 */

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
export const CAMERA_PRESETS = ["top", "bottom", "front", "back", "left", "right", "iso", "fit_all"] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];
export const VIEW_MODES = ["3d", "2d", "split"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export type Projection = "perspective" | "orthographic";

/** Výška rezu nad úrovňou podlažia (m) - rozsah, ktorý server aj klient prijmú. */
export const SECTION_OFFSET_RANGE = { min: -5, max: 20 } as const;

export type ViewerOp =
  | { op: "colorize"; guids: string[]; color: string }
  | { op: "hide" | "show" | "isolate"; guids: string[] }
  | { op: "colorize_sel"; selector: OpsSelector; color: string }
  | { op: "hide_sel" | "show_sel" | "isolate_sel"; selector: OpsSelector }
  | { op: "select"; guid: string }
  | { op: "show_all" }
  | { op: "reset_colors" }
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
    }
  | { op: "section_clear" }
  | { op: "camera"; preset: CameraPreset; projection?: Projection; guids: string[] }
  | { op: "view"; mode: ViewMode; storeyGuid?: string }
  | { op: "doc"; documentId: string; page?: number };

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
      out.push({ op, guid: guids[0] });
    } else if (op === "show_all" || op === "reset_colors" || op === "section_clear") {
      out.push({ op });
    } else if (op === "section") {
      const [axis, kv] = parseArg(arg);
      const flip = kv.f === "1" ? { flipped: true } : {};
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
        ...(kv.f === "1" ? { flipped: true } : {}),
      });
    } else if (op === "camera") {
      const [preset, kv] = parseArg(arg);
      if (!(CAMERA_PRESETS as readonly string[]).includes(preset)) continue;
      const projection = kv.proj === "o" ? "orthographic" : kv.proj === "p" ? "perspective" : undefined;
      out.push({ op, preset: preset as CameraPreset, guids, ...(projection ? { projection } : {}) });
    } else if (op === "view") {
      if (!(VIEW_MODES as readonly string[]).includes(arg)) continue;
      out.push({ op, mode: arg as ViewMode, ...(guids[0] ? { storeyGuid: guids[0] } : {}) });
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
      return { type: "SELECT", guid: o.guid };
    case "show_all":
      return { type: "SHOW_ALL" };
    case "reset_colors":
      return { type: "RESET_COLORS" };
    case "section": {
      const { op: _op, ...rest } = o;
      void _op;
      return { type: "SET_SECTION", action: "set", ...rest };
    }
    case "section_clear":
      return { type: "SET_SECTION", action: "clear" };
    case "camera":
      return {
        type: "SET_CAMERA",
        preset: o.preset,
        ...(o.projection ? { projection: o.projection } : {}),
        ...(o.guids.length > 0 ? { guids: o.guids } : {}),
      };
    case "view":
      return { type: "SET_VIEW_MODE", mode: o.mode, ...(o.storeyGuid ? { storeyGuid: o.storeyGuid } : {}) };
    case "doc":
      return { type: "DOCUMENT_OPEN", documentId: o.documentId, ...(o.page ? { page: o.page } : {}) };
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
  return `section:${[axis, ...kv].join("~")}:${tail}`;
}

export const SECTION_CLEAR_OP = "section_clear::";

export function cameraOp(preset: CameraPreset, guids: string[] = [], projection?: Projection): string {
  const arg = projection ? `${preset}~proj=${projection === "orthographic" ? "o" : "p"}` : preset;
  return `camera:${arg}:${guids.join(".")}`;
}

export function viewModeOp(mode: ViewMode, storeyGuid?: string): string {
  return `view:${mode}:${storeyGuid ?? ""}`;
}

export function docOp(documentId: string, page?: number): string {
  return `doc:${page ?? ""}:${documentId}`;
}
