import { createHash } from "node:crypto";

/**
 * Markup shapes on a topic reference (D-158 step 7, #199): `model_task_documents.markup` is an array of
 * `{type, points[], text?}` in % of the page (top left, 2 decimal places), like `region`.
 * The data comes from the viewer (untrusted), so every shape is verified and clamped; an invalid shape
 * is dropped, not the whole topic. The pure part: verification, the hash into the cache key and the drawing geometry
 * (canvas rendering is in `snapshot-render.ts`, shapes the same as `docMarkupSvg.ts` in the fork).
 */

export type MarkupType = "cloud" | "arrow" | "text" | "pin";

export interface MarkupPoint {
  x: number;
  y: number;
}

export interface Markup {
  type: MarkupType;
  points: MarkupPoint[];
  text?: string;
}

/** Maximum markups per reference and characters of the markup text. */
export const MAX_MARKUP = 20;
export const MAX_MARKUP_TEXT = 200;
/** Cap on JSON in the snapshot `markup` parameter (URL-encoded, without encoding). */
export const MAX_MARKUP_JSON = 8 * 1024;

const POINTS: Record<MarkupType, number> = { cloud: 2, arrow: 2, text: 1, pin: 1 };

const coord = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return +Math.min(100, Math.max(0, v)).toFixed(2);
};

const cleanText = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim().slice(0, MAX_MARKUP_TEXT).trim();
  return s || undefined;
};

/** One shape -> a verified shape, or null (bad type, point count, coordinate, missing text of a text). */
export function parseMarkupShape(raw: unknown): Markup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type !== "cloud" && type !== "arrow" && type !== "text" && type !== "pin") return null;
  if (!Array.isArray(r.points) || r.points.length !== POINTS[type]) return null;
  const points: MarkupPoint[] = [];
  for (const p of r.points) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const x = coord(o.x);
    const y = coord(o.y);
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  const text = cleanText(r.text);
  if (type === "text") return text ? { type, points, text } : null;
  if (type === "pin") return text ? { type, points, text } : { type, points };
  return { type, points };
}

/** Array of markups -> verified (at most `MAX_MARKUP`, invalid omitted); not an array or nothing valid = []. */
export function parseMarkup(raw: unknown): Markup[] {
  if (!Array.isArray(raw)) return [];
  const out: Markup[] = [];
  for (const item of raw) {
    const m = parseMarkupShape(item);
    if (m) out.push(m);
    if (out.length >= MAX_MARKUP) break;
  }
  return out;
}

/**
 * The snapshot `markup` parameter: URL-decoded JSON up to 8 kB. Invalid JSON or too long = an exception
 * (a request error), a valid array is verified as on save.
 */
export function parseMarkupParam(raw: string | null | undefined): Markup[] {
  if (!raw) return [];
  if (raw.length > MAX_MARKUP_JSON) throw new MarkupParamError(`markup: JSON je dlhší ako ${MAX_MARKUP_JSON / 1024} kB.`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new MarkupParamError("markup: očakáva sa JSON pole značiek [{type, points, text?}].");
  }
  return parseMarkup(json);
}

export class MarkupParamError extends Error {}

/** Stored value (jsonb) or null -> verified markups (a damaged column does not fail the read). */
export const storedMarkup = (raw: unknown): Markup[] => parseMarkup(raw);

/** Shortened hash of markups for the snapshot cache key; empty markups = null (the key stays as before). */
export function markupHash(markup: readonly Markup[] | null | undefined): string | null {
  if (!markup || markup.length === 0) return null;
  const canon = JSON.stringify(markup.map((m) => [m.type, m.points.map((p) => [p.x, p.y]), m.text ?? null]));
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------------------------
// Drawing geometry. Coordinates are in units where page width = 1000 (as in the fork).
// ---------------------------------------------------------------------------------------------

export const MARKUP_COLOR = "#dc2626";
export const LINE_WIDTH = 3;
export const ARROW_HEAD = 22;
export const TEXT_SIZE = 22;
export const PIN_TEXT_SIZE = 18;
export const PIN_RADIUS = 12;
export const PIN_LIFT = 24;
export const PIN_DOT = 4;
export const PIN_OUTLINE = 2;

export interface Arc {
  cx: number;
  cy: number;
  r: number;
  /** Semicircle drawn from `a0` to `a1` (increasing angle, clockwise on a canvas with y down). */
  a0: number;
  a1: number;
}

/**
 * Cloud: the outline of a rectangle from semicircular arcs pointing outward. The arc radius `s` = a quarter of the
 * shorter side in the range 6 to 18; an edge of length L gets n = round(L / (2s)) arcs
 * (at least 1) with radius L / n / 2. Edges go clockwise: top, right, bottom, left.
 */
export function cloudArcs(x0: number, y0: number, x1: number, y1: number): Arc[] {
  const l = Math.min(x0, x1);
  const t = Math.min(y0, y1);
  const rr = Math.max(x0, x1);
  const b = Math.max(y0, y1);
  const w = rr - l;
  const h = b - t;
  const s = Math.min(18, Math.max(6, Math.min(w, h) / 4));
  const corners: [number, number][] = [
    [l, t],
    [rr, t],
    [rr, b],
    [l, b],
  ];
  const arcs: Arc[] = [];
  for (let i = 0; i < 4; i++) {
    const [px, py] = corners[i];
    const [qx, qy] = corners[(i + 1) % 4];
    const len = Math.hypot(qx - px, qy - py);
    if (len <= 0) continue;
    const n = Math.max(1, Math.round(len / (2 * s)));
    const r = len / n / 2;
    const dx = (qx - px) / len;
    const dy = (qy - py) / len;
    const theta = Math.atan2(dy, dx);
    for (let k = 0; k < n; k++) {
      const c = (k + 0.5) * 2 * r;
      arcs.push({ cx: px + dx * c, cy: py + dy * c, r, a0: theta + Math.PI, a1: theta + 2 * Math.PI });
    }
  }
  return arcs;
}

/** Arrow head: a triangle ARROW_HEAD x ARROW_HEAD with the tip at `tip`, the base toward the tail. */
export function arrowHead(tail: MarkupPoint, tip: MarkupPoint): [MarkupPoint, MarkupPoint, MarkupPoint] | null {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * ARROW_HEAD;
  const by = tip.y - uy * ARROW_HEAD;
  const half = ARROW_HEAD / 2;
  return [tip, { x: bx - uy * half, y: by + ux * half }, { x: bx + uy * half, y: by - ux * half }];
}

/** Pin drop: the tip at `tip`, a circle r=12 centered 24 above the tip; tangents lie at an angle of 60 degrees from the axis. */
export function pinGeometry(tip: MarkupPoint) {
  const cx = tip.x;
  const cy = tip.y - PIN_LIFT;
  const a = Math.acos(PIN_RADIUS / PIN_LIFT);
  const start = Math.PI / 2 - a;
  const end = Math.PI / 2 + a;
  return {
    centre: { x: cx, y: cy },
    tip,
    from: { x: cx + PIN_RADIUS * Math.cos(start), y: cy + PIN_RADIUS * Math.sin(start) },
    a0: start,
    a1: end,
  };
}

/** Markup in % of the page -> drawing units (width 1000, height by aspect ratio). */
export function toUnits(p: MarkupPoint, pageSize: [number, number]): MarkupPoint {
  const w = 1000;
  const h = (1000 * pageSize[1]) / pageSize[0];
  return { x: (p.x / 100) * w, y: (p.y / 100) * h };
}
