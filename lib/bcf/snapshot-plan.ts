/**
 * Snímka výrezu strany PDF pre BCF tému (D-158 krok 3), čistá časť: čo sa vyreže, v akej
 * mierke, kde je rámik a pod akým kľúčom sa snímka kešuje. Render (pdf.js + canvas) je v
 * `snapshot-render.ts`, zdroj PDF a keš v `snapshot.ts`.
 *
 * Súradnice oblasti sú v % zobrazenej strany, počiatok vľavo hore (ako `open_drawing region`
 * a odkaz témy v `model_task_documents.region`).
 */

export interface PctRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Dlhšia strana snímky v px (BCF snímka, #199: "long side up to 1500 px"). */
export const SNAPSHOT_LONG_SIDE = 1500;
/** Okolie okolo oblasti: podiel jej rozmeru na každú stranu, aby bol rámik v kontexte. */
const CONTEXT = 0.25;
/** Najmenšie okolie v % strany (malá oblasť by inak nemala čitateľný kontext). */
const MIN_CONTEXT_PCT = 2;
/** Strop mierky (bod -> px), aby malá oblasť nevyrobila rozmazanú obrovskú bitmapu. */
const MAX_SCALE = 8;
export const FRAME_COLOR = "#dc2626";
export const FRAME_FILL = "rgba(220, 38, 38, 0.08)";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Oblasť orezaná na stranu; prázdna (mimo strany) = null. */
export function clampRect(r: PctRect): PctRect | null {
  const x0 = clamp(r.x, 0, 100);
  const y0 = clamp(r.y, 0, 100);
  const x1 = clamp(r.x + r.width, 0, 100);
  const y1 = clamp(r.y + r.height, 0, 100);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface SnapshotPlan {
  /** Výrez strany v % (oblasť s okolím, alebo celá strana). */
  crop: PctRect;
  /** Mierka body strany -> px. */
  scale: number;
  /** Rozmer bitmapy. */
  width: number;
  height: number;
  /** Rámik oblasti v px bitmapy; null = celá strana bez rámika. */
  frame: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Výrez a mierka: oblasť s okolím (alebo celá strana) tak, aby dlhšia strana snímky mala
 * `SNAPSHOT_LONG_SIDE` px; `pageSize` = [šírka, výška] zobrazenej strany v bodoch.
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

/** Kľúč keše v buckete `documents`: `snapshots/<sha256>/<strana>-<x_y_w_h|full>.png`. */
export function snapshotKey(sha256: string, page: number, region: PctRect | null): string {
  if (!SHA_RE.test(sha256)) throw new Error("sha256 dokumentu nemá tvar 64 hex znakov.");
  if (!Number.isInteger(page) || page < 1) throw new Error("strana musí byť celé číslo od 1.");
  const r = region ? clampRect(region) : null;
  const tag = r ? [r.x, r.y, r.width, r.height].map((v) => (+v.toFixed(2)).toString()).join("_") : "full";
  return `snapshots/${sha256}/${page}-${tag}.png`;
}

/**
 * RFC 8118 `viewrect=left,top,width,height` v bodoch strany od ľavého horného rohu
 * (PDF Open Parameters); bez veľkosti strany alebo oblasti null.
 */
export function viewrect(pageSize: [number, number] | null, region: PctRect | null): string | null {
  const r = region ? clampRect(region) : null;
  if (!pageSize || !r) return null;
  const [pw, ph] = pageSize;
  const v = [(r.x / 100) * pw, (r.y / 100) * ph, (r.width / 100) * pw, (r.height / 100) * ph];
  return v.map((n) => (+n.toFixed(1)).toString()).join(",");
}
