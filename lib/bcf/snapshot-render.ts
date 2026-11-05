import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  arrowHead,
  cloudArcs,
  LINE_WIDTH,
  MARKUP_COLOR,
  PIN_DOT,
  PIN_OUTLINE,
  PIN_RADIUS,
  PIN_TEXT_SIZE,
  pinGeometry,
  TEXT_SIZE,
  toUnits,
  type Markup,
} from "./markup";
import { FRAME_COLOR, FRAME_FILL, snapshotPlan, type PctRect, type SnapshotPlan } from "./snapshot-plan";

/**
 * Server rendering of a PDF page region (D-158 step 3): pdf.js (legacy build, the same version
 * as in the fork) into an `@napi-rs/canvas` canvas, white background, region frame, PNG. The server otherwise
 * has no PDF parser (D-123); both packages are external (`serverExternalPackages`) and their files
 * (fonts, CMaps, wasm decoders) are bundled into the function in `next.config.ts`.
 *
 * Decoders: without `BinaryDataFactory` pdf.js in Node does not load the JBIG2/OpenJPEG wasm nor the standard
 * fonts and CCITT/JBIG2 masks, and text would vanish from the snapshot (fork `browser-backend.ts`, #238).
 */

const requireHere = createRequire(import.meta.url);

/** Folder of the pdfjs-dist package (cmaps, standard_fonts, wasm). */
function pdfjsDir(): string {
  return path.dirname(requireHere.resolve("pdfjs-dist/package.json"));
}

const FOLDERS: Record<string, string> = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" };

/** Decoder and font data from disk (pdf.js `BinaryDataFactory`). */
class NodeFileDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const folder = FOLDERS[kind];
    // The file name comes from pdf.js; a path outside the package folder is not served.
    if (!folder || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new Error(`Zdroj pdf.js ${kind}/${filename} nie je k dispozícii.`);
    }
    return new Uint8Array(await readFile(path.join(pdfjsDir(), folder, filename)));
  }
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;

/** pdf.js with the worker in the same thread (Node has no Web Worker); once per process. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjs;
}

/** The largest PDF that is rendered (drawings are a few MB). */
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

export class SnapshotRenderError extends Error {}

export interface RenderedSnapshot {
  png: Buffer;
  /** Size of the displayed page in points (with page rotation). */
  pageSize: [number, number];
  pages: number;
}

/** Renders page `page` (from 1) and region `region` (% from top left, null = the whole page). */
export async function renderPdfRegion(
  pdf: Uint8Array,
  page: number,
  region: PctRect | null,
  markup: Markup[] = [],
): Promise<RenderedSnapshot> {
  if (pdf.byteLength > MAX_PDF_BYTES) throw new SnapshotRenderError(`PDF má viac ako ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const { getDocument } = await loadPdfJs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const task = getDocument({
    // pdf.js takes over the buffer (transfer); a copy leaves the caller its bytes.
    data: new Uint8Array(pdf),
    BinaryDataFactory: NodeFileDataFactory,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  } as Parameters<PdfJs["getDocument"]>[0]);
  try {
    const doc = await task.promise;
    if (!Number.isInteger(page) || page < 1 || page > doc.numPages) {
      throw new SnapshotRenderError(`Dokument má ${doc.numPages} strán, strana ${page} nie je.`);
    }
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const pageSize: [number, number] = [base.width, base.height];
    const plan = snapshotPlan(pageSize, region);
    const viewport = p.getViewport({
      scale: plan.scale,
      offsetX: -(plan.crop.x / 100) * base.width * plan.scale,
      offsetY: -(plan.crop.y / 100) * base.height * plan.scale,
    });
    const canvas = createCanvas(plan.width, plan.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.width, plan.height);
    await p.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: "#ffffff" }).promise;
    if (plan.frame) {
      const f = plan.frame;
      const w = Math.max(3, Math.round(Math.max(plan.width, plan.height) / 400));
      ctx.fillStyle = FRAME_FILL;
      ctx.fillRect(f.x, f.y, f.width, f.height);
      ctx.strokeStyle = FRAME_COLOR;
      ctx.lineWidth = w;
      ctx.strokeRect(f.x, f.y, f.width, f.height);
    }
    if (markup.length) await ensureMarkupFont();
    if (markup.length) drawMarkup(ctx as unknown as MarkupContext, markup, pageSize, plan);
    p.cleanup();
    return { png: canvas.toBuffer("image/png"), pageSize, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/** Subset of the 2D context that markups need (an `@napi-rs/canvas` canvas satisfies it). */
export interface MarkupContext {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise?: boolean): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textBaseline: string;
}

const FONT_FAMILY = "AimMarkup, Liberation Sans, Arial, Helvetica, sans-serif";
let fontReady = false;

/** Bold markup font: Liberation Sans from pdfjs-dist (the container may have no system font). */
async function ensureMarkupFont(): Promise<void> {
  if (fontReady) return;
  fontReady = true;
  try {
    const { GlobalFonts } = await import("@napi-rs/canvas");
    GlobalFonts.registerFromPath(path.join(pdfjsDir(), "standard_fonts", "LiberationSans-Bold.ttf"), "AimMarkup");
  } catch {
    // without the font the shapes stay, the text falls back to a system font
  }
}

/**
 * Markups over the rendered page (D-158 step 7), shapes like `docMarkupSvg.ts` in the fork: red
 * #dc2626, drawing units = page width 1000. Bitmap coordinates are obtained from the units
 * via the plan scale and the crop offset.
 */
export function drawMarkup(ctx: MarkupContext, markup: Markup[], pageSize: [number, number], plan: SnapshotPlan): void {
  const k = (plan.scale * pageSize[0]) / 1000;
  const [pw, ph] = pageSize;
  const ox = (plan.crop.x / 100) * pw * plan.scale;
  const oy = (plan.crop.y / 100) * ph * plan.scale;
  ctx.save();
  // Jednotky -> px bitmapy.
  ctx.setTransform(k, 0, 0, k, -ox, -oy);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const m of markup) {
    const pts = m.points.map((p) => toUnits(p, pageSize));
    ctx.strokeStyle = MARKUP_COLOR;
    ctx.fillStyle = MARKUP_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    if (m.type === "cloud") {
      const arcs = cloudArcs(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      ctx.beginPath();
      for (const a of arcs) {
        ctx.moveTo(a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0));
        ctx.arc(a.cx, a.cy, a.r, a.a0, a.a1, false);
      }
      ctx.stroke();
    } else if (m.type === "arrow") {
      const head = arrowHead(pts[0], pts[1]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      // The line ends at the arrow head base so that it does not stick out past its tip.
      const base = head ? { x: (head[1].x + head[2].x) / 2, y: (head[1].y + head[2].y) / 2 } : pts[1];
      ctx.lineTo(base.x, base.y);
      ctx.stroke();
      if (head) {
        ctx.beginPath();
        ctx.moveTo(head[0].x, head[0].y);
        ctx.lineTo(head[1].x, head[1].y);
        ctx.lineTo(head[2].x, head[2].y);
        ctx.closePath();
        ctx.fill();
      }
    } else if (m.type === "text") {
      haloText(ctx, m.text ?? "", pts[0].x, pts[0].y, TEXT_SIZE, "alphabetic");
    } else {
      const g = pinGeometry(pts[0]);
      ctx.beginPath();
      ctx.moveTo(g.tip.x, g.tip.y);
      ctx.lineTo(g.from.x, g.from.y);
      ctx.arc(g.centre.x, g.centre.y, PIN_RADIUS, g.a0, g.a1, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = PIN_OUTLINE;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(g.centre.x, g.centre.y, PIN_DOT, 0, 2 * Math.PI);
      ctx.fill();
      if (m.text) haloText(ctx, m.text, g.centre.x + PIN_RADIUS, g.centre.y - PIN_RADIUS, PIN_TEXT_SIZE, "alphabetic");
    }
  }
  ctx.restore();
}

/** Bold red text with a white halo (thickness 1/5 of the font size). */
function haloText(ctx: MarkupContext, text: string, x: number, y: number, size: number, baseline: string): void {
  ctx.font = `bold ${size}px ${FONT_FAMILY}`;
  ctx.textBaseline = baseline;
  ctx.lineWidth = size / 5;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = MARKUP_COLOR;
  ctx.fillText(text, x, y);
}
