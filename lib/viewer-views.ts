/**
 * Views from the Presentation panel (D-161, #188): wire format of messages `VIEWS_LOAD`, `VIEW_SAVE`, `VIEW_RENAME`,
 * `VIEW_DELETE`, `VIEW_ACTIVATE`, `VIEW_CAPTURE` (mirror of `apps/viewer/src/aim/views-protocol.ts` in the fork) and
 * the viewer ops `view_activate` and `view_capture`, by which the chat issues them.
 *
 * The carrier of a view is upstream's `BasketView`, the permanent copy is a `saved_views` row with the same `id`; into
 * the `viewpoint` jsonb the whole `ViewWire` is stored (no migration). Coordinates are in the IFC world (m, Z up),
 * the basket as IFC GlobalIds, thumbnails are not carried (D-135).
 *
 * Ops: `view_activate::<base64url JSON {id?, name?}>`, `view_capture::<base64url JSON {name?, capture_id?}>`.
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";
import { isViewUnderlays, type ViewUnderlaysWire } from "./viewer-underlays";

export const VIEWS_SOURCE = "aim-bridge" as const;
export const MAX_VIEWS = 500;
/** Cap on the GUID list in one view; a larger basket goes as `truncated`. */
export const MAX_BASKET_GUIDS = 5000;
const MAX_TEXT = 200;

export type Vec3Wire = [number, number, number];
export type ViewSource = "selection" | "visible" | "hierarchy" | "manual";

export interface ViewCameraWire {
  position: Vec3Wire;
  target: Vec3Wire;
  up: Vec3Wire;
  fov: number;
  projection: "perspective" | "orthographic";
  ortho_size?: number;
}

export interface ViewSectionPlaneWire {
  name: string;
  /** Host axes: x = IFC X, y = IFC Z (height), z = IFC Y. */
  axis: "x" | "y" | "z";
  position_percent: number;
  /** IFC m; more precise than a percentage and survives a new model revision. */
  coordinate?: number;
  flipped: boolean;
  enabled: boolean;
  show_gizmo: boolean;
  show_cap: boolean;
  show_outlines: boolean;
  box?: { min: Vec3Wire; max: Vec3Wire };
}

export interface ViewSectionWire {
  planes: ViewSectionPlaneWire[];
  /** Index of the active plane in `planes`. */
  active: number;
}

/** `all` = everything visible except `hidden_guids`; `guids` = list (at most 5000). */
export type ViewBasketWire =
  | { scope: "all"; hidden_guids: string[] }
  | { scope: "guids"; guids: string[]; truncated?: boolean };

export interface ViewWire {
  /** = `saved_views.id` = `BasketView.id` (UUID). */
  id: string;
  name: string;
  /** Order in the Presentation strip (0 = first). */
  order: number;
  transition_ms: number | null;
  source: ViewSource;
  camera: ViewCameraWire | null;
  section: ViewSectionWire | null;
  basket: ViewBasketWire;
  /** Number of basket elements at save time (informative). */
  objects: number;
  /**
   * State of PDF underlays in 3D (D-168, #325): the viewer captures it on save and restores it on activation. Missing in views
   * saved by an old viewer; a view without it does not change the underlay state.
   */
  underlays?: ViewUnderlaysWire;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const isBool = (v: unknown) => typeof v === "boolean";
const isVec = (v: unknown): v is Vec3Wire => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isStrings = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64);

function isCamera(v: unknown): boolean {
  if (!isObj(v)) return false;
  return (
    isVec(v.position) && isVec(v.target) && isVec(v.up) && isNum(v.fov) &&
    (v.projection === "perspective" || v.projection === "orthographic") && optional(v.ortho_size, isNum)
  );
}

function isPlane(v: unknown): boolean {
  if (!isObj(v)) return false;
  const box = v.box;
  return (
    typeof v.name === "string" && v.name.length <= MAX_TEXT && (v.axis === "x" || v.axis === "y" || v.axis === "z") &&
    isNum(v.position_percent) && optional(v.coordinate, isNum) &&
    isBool(v.flipped) && isBool(v.enabled) && isBool(v.show_gizmo) && isBool(v.show_cap) && isBool(v.show_outlines) &&
    (box === undefined || (isObj(box) && isVec(box.min) && isVec(box.max)))
  );
}

function isSection(v: unknown): boolean {
  if (!isObj(v)) return false;
  return (
    Array.isArray(v.planes) && v.planes.length >= 1 && v.planes.length <= 16 && v.planes.every(isPlane) &&
    Number.isInteger(v.active) && (v.active as number) >= 0 && (v.active as number) < v.planes.length
  );
}

function isBasket(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.scope === "all") return isStrings(v.hidden_guids, MAX_BASKET_GUIDS);
  return v.scope === "guids" && isStrings(v.guids, MAX_BASKET_GUIDS) && optional(v.truncated, isBool);
}

/** Shape of a view on the wire (same check as in the fork; an invalid row drops the whole message). */
export function isViewWire(v: unknown): v is ViewWire {
  if (!isObj(v)) return false;
  return (
    isText(v.id) && isText(v.name) && Number.isInteger(v.order) && (v.transition_ms === null || isNum(v.transition_ms)) &&
    (v.source === "selection" || v.source === "visible" || v.source === "hierarchy" || v.source === "manual") &&
    (v.camera === null || isCamera(v.camera)) && (v.section === null || isSection(v.section)) &&
    isBasket(v.basket) && isNum(v.objects) && optional(v.underlays, isViewUnderlays)
  );
}

/** Viewer messages -> host (post to parent). */
export type ViewsOutbound =
  | { type: "VIEW_SAVE"; view: unknown; capture_id?: unknown }
  | { type: "VIEW_RENAME"; id: unknown; name: unknown }
  | { type: "VIEW_DELETE"; id: unknown };

export const VIEWS_OUTBOUND_TYPES: ReadonlySet<string> = new Set(["VIEW_SAVE", "VIEW_RENAME", "VIEW_DELETE"]);

export type ViewsOp =
  | { op: "view_activate"; id?: string; name?: string }
  | { op: "view_capture"; name?: string; capture_id?: string };

const text = (v: unknown) => (isText(v) ? (v as string).trim() : undefined);

export function viewActivateOp(target: { id?: string; name?: string }): string {
  return `view_activate::${toBase64Url(JSON.stringify(target))}`;
}

export function viewCaptureOp(req: { name?: string; capture_id?: string } = {}): string {
  return `view_capture::${toBase64Url(JSON.stringify(req))}`;
}

/** `view_activate` / `view_capture` from the wire format; null = invalid (the op is skipped). */
export function parseViewsOp(op: string, joined: string): ViewsOp | null {
  const raw = joined ? fromBase64Url(joined) : "{}";
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (op === "view_activate") {
    const id = text(v.id);
    const name = text(v.name);
    return id || name ? { op, ...(id ? { id } : {}), ...(name ? { name } : {}) } : null;
  }
  const name = text(v.name);
  const captureId = text(v.capture_id);
  return { op: "view_capture", ...(name ? { name } : {}), ...(captureId ? { capture_id: captureId } : {}) };
}

/** Op -> bridge message of the fork (`VIEW_ACTIVATE`, `VIEW_CAPTURE`). */
export function viewsBridgeMessage(o: ViewsOp): Record<string, unknown> {
  return o.op === "view_activate"
    ? { type: "VIEW_ACTIVATE", ...(o.id ? { id: o.id } : {}), ...(o.name ? { name: o.name } : {}) }
    : { type: "VIEW_CAPTURE", ...(o.name ? { name: o.name } : {}), ...(o.capture_id ? { capture_id: o.capture_id } : {}) };
}

/** Host message `VIEWS_LOAD` (full list from the DB). */
export function viewsLoadMessage(views: ViewWire[]): { source: typeof VIEWS_SOURCE; type: "VIEWS_LOAD"; views: ViewWire[] } {
  return { source: VIEWS_SOURCE, type: "VIEWS_LOAD", views: views.slice(0, MAX_VIEWS) };
}
