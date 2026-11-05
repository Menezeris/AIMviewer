/**
 * Snapshot of a PDF page region for a BCF topic (D-158 step 3), the pure part: what is cropped, at what
 * scale, where the frame is and under what key the snapshot is cached. Rendering (pdf.js + canvas) is in
 * `snapshot-render.ts`, the PDF source and cache in `snapshot.ts`.
 *
 * Region coordinates are in % of the displayed page, origin top left (like `open_drawing region`
 * and the topic reference in `model_task_documents.region`).
 */

export interface PctRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longer side of the snapshot in px (BCF snapshot, #199: "long side up to 1500 px"). */
export const SNAPSHOT_LONG_SIDE = 1500;
/** Margin around the region: a share of its size on each side, so that the frame is in context. */
const CONTEXT = 0.25;
/** Smallest margin in % of the page (a small region would otherwise have no readable context). */
const MIN_CONTEXT_PCT = 2;
/** Scale cap (point -> px), so that a small region does not produce a blurry huge bitmap. */
const MAX_SCALE = 8;
export const FRAME_COLOR = "#dc2626";
export const FRAME_FILL = "rgba(220, 38, 38, 0.08)";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Region clamped to the page; empty (outside the page) = null. */
export function clampRect(r: PctRect): PctRect | null {
  const x0 = clamp(r.x, 0, 100);
  const y0 = clamp(r.y, 0, 100);
  const x1 = clamp(r.x + r.width, 0, 100);
  const y1 = clamp(r.y + r.height, 0, 100);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface SnapshotPlan {
  /** Page crop in % (region with margin, or the whole page). */
  crop: PctRect;
  /** Mierka body strany -> px. */
  scale: number;
  /** Rozmer bitmapy. */
  width: number;
  height: number;
  /** Region frame in bitmap px; null = the whole page without a frame. */
  frame: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Crop and scale: the region with margin (or the whole page) so that the longer side of the snapshot has
 * `SNAPSHOT_LONG_SIDE` px; `pageSize` = [width, height] of the displayed page in points.
 */
export function snapshotPlan(pageSize: [number, number], region: PctRect | null): SnapshotPlan {
  const [pw, ph] = pageSize;
  const r = region ? clampRect(region) : null;
  let crop: PctRect = { x: 0, y: 0, width: 100, height: 100 };
  if (r) {
    const mx = Math.max(r.width * CONTEXT, MIN_CONTEXT_PCT);
    const my = Math.max(r.height * CONTEXT, MIN_CONTEXT_PCT);
    crop = clampRect({ x: r.x - mx, y: r.y - my, width: r.width + 2 * mx, height: r.height + 2 * my }) ?? crop;
  }
  const cw = (crop.width / 100) * pw;
  const ch = (crop.height / 100) * ph;
  const scale = Math.min(MAX_SCALE, SNAPSHOT_LONG_SIDE / Math.max(cw, ch));
  const width = Math.max(1, Math.round(cw * scale));
  const height = Math.max(1, Math.round(ch * scale));
  const px = (pct: number, size: number) => (pct / 100) * size * scale;
  const frame = r
    ? {
        x: px(r.x - crop.x, pw),
        y: px(r.y - crop.y, ph),
        width: px(r.width, pw),
        height: px(r.height, ph),
      }
    : null;
  return { crop, scale, width, height, frame };
}

const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * Cache key in the `documents` bucket: `snapshots/<sha256>/<page>-<x_y_w_h|full>.png`; with markups
 * (D-158 step 7) `<page>-<region>-m<markup hash>.png`, unchanged without them.
 */
export function snapshotKey(sha256: string, page: number, region: PctRect | null, markupHash: string | null = null): string {
  if (!SHA_RE.test(sha256)) throw new Error("sha256 dokumentu nemá tvar 64 hex znakov.");
  if (!Number.isInteger(page) || page < 1) throw new Error("strana musí byť celé číslo od 1.");
  const r = region ? clampRect(region) : null;
  const tag = r ? [r.x, r.y, r.width, r.height].map((v) => (+v.toFixed(2)).toString()).join("_") : "full";
  if (markupHash !== null && !/^[0-9a-f]{16}$/.test(markupHash)) throw new Error("hash značiek nemá tvar 16 hex znakov.");
  return `snapshots/${sha256}/${page}-${tag}${markupHash ? `-m${markupHash}` : ""}.png`;
}

/**
 * RFC 8118 `viewrect=left,top,width,height` in page points from the top left corner
 * (PDF Open Parameters); null without the page size or region.
 */
export function viewrect(pageSize: [number, number] | null, region: PctRect | null): string | null {
  const r = region ? clampRect(region) : null;
  if (!pageSize || !r) return null;
  const [pw, ph] = pageSize;
  const v = [(r.x / 100) * pw, (r.y / 100) * ph, (r.width / 100) * pw, (r.height / 100) * ph];
  return v.map((n) => (+n.toFixed(1)).toString()).join(",");
}
