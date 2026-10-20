/**
 * Text dokumentov s polohou na strane (D-123) - čisté funkcie pre `search_documents`.
 *
 * `document_pages.blocks` = riadky textu strany s bbox v % strany (počiatok vľavo
 * hore), zapisuje ich `etl/pdf_text.py`. Odtiaľto tool vracia výrezy, ktoré sa
 * dajú dať priamo do `open_drawing region` (D-117) a tým ukázať miesto vo výkrese.
 */

/** Riadok textu strany: t = text, x/y/w/h = bbox v % strany. */
export interface TextBlock {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Výrez strany v % v tvare parametra `open_drawing region` (D-117). */
export interface PageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockMatch {
  text: string;
  /** Presná poloha riadku na strane (v %). */
  bbox: PageRegion;
  /** Výrez okolo riadku pre open_drawing region (najmenej MIN_REGION % na os). */
  region: PageRegion;
}

/** Najmenší výrez na os v %: menší by kartu priblížil tak, že stratí kontext. */
export const MIN_REGION = 15;
/** Strop textu strany vo výsledku (výkres pôdorysu má okolo 11-19 tis. znakov). */
export const PAGE_TEXT_CAP = 20_000;
/** Strop riadkov s polohou vo výsledku (pôdorys 1NP má okolo 1 100 riadkov). */
export const PAGE_BLOCKS_CAP = 1_500;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Malé písmená bez diakritiky - rovnako ako `lower(f_unaccent())` v RPC. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Slová dopytu ako prefixy, rovnako ako RPC `search_documents` (D-123): slovo z
 * písmen od 6 znakov stratí posledné 2 (skloňovanie), kódy a čísla ostávajú celé.
 */
export function queryStems(q: string): string[] {
  const words = foldText(q)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 0);
  const stems = words.map((w) => (/^[a-z]+$/.test(w) && w.length >= 6 ? w.slice(0, -2) : w));
  return [...new Set(stems)];
}

/** Platný riadok z JSONB (ETL ho píše, ale DB je mimo typovej kontroly). */
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

/** Výrez okolo bboxu: najmenej `min` % na os, so stredom v bboxe, orezaný do strany. */
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
 * Výrez pre open_drawing, keď prišli len rámiky (D-123): obal všetkých rámikov
 * (v %, tvar `w/h` ako DocRegion vo viewer-ops), najmenej MIN_REGION na os.
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
 * Riadky strany, ktoré obsahujú slová dopytu. Najprv riadky so všetkými slovami;
 * keď žiadny nie je (napr. "1.05 Technická miestnosť" sú vo výkrese dva riadky),
 * riadky s najväčším počtom slov. Poradie zhora nadol, zľava doprava.
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
    }));
}

/** Riadky do výsledku čítania strany: kompaktne, zaokrúhlené na 0,1 %. */
export function compactBlocks(blocks: TextBlock[], cap = PAGE_BLOCKS_CAP) {
  return blocks.slice(0, cap).map((b) => ({ t: b.t, x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) }));
}
