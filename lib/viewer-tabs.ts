/**
 * Záložky viewera a rezný box (D-132, #165): viewer op `tab` a `section_box`.
 *
 * `tab:<action>:<base64url JSON>` = `VIEW_TABS` forku. JSON nesie odkaz na záložku
 * (`tab`), otvorenie (`open`: pôdorys podlažia alebo uložený pohľad) a `beside`.
 * Menovky a mená pohľadov môžu mať `:` aj `;`, preto sú v base64url ako Lens (D-096).
 * `section_box:<m>:<guid.guid...>` = box okolo prvkov s okrajom `m` metrov,
 * `section_box:<minx,miny,minz,maxx,maxy,maxz>:` = presná obálka v IFC svete (obnova D-122).
 */

import { fromBase64Url, toBase64Url } from "./viewer-lens";

export const TAB_ACTIONS = ["open", "activate", "beside", "unbeside", "close"] as const;
export type TabAction = (typeof TAB_ACTIONS)[number];

export interface TabOpen {
  kind: "plan" | "view";
  storeyGuid?: string;
  viewId?: string;
  label?: string;
  locked?: boolean;
}

export interface TabsWire {
  tab?: string;
  open?: TabOpen;
  beside?: boolean;
}

export interface Vec3 { x: number; y: number; z: number }
export interface Box3 { min: Vec3; max: Vec3 }

export type TabsOp =
  | { op: "tab"; action: TabAction; wire: TabsWire }
  | { op: "section_box"; guids?: string[]; marginM?: number; box?: Box3 };

/** Okraj boxu okolo prvkov (m) - rovnaký rozsah ako most forku. */
export const BOX_MARGIN_RANGE = { min: 0, max: 20 } as const;
const MAX_BOX_GUIDS = 100;
const LIMIT = 1e7;
const MAX_TEXT = 200;

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXT ? v : undefined);

export function tabOp(action: TabAction, wire: TabsWire = {}): string {
  return `tab:${action}:${toBase64Url(JSON.stringify(wire))}`;
}

function decodeWire(action: TabAction, joined: string): TabsWire | null {
  const raw = joined ? fromBase64Url(joined) : "{}";
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const wire: TabsWire = {};
  if (r.beside === true) wire.beside = true;
  if (action === "open") {
    const o = r.open as Record<string, unknown> | undefined;
    if (!o || typeof o !== "object") return null;
    if (o.kind === "plan" && text(o.storeyGuid)) wire.open = { kind: "plan", storeyGuid: text(o.storeyGuid) };
    else if (o.kind === "view" && text(o.viewId) && text(o.label)) {
      wire.open = { kind: "view", viewId: text(o.viewId), label: text(o.label), ...(o.locked === true ? { locked: true } : {}) };
    } else return null;
    return wire;
  }
  if (action === "unbeside") return {};
  const tab = text(r.tab);
  if (!tab) return null;
  return { tab };
}

function finite(v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** `tab` / `section_box` z wire formátu; null = neplatné (op sa preskočí). */
export function parseTabsOp(op: string, arg: string, joined: string): TabsOp | null {
  if (op === "tab") {
    if (!(TAB_ACTIONS as readonly string[]).includes(arg)) return null;
    const wire = decodeWire(arg as TabAction, joined);
    return wire ? { op: "tab", action: arg as TabAction, wire } : null;
  }
  if (op === "section_box") {
    const guids = joined.split(".").filter(Boolean);
    if (guids.length > 0) {
      if (guids.length > MAX_BOX_GUIDS) return null;
      const marginM = finite(arg, BOX_MARGIN_RANGE.min, BOX_MARGIN_RANGE.max);
      return { op, guids, ...(marginM !== undefined ? { marginM } : {}) };
    }
    const n = arg.split(",").map((s) => finite(s, -LIMIT, LIMIT));
    if (n.length !== 6 || n.some((x) => x === undefined)) return null;
    const [x0, y0, z0, x1, y1, z1] = n as number[];
    if (!(x0 < x1 && y0 < y1 && z0 < z1)) return null;
    return { op, box: { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } } };
  }
  return null;
}

export function sectionBoxAroundOp(guids: string[], marginM?: number): string {
  return `section_box:${marginM ?? ""}:${guids.join(".")}`;
}

export function sectionBoxOp(box: Box3): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `section_box:${[box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].map(r).join(",")}:`;
}

/** Op -> bridge správa forku (`apps/viewer/src/aim/tabs-protocol.ts`, `sectionBox.ts`). */
export function tabsBridgeMessage(o: TabsOp): Record<string, unknown> {
  if (o.op === "tab") return { type: "VIEW_TABS", action: o.action, ...o.wire };
  return o.box
    ? { type: "SET_SECTION_BOX", box: o.box }
    : { type: "SET_SECTION_BOX", guids: o.guids, ...(o.marginM !== undefined ? { marginM: o.marginM } : {}) };
}
