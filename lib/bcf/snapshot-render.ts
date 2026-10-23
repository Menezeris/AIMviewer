import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { FRAME_COLOR, FRAME_FILL, snapshotPlan, type PctRect } from "./snapshot-plan";

/**
 * Render výrezu strany PDF na serveri (D-158 krok 3): pdf.js (legacy build, tá istá verzia
 * ako vo forku) do canvasu `@napi-rs/canvas`, biele pozadie, rámik oblasti, PNG. Server inak
 * parser PDF nemá (D-123); oba balíky sú externé (`serverExternalPackages`) a ich súbory
 * (písma, CMapy, wasm dekodéry) sa do funkcie pribaľujú v `next.config.ts`.
 *
 * Dekodéry: bez `BinaryDataFactory` pdf.js v Node nenačíta wasm JBIG2/OpenJPEG ani štandardné
 * písma a CCITT/JBIG2 masky a text by zo snímky zmizli (fork `browser-backend.ts`, #238).
 */

const requireHere = createRequire(import.meta.url);

/** Priečinok balíka pdfjs-dist (cmaps, standard_fonts, wasm). */
function pdfjsDir(): string {
  return path.dirname(requireHere.resolve("pdfjs-dist/package.json"));
}

const FOLDERS: Record<string, string> = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" };

/** Dáta dekodérov a písiem z disku (pdf.js `BinaryDataFactory`). */
class NodeFileDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const folder = FOLDERS[kind];
    // Meno súboru dáva pdf.js; cesta mimo priečinka balíka sa nepustí.
    if (!folder || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new Error(`Zdroj pdf.js ${kind}/${filename} nie je k dispozícii.`);
    }
    return new Uint8Array(await readFile(path.join(pdfjsDir(), folder, filename)));
  }
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;

/** pdf.js s pracovníkom v tom istom vlákne (Node nemá Web Worker); raz na proces. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjs;
}

/** Najväčší PDF, ktorý sa renderuje (výkresy majú jednotky MB). */
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

export class SnapshotRenderError extends Error {}

export interface RenderedSnapshot {
  png: Buffer;
  /** Rozmer zobrazenej strany v bodoch (s rotáciou strany). */
  pageSize: [number, number];
  pages: number;
}

/** Vyrenderuje stranu `page` (od 1) a oblasť `region` (% vľavo hore, null = celá strana). */
export async function renderPdfRegion(pdf: Uint8Array, page: number, region: PctRect | null): Promise<RenderedSnapshot> {
  if (pdf.byteLength > MAX_PDF_BYTES) throw new SnapshotRenderError(`PDF má viac ako ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
  const { getDocument } = await loadPdfJs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const task = getDocument({
    // pdf.js si buffer prevezme (transfer); kópia nechá volajúcemu jeho bajty.
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
    p.cleanup();
    return { png: canvas.toBuffer("image/png"), pageSize, pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
