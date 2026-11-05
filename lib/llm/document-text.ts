/**
 * Text of documents with position on the page (D-123) - pure functions for `search_documents`.
 *
 * `document_pages.blocks` = text rows of the page with a bbox in % of the page (origin top
 * left), written by `etl/pdf_text.py`. From here the tool returns crops that can
 * be passed directly to `open_drawing region` (D-117) and thus show the place in the drawing.
 * D-169: rows of a page without a text layer are read by OCR; they carry `src: "ocr"` and `conf` (0 to 1).
 */

/** Text row of the page: t = text, x/y/w/h = bbox in % of the page; src/conf only for OCR (D-169). */
export interface TextBlock {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src?: "ocr";
  conf?: number;
}

/** Source of the page text (D-169): the PDF text layer or OCR with confidence 0 to 1. */
export type PageSource = { source: "text" } | { source: "ocr"; confidence: number };

/** Crop of the page in % in the shape of the `open_drawing region` parameter (D-117). */
export interface PageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockMatch {
  text: string;
  /** Exact position of the row on the page (in %). */
  bbox: PageRegion;
  /** Crop around the row for open_drawing region (at least MIN_REGION % per axis). */
  region: PageRegion;
  /** D-169: row from OCR and its confidence; absent with a text layer. */
  source?: "ocr";
  confidence?: number;
}

/** Smallest crop per axis in %: a smaller one would zoom the card in so that it loses context. */
export const MIN_REGION = 15;
/** Cap of the page text in the result (a floor plan drawing has around 11-19 thousand characters). */
export const PAGE_TEXT_CAP = 20_000;
/** Cap of rows with position in the result (the 1NP floor plan has around 1 100 rows). */
export const PAGE_BLOCKS_CAP = 1_500;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Lowercase letters without diacritics - the same as `lower(f_unaccent())` in the RPC. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Query words as prefixes, the same as the RPC `search_documents` (D-123): a word of
 * letters from 6 characters loses the last 2 (inflection), codes and numbers stay whole.
 */
export function queryStems(q: string): string[] {
  const words = foldText(q)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 0);
  const stems = words.map((w) => (/^[a-z]+$/.test(w) && w.length >= 6 ? w.slice(0, -2) : w));
  return [...new Set(stems)];
}

/** Valid row from JSONB (ETL writes it, but the DB is outside type checking). */
export function parseBlocks(raw: unknown): TextBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is TextBlock =>
      !!b &&
      typeof b === "object" &&
      typeof (b as TextBlock).t === "string" &&
      ["x", "y", "w", "h"].every((k) => Number.isFinite((b as unknown as Record<string, number>)[k]))
  );
}

/**
 * Source of the page text from its rows (D-169). There is no column for it in the DB: ETL reads OCR only for a page
 * without a text layer, so a page is entirely from OCR or entirely from the PDF and its rows suffice.
 * Page confidence = average of the rows' `conf` weighted by text length (like `page_conf` in `etl/ocr.py`).
 */
export function pageSource(blocks: TextBlock[]): PageSource {
  const ocr = blocks.filter((b) => b.src === "ocr");
  if (ocr.length === 0) return { source: "text" };
  const total = ocr.reduce((n, b) => n + b.t.length, 0);
  const sum = ocr.reduce((n, b) => n + (Number.isFinite(b.conf) ? (b.conf as number) : 0) * b.t.length, 0);
  return { source: "ocr", confidence: total > 0 ? Math.round((sum / total) * 100) / 100 : 0 };
}

/** Crop around a bbox: at least `min` % per axis, centered on the bbox, clipped to the page. */
export function regionAround(b: Pick<TextBlock, "x" | "y" | "w" | "h">, min = MIN_REGION): PageRegion {
  const axis = (start: number, size: number): [number, number] => {
    const len = Math.min(100, Math.max(size + 4, min));
    const lo = Math.min(Math.max(start + size / 2 - len / 2, 0), 100 - len);
    return [r1(lo), r1(len)];
  };
  const [x, width] = axis(b.x, b.w);
  const [y, height] = axis(b.y, b.h);
  return { x, y, width, height };
}

/**
 * Crop for open_drawing when only frames came (D-123): the envelope of all frames
 * (in %, shape `w/h` like DocRegion in viewer-ops), at least MIN_REGION per axis.
 */
export function highlightsRegion(rects: { x: number; y: number; w: number; h: number }[]) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const r = regionAround({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Rows of the page that contain the query words. First rows with all the words;
 * when there is none (e.g. "1.05 Technická miestnosť" is two rows in the drawing),
 * rows with the largest number of words. Order top to bottom, left to right.
 */
export function matchBlocks(blocks: TextBlock[], q: string, max = 5): BlockMatch[] {
  const stems = queryStems(q);
  if (stems.length === 0) return [];
  const scored = blocks
    .map((b) => {
      const tokens = foldText(b.t).split(/[^\p{L}\p{N}.]+/u).map((w) => w.replace(/^\.+|\.+$/g, ""));
      const hits = stems.filter((s) => tokens.some((tok) => tok.startsWith(s))).length;
      return { b, hits };
    })
    .filter((s) => s.hits > 0);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((s) => s.hits));
  return scored
    .filter((s) => s.hits === best)
    .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x)
    .slice(0, Math.max(1, max))
    .map(({ b }) => ({
      text: b.t,
      bbox: { x: r1(b.x), y: r1(b.y), width: r1(b.w), height: r1(b.h) },
      region: regionAround(b),
      ...ocrFields(b),
    }));
}

function ocrFields(b: TextBlock): { source?: "ocr"; confidence?: number } {
  return b.src === "ocr" ? { source: "ocr", ...(Number.isFinite(b.conf) ? { confidence: b.conf } : {}) } : {};
}

/** Rows into the page reading result: compact, rounded to 0.1 %. */
export function compactBlocks(blocks: TextBlock[], cap = PAGE_BLOCKS_CAP) {
  return blocks.slice(0, cap).map((b) => ({
    t: b.t,
    x: r1(b.x),
    y: r1(b.y),
    w: r1(b.w),
    h: r1(b.h),
    ...(b.src === "ocr" ? { src: "ocr" as const, ...(Number.isFinite(b.conf) ? { conf: b.conf } : {}) } : {}),
  }));
}
