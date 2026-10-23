/**
 * Pohľady z panela Presentation (D-161, #188): wire formát správ `VIEWS_LOAD`, `VIEW_SAVE`, `VIEW_RENAME`,
 * `VIEW_DELETE`, `VIEW_ACTIVATE`, `VIEW_CAPTURE` (zrkadlo `apps/viewer/src/aim/views-protocol.ts` vo forku) a
 * viewer ops `view_activate` a `view_capture`, ktorými ich vydáva chat.
 *
 * Nositeľom pohľadu je `BasketView` upstreamu, trvalou kópiou riadok `saved_views` s tým istým `id`; do
 * `viewpoint` jsonb sa ukladá celý `ViewWire` (bez migrácie). Súradnice sú v IFC svete (m, Z hore),
 * košík ako IFC GlobalId, náhľady sa nenosia (D-135).
 *
 * Ops: `view_activate::<base64url JSON {id?, name?}>`, `view_capture::<base64url JSON {name?, capture_id?}>`.
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";

export const VIEWS_SOURCE = "aim-bridge" as const;
export const MAX_VIEWS = 500;
/** Strop zoznamu GUID v jednom pohľade; väčší košík ide ako `truncated`. */
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
  /** Os hosta: x = IFC X, y = IFC Z (výška), z = IFC Y. */
  axis: "x" | "y" | "z";
  position_percent: number;
  /** IFC m; presnejšia než percento a prežije novú revíziu modelu. */
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
  /** Index aktívnej roviny v `planes`. */
  active: number;
}

/** `all` = všetko viditeľné okrem `hidden_guids`; `guids` = zoznam (najviac 5000). */
export type ViewBasketWire =
  | { scope: "all"; hidden_guids: string[] }
  | { scope: "guids"; guids: string[]; truncated?: boolean };

export interface ViewWire {
  /** = `saved_views.id` = `BasketView.id` (UUID). */
  id: string;
  name: string;
  /** Poradie v páse Presentation (0 = prvý). */
  order: number;
  transition_ms: number | null;
  source: ViewSource;
  camera: ViewCameraWire | null;
  section: ViewSectionWire | null;
  basket: ViewBasketWire;
  /** Počet prvkov košíka pri uložení (informatívne). */
  objects: number;
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

/** Tvar pohľadu na drôte (rovnaká kontrola ako vo forku; neplatný riadok zahodí celú správu). */
export function isViewWire(v: unknown): v is ViewWire {
  if (!isObj(v)) return false;
  return (
    isText(v.id) && isText(v.name) && Number.isInteger(v.order) && (v.transition_ms === null || isNum(v.transition_ms)) &&
    (v.source === "selection" || v.source === "visible" || v.source === "hierarchy" || v.source === "manual") &&
    (v.camera === null || isCamera(v.camera)) && (v.section === null || isSection(v.section)) &&
    isBasket(v.basket) && isNum(v.objects)
  );
}

/** Správy viewera -> host (post na parent). */
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

/** `view_activate` / `view_capture` z wire formátu; null = neplatné (op sa preskočí). */
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

/** Op -> bridge správa forku (`VIEW_ACTIVATE`, `VIEW_CAPTURE`). */
export function viewsBridgeMessage(o: ViewsOp): Record<string, unknown> {
  return o.op === "view_activate"
    ? { type: "VIEW_ACTIVATE", ...(o.id ? { id: o.id } : {}), ...(o.name ? { name: o.name } : {}) }
    : { type: "VIEW_CAPTURE", ...(o.name ? { name: o.name } : {}), ...(o.capture_id ? { capture_id: o.capture_id } : {}) };
}

/** Správa hosta `VIEWS_LOAD` (úplný zoznam z DB). */
export function viewsLoadMessage(views: ViewWire[]): { source: typeof VIEWS_SOURCE; type: "VIEWS_LOAD"; views: ViewWire[] } {
  return { source: VIEWS_SOURCE, type: "VIEWS_LOAD", views: views.slice(0, MAX_VIEWS) };
}
