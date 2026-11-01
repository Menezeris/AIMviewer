/**
 * Automatická kalibrácia podkladu výkresu (D-133) - čistá logika bez DB a motora.
 *
 * Podklad = strana PDF v rovine pohľadu (pôdorys, zvislý rez). Výsledok je `affine`
 * `[a, b, tx, c, d, ty]` z bodov strany PDF (počiatok vľavo dole, y hore, ako `_georef`
 * D-072) do metrov v súradniciach roviny (u, v); pri pôdoryse sú (u, v) = IFC (X, Y).
 *
 * Postup (prototyp v #170: pôdorys medián 15 mm, rez 8 mm):
 * 1. Hrubý štart z textu strany (`document_pages.blocks`): pôdorys = popisky miestností
 *    proti ťažiskám IfcSpace (RANSAC, legenda má tie isté čísla); rez = výškové kóty
 *    (`+5,000`) na zvislú mierku a výšku, popisky osí na vodorovný posun a smer pohľadu.
 * 2. Doladenie: hrubé čiary strany (`document_pages.lines`) proti rezu modelu rovinou
 *    pohľadu, trimmed ICP s podobnosťou (mierka, rotácia, posun; smer pohľadu pevný).
 * 3. Kvalita: vzdialenosť bodov rezu IFC od čiar PDF (medián, p90) a krížová validácia
 *    (fit na polovici, rozdiel voči plnému fitu na druhej).
 */

export type P2 = [number, number];
export type Vec3 = [number, number, number];
/** Úsečka v rovine: x1, y1, x2, y2. */
export type Seg = [number, number, number, number];
/** `x' = a·x + b·y + tx`, `y' = c·x + d·y + ty` (rovnaké poradie ako `_georef.affine`). */
export type Affine = [number, number, number, number, number, number];

/** Rovina pohľadu v IFC svete (m): body roviny = origin + u·s + v·t. */
export interface Plane {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

/** Riadok textu strany (D-123): bbox v % strany, počiatok vľavo hore. */
export interface PageBlock {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Hrubá úsečka strany (D-133): body strany, počiatok vľavo dole, w = hrúbka. */
export type PageLine = [number, number, number, number, number];

/** 1 pt = 1/72 palca v metroch; mierka 1:N = (m/pt) / PT_M. */
export const PT_M = 0.0254 / 72;

/** Prahy ICP (m): od hrubého štartu po presnosť čiary. */
const ICP_THRESHOLDS = [1.5, 1.0, 0.6, 0.4, 0.25, 0.15, 0.1, 0.1, 0.08, 0.08];
/** Krížová validácia štartuje z plného fitu, stačia jemné prahy (veľké by polovicu odtiahli). */
const CV_THRESHOLDS = [0.15, 0.1, 0.08];
const ICP_ITERATIONS = 5;
/** Vzorkovanie: rez IFC 2 cm, čiary PDF 1 pt (v 1:50 asi 1,8 cm). */
const IFC_STEP_M = 0.02;
const PDF_STEP_PT = 1;
/** Bod rezu IFC ďalej od čiary PDF nepatrí do kvality (čiara vo výkrese chýba). */
const QUALITY_RADIUS_M = 0.3;

export function applyAffine(m: Affine, p: P2): P2 {
  return [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
}

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-18) throw new Error("affine je singulárny");
  const a = m[4] / det;
  const b = -m[1] / det;
  const c = -m[3] / det;
  const d = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), c, d, -(c * m[2] + d * m[5])];
}

/** Mierka (m na pt), rotácia (stupne) a zrkadlenie osi u (pohľad z druhej strany). */
export function decompose(m: Affine): { scale: number; rotationDeg: number; mirrored: boolean } {
  const det = m[0] * m[4] - m[1] * m[3];
  const mirrored = det < 0;
  // Zrkadlo je pred rotáciou: M = s·R·F, F = diag(-1, 1) -> s·R = M·F.
  const a = mirrored ? -m[0] : m[0];
  const c = mirrored ? -m[3] : m[3];
  return { scale: Math.sqrt(Math.abs(det)), rotationDeg: (Math.atan2(c, a) * 180) / Math.PI, mirrored };
}

// ─── Rez modelu rovinou ──────────────────────────────────────────────────────

const sub = (a: ArrayLike<number>, i: number, o: Vec3): Vec3 => [a[i] - o[0], a[i + 1] - o[1], a[i + 2] - o[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Úsečky rezu trojuholníkov rovinou v súradniciach roviny (u, v). `positions` sú body
 * v IFC svete (x, y, z, m), `indices` trojice. Pridáva do `out`.
 */
export function sliceTriangles(positions: ArrayLike<number>, indices: ArrayLike<number>, plane: Plane, out: Seg[]): void {
  const n = cross(plane.u, plane.v);
  const p: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const d = [0, 0, 0];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    let pos = 0;
    let neg = 0;
    for (let k = 0; k < 3; k++) {
      p[k] = sub(positions, indices[t + k] * 3, plane.origin);
      d[k] = dot(p[k], n);
      if (d[k] > 0) pos++;
      else neg++;
    }
    if (pos === 0 || neg === 0) continue;
    const hit: P2[] = [];
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      if (d[a] > 0 === d[b] > 0) continue;
      const s = d[a] / (d[a] - d[b]);
      const q: Vec3 = [p[a][0] + s * (p[b][0] - p[a][0]), p[a][1] + s * (p[b][1] - p[a][1]), p[a][2] + s * (p[b][2] - p[a][2])];
      hit.push([dot(q, plane.u), dot(q, plane.v)]);
    }
    if (hit.length === 2) out.push([hit[0][0], hit[0][1], hit[1][0], hit[1][1]]);
  }
}

/**
 * Ťažisko pôdorysu telesa (priestoru) v IFC (X, Y): plošne vážené ťažisko priemetov
 * trojuholníkov s kladnou plochou (horná alebo spodná plocha, steny sa premietnu na 0).
 */
export function footprintCentroid(positions: ArrayLike<number>, indices: ArrayLike<number>): P2 | null {
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i = indices[t] * 3;
    const j = indices[t + 1] * 3;
    const k = indices[t + 2] * 3;
    const a = 0.5 * ((positions[j] - positions[i]) * (positions[k + 1] - positions[i + 1]) - (positions[k] - positions[i]) * (positions[j + 1] - positions[i + 1]));
    if (a <= 1e-9) continue;
    A += a;
    cx += (a * (positions[i] + positions[j] + positions[k])) / 3;
    cy += (a * (positions[i + 1] + positions[j + 1] + positions[k + 1])) / 3;
  }
  return A > 0 ? [cx / A, cy / A] : null;
}

/** Body po úsečkách s krokom `step` (oba konce), zhodné body (na 0,1 kroku) raz. */
export function samplePoints(segs: ArrayLike<number>[], step: number): Float64Array {
  const out: number[] = [];
  const seen = new Set<string>();
  const q = step / 10;
  for (const s of segs) {
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const n = Math.max(1, Math.floor(L / step));
    for (let i = 0; i <= n; i++) {
      const x = s[0] + ((s[2] - s[0]) * i) / n;
      const y = s[1] + ((s[3] - s[1]) * i) / n;
      const key = `${Math.round(x / q)},${Math.round(y / q)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x, y);
    }
  }
  return Float64Array.from(out);
}

// ─── Najbližší bod: mriežka ──────────────────────────────────────────────────

/** Najbližší bod v polomere `cell` (mriežka s bunkou = polomer, hľadá sa 3x3 buniek). */
export class PointGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    private readonly pts: Float64Array,
    private readonly cell: number,
  ) {
    for (let i = 0; i < pts.length; i += 2) {
      const k = this.key(Math.floor(pts[i] / cell), Math.floor(pts[i + 1] / cell));
      const c = this.cells.get(k);
      if (c) c.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(ix: number, iy: number): number {
    return (ix + 1_000_000) * 2_000_003 + (iy + 1_000_000);
  }
  /** Index (do poľa súradníc, párny) a vzdialenosť; -1, ak nič nie je bližšie ako bunka. */
  nearest(x: number, y: number): [number, number] {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    let best = -1;
    let bd = this.cell * this.cell;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = this.cells.get(this.key(ix + dx, iy + dy));
        if (!c) continue;
        for (const i of c) {
          const ex = this.pts[i] - x;
          const ey = this.pts[i + 1] - y;
          const d = ex * ex + ey * ey;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    return [best, best < 0 ? Infinity : Math.sqrt(bd)];
  }
}

// ─── Podobnosť ───────────────────────────────────────────────────────────────

/** Súčty dvojíc bodov pre podobnosť najmenších štvorcov (bez ukladania dvojíc). */
class PairSums {
  n = 0;
  px = 0;
  py = 0;
  qx = 0;
  qy = 0;
  pp = 0;
  pq = 0;
  pxq = 0;
  constructor(
    private readonly mirror: boolean,
    /** Pevná mierka (m na pt): rotácia a posun sa hľadajú, mierka ostáva (#284). */
    private readonly fixedScale?: number,
    /** Pevné natočenie (rad) pri pevnej mierke: hľadá sa len posun (pôdorys rovnobežný s osami modelu). */
    private readonly fixedRotation?: number,
  ) {}
  add(px: number, py: number, qx: number, qy: number): void {
    if (this.mirror) px = -px;
    this.n++;
    this.px += px;
    this.py += py;
    this.qx += qx;
    this.qy += qy;
    this.pp += px * px + py * py;
    this.pq += px * qx + py * qy;
    this.pxq += px * qy - py * qx;
  }
  /** q ≈ s·R·F·p + t (F = zrkadlo u, ak `mirror`); null pri menej ako 2 bodoch. */
  solve(): Affine | null {
    const n = this.n;
    if (n < 2) return null;
    const mpx = this.px / n;
    const mpy = this.py / n;
    const mqx = this.qx / n;
    const mqy = this.qy / n;
    const N = this.pp - n * (mpx * mpx + mpy * mpy);
    if (N <= 1e-12) return null;
    let a = (this.pq - n * (mpx * mqx + mpy * mqy)) / N;
    let b = (this.pxq - n * (mpx * mqy - mpy * mqx)) / N;
    if (this.fixedScale && this.fixedRotation !== undefined) {
      a = Math.cos(this.fixedRotation) * this.fixedScale;
      b = Math.sin(this.fixedRotation) * this.fixedScale;
    } else if (this.fixedScale) {
      // Smer (uhol) z najmenších štvorcov ostáva, dĺžka s·R sa nastaví na pevnú mierku.
      const len = Math.hypot(a, b);
      if (len < 1e-18) return null;
      a = (a / len) * this.fixedScale;
      b = (b / len) * this.fixedScale;
    }
    const f = this.mirror ? -1 : 1;
    // s·R = [[a, -b], [b, a]]; s·R·F = [[f·a, -b], [f·b, a]].
    const m: Affine = [f * a, -b, 0, f * b, a, 0];
    m[2] = mqx - (a * mpx - b * mpy);
    m[5] = mqy - (b * mpx + a * mpy);
    return m;
  }
}

/** Podobnosť najmenších štvorcov z dvojíc (bez zrkadla, alebo so zrkadlom osi u). */
export function fitSimilarity(P: P2[], Q: P2[], mirror = false, fixedScale?: number): Affine | null {
  const s = new PairSums(mirror, fixedScale);
  P.forEach((p, i) => s.add(p[0], p[1], Q[i][0], Q[i][1]));
  return s.solve();
}

export interface LabelCandidate {
  name: string;
  page: P2;
  model: P2;
}

/**
 * Hrubý štart z popiskov: RANSAC cez dvojice rôznych mien, inliery bližšie ako `tol` m
 * a každé meno najviac raz (legenda na strane má tie isté čísla). Vráti fit z inlierov.
 */
export function ransacLabels(cands: LabelCandidate[], tol = 1.5, minPagePt = 50, fixedScale?: number): { affine: Affine; inliers: LabelCandidate[] } | null {
  let best: { n: number; sum: number; idx: number[] } | null = null;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      if (cands[i].name === cands[j].name) continue;
      if (Math.hypot(cands[i].page[0] - cands[j].page[0], cands[i].page[1] - cands[j].page[1]) < minPagePt) continue;
      const m = fitSimilarity([cands[i].page, cands[j].page], [cands[i].model, cands[j].model], false, fixedScale);
      if (!m) continue;
      const idx: number[] = [];
      const names = new Set<string>();
      let sum = 0;
      let unique = true;
      cands.forEach((c, k) => {
        const q = applyAffine(m, c.page);
        const r = Math.hypot(q[0] - c.model[0], q[1] - c.model[1]);
        if (r >= tol) return;
        if (names.has(c.name)) unique = false;
        names.add(c.name);
        idx.push(k);
        sum += r;
      });
      if (!unique) continue;
      if (!best || idx.length > best.n || (idx.length === best.n && sum < best.sum)) best = { n: idx.length, sum, idx };
    }
  }
  // Pri známej mierke stačia dva popisky (tretí by dával len kontrolu), inak treba aspoň 3.
  if (!best || best.n < (fixedScale ? 2 : 3)) return null;
  const inliers = best.idx.map((k) => cands[k]);
  const affine = fitSimilarity(
    inliers.map((c) => c.page),
    inliers.map((c) => c.model),
    false,
    fixedScale,
  );
  return affine ? { affine, inliers } : null;
}

// ─── ICP ─────────────────────────────────────────────────────────────────────

export interface IcpOptions {
  mirror?: boolean;
  /** Len body PDF, ktorých obraz (u, v) prejde filtrom (krížová validácia). */
  keep?: (u: number, v: number) => boolean;
  thresholds?: number[];
  /** Pevná mierka (m na pt), ICP ju nemení. */
  fixedScale?: number;
  /** Pevné natočenie (rad), len s `fixedScale`: ICP hľadá len posun. */
  fixedRotation?: number;
}

/** Obálka bodov s okrajom; body PDF mimo nej (legenda, pečiatka) sa do ICP neberú. */
function bounds(pts: Float64Array, pad: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Každý `stride`-tý bod (hrubé kroky ICP nepotrebujú plnú hustotu). */
function decimate(pts: Float64Array, stride: number): Float64Array {
  if (stride <= 1) return pts;
  const out = new Float64Array(Math.ceil(pts.length / 2 / stride) * 2);
  let k = 0;
  for (let i = 0; i < pts.length; i += 2 * stride) {
    out[k++] = pts[i];
    out[k++] = pts[i + 1];
  }
  return out.subarray(0, k);
}

/** Hustota bodov podľa prahu: pri prahu od 0,4 m stačí každý 8. bod PDF a 4. bod IFC. */
function strides(thr: number): [number, number] {
  if (thr >= 0.4) return [8, 4];
  if (thr >= 0.15) return [2, 1];
  return [1, 1];
}

/** Trimmed ICP: body čiar PDF k najbližšiemu bodu rezu IFC pod prahom, prah klesá. */
export function icp(pdf: Float64Array, ifc: Float64Array, start: Affine, opts: IcpOptions = {}): { affine: Affine; pairs: number } {
  const box = bounds(ifc, 2);
  let m = start;
  let pairs = 0;
  for (const thr of opts.thresholds ?? ICP_THRESHOLDS) {
    const [sp, si] = strides(thr);
    const src = decimate(pdf, sp);
    const dst = decimate(ifc, si);
    const grid = new PointGrid(dst, thr);
    for (let it = 0; it < ICP_ITERATIONS; it++) {
      const sums = new PairSums(opts.mirror ?? false, opts.fixedScale, opts.fixedRotation);
      for (let i = 0; i < src.length; i += 2) {
        const x = m[0] * src[i] + m[1] * src[i + 1] + m[2];
        const y = m[3] * src[i] + m[4] * src[i + 1] + m[5];
        if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) continue;
        if (opts.keep && !opts.keep(x, y)) continue;
        const [j] = grid.nearest(x, y);
        if (j >= 0) sums.add(src[i], src[i + 1], dst[j], dst[j + 1]);
      }
      const next = sums.solve();
      if (!next) return { affine: m, pairs: 0 };
      m = next;
      pairs = sums.n;
    }
  }
  return { affine: m, pairs };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];
}

export interface Quality {
  median_mm: number;
  p90_mm: number;
  /** Podiel bodov rezu IFC do 0,3 m od čiary PDF (pokrytie). */
  coverage: number;
}

/** Vzdialenosť bodov rezu IFC od čiar PDF po transformácii (len do 0,3 m). */
export function quality(pdf: Float64Array, ifc: Float64Array, m: Affine): Quality {
  const q = new Float64Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 2) {
    q[i] = m[0] * pdf[i] + m[1] * pdf[i + 1] + m[2];
    q[i + 1] = m[3] * pdf[i] + m[4] * pdf[i + 1] + m[5];
  }
  const grid = new PointGrid(q, QUALITY_RADIUS_M);
  const d: number[] = [];
  for (let i = 0; i < ifc.length; i += 2) {
    const [, dist] = grid.nearest(ifc[i], ifc[i + 1]);
    if (dist < QUALITY_RADIUS_M) d.push(dist);
  }
  d.sort((a, b) => a - b);
  return {
    median_mm: Math.round(quantile(d, 0.5) * 1000),
    p90_mm: Math.round(quantile(d, 0.9) * 1000),
    coverage: ifc.length ? +(d.length / (ifc.length / 2)).toFixed(3) : 0,
  };
}

/**
 * Krížová validácia: fit len na polovici (podľa u, potom podľa v), najväčší rozdiel
 * polohy voči plnému fitu na bodoch rezu druhej polovice (mm).
 */
export function crossValidate(pdf: Float64Array, ifc: Float64Array, full: Affine, mirror: boolean, fixedScale?: number, fixedRotation?: number): number {
  const inv = invertAffine(full);
  let worst = 0;
  for (const axis of [0, 1]) {
    const vals: number[] = [];
    for (let i = axis; i < ifc.length; i += 2) vals.push(ifc[i]);
    vals.sort((a, b) => a - b);
    const mid = quantile(vals, 0.5);
    for (const side of [-1, 1]) {
      const inFit = (u: number, v: number) => side * ((axis === 0 ? u : v) - mid) < 0;
      const half = icp(pdf, ifc, full, { mirror, keep: inFit, thresholds: CV_THRESHOLDS, fixedScale, fixedRotation }).affine;
      for (let i = 0; i < ifc.length; i += 2) {
        if (inFit(ifc[i], ifc[i + 1])) continue;
        const p = applyAffine(inv, [ifc[i], ifc[i + 1]]);
        const q = applyAffine(half, p);
        worst = Math.max(worst, Math.hypot(q[0] - ifc[i], q[1] - ifc[i + 1]));
      }
    }
  }
  return Math.round(worst * 1000);
}

// ─── Text strany ─────────────────────────────────────────────────────────────

/** Stred riadku textu v bodoch strany (vľavo dole). */
export function blockCenter(b: PageBlock, pageSize: P2): P2 {
  return [((b.x + b.w / 2) / 100) * pageSize[0], (1 - (b.y + b.h / 2) / 100) * pageSize[1]];
}

/** Výšková kóta `+5,000`, `-0,160`, `±0,000` -> metre; inak null. */
export function parseLevel(t: string): number | null {
  const m = /^([+\-±])\s?(\d+)[,.](\d{3})$/.exec(t.trim());
  if (!m) return null;
  const v = Number(`${m[2]}.${m[3]}`);
  return m[1] === "-" ? -v : v;
}

// ─── Kalibrácia ──────────────────────────────────────────────────────────────

export interface CalibrationResult {
  affine: Affine;
  scale_m_per_pt: number;
  /** Mierka výkresu 1:N. */
  scale_ratio: number;
  rotation_deg: number;
  mirrored: boolean;
  start: {
    method: "room_labels" | "plan_scan" | "plan_axes" | "levels_axes" | "levels_scan" | "pairs";
    points: number;
    median_mm: number | null;
    labels_found?: number;
    /** Pôdorys bez popiskov (D-180): štart skenovaním posunu pri pevnej mierke a natočení po 90°. */
    scan?: { rotation_deg: number; candidates: number; score: number; labels_tried: boolean };
    /** Rez (D-179): kóty spárované s výškami podlaží modelu a posun ±0,000 voči IFC Z (m). */
    levels?: { found: number; storeys_matched: number; offset_m: number };
    /** Rez: popisky osí na reze spárované s polohou po reze; pôdorys (plan_axes): osi strany spárované s osami iných výkresov. */
    axes_matched?: number;
    /** Pôdorys: štart nevybraný hneď z popiskov (slabé popisky, nízke pokrytie, osi), ktoré štarty súťažili. */
    compared?: string[];
  };
  /** Pôdorys: ICP s voľným natočením skĺzlo o viac ako 0,5° od násobku 90° (pri natočenej sieti osí od jej natočenia), výsledok má natočenie pevné (voľné bolo toto). */
  rotation_locked_from_deg?: number;
  /**
   * Pôdorys (D-184 dodatok): ICP posunulo osi výkresu mimo polohy z iných výkresov, hoci štart z osí sedel; výsledok je
   * štart z osí bez doladenia (čiary výkresu nie sú konštrukcie: raster SF.01, výsek s rozvodmi TP.01 4NP).
   */
  icp_rejected?: { reason: "axes"; axes_median_mm: number | null };
  icp_pairs: number;
  quality: Quality;
  cross_validation_max_mm: number;
  /** Dva vzdialené body (strana -> rovina) pre ručnú úpravu v paneli Underlays. */
  calibration: { pdf_pt: P2; plane_m: P2 }[];
}

// ─── Mierka výkresu (#284) ───────────────────────────────────────────────────

/** Bežné mierky výkresov 1:N; iná mierka z kalibrácie je podozrivá (zlé čiary v ICP). */
export const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500];
/** Najväčšia relatívna odchýlka mierky od najbližšej bežnej mierky (mierka nie je známa, D-133 doplnok). */
export const SCALE_TOLERANCE = 0.05;
/** Najväčšia odchýlka od mierky zo zadania alebo z textu strany (D-180): výkres 1:50 nevyjde 1:51,5. */
export const SCALE_TOLERANCE_KNOWN = 0.02;
/** Najväčšia odchýlka natočenia od násobku 90° pri pôdoryse a od 0° pri reze (D-180). */
export const ROTATION_TOLERANCE_DEG = 2;
/** Pôdorys s pevnou mierkou: natočenie po ICP ďalej od násobku 90° sa uzamkne (dobré kalibrácie sú do 0,03°, sklz TP.01 1 až 2,3°). */
export const ROTATION_LOCK_DEG = 0.5;

const SCALE_WORD = /m[eé]r[ií]tko|mierka|scale/i;
const SCALE_VALUE = /(?:^|[^\d:])1\s*:\s*(\d{1,4})(?!\d)/;

/**
 * Mierka výkresu z textu strany ("MERÍTKO 1 : 50", "Mierka: 1:100", slovo a hodnota v dvoch
 * riadkoch). Viac rôznych mierok (detaily) alebo žiadna = null.
 */
export function pageScaleFromText(blocks: PageBlock[]): number | null {
  const found = new Set<number>();
  const hasWord = blocks.some((b) => SCALE_WORD.test(b.t));
  for (const b of blocks) {
    const m = SCALE_VALUE.exec(b.t);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n >= 2)) continue;
    // Hodnota v tom istom riadku ako slovo, alebo samostatný riadok "1 : 50", ak slovo je na strane.
    const alone = /^\s*1\s*:\s*\d{1,4}\s*$/.test(b.t);
    if (SCALE_WORD.test(b.t) || (hasWord && alone)) found.add(n);
    // Bez slova (pečiatka PBR "1:100", D-180): samostatný riadok s bežnou mierkou.
    else if (!hasWord && alone && STANDARD_SCALES.includes(n)) found.add(n);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Výrez strany v % (x, y, w, h; vľavo hore, ako `_georef.region`). */
export type PageRegion = [number, number, number, number];

/**
 * Text a čiary len z výrezu strany (D-180, hárok s viac pôdorysmi): riadok so stredom vo výreze, úsečka s oboma
 * koncami vo výreze. Súradnice ostávajú v bodoch celej strany, affine je teda pre celú stranu.
 */
export function cropToRegion(blocks: PageBlock[], lines: PageLine[], region: PageRegion, pageSize: P2): { blocks: PageBlock[]; lines: PageLine[] } {
  const [rx, ry, rw, rh] = region;
  const x0 = (rx / 100) * pageSize[0];
  const x1 = ((rx + rw) / 100) * pageSize[0];
  const y0 = (1 - (ry + rh) / 100) * pageSize[1];
  const y1 = (1 - ry / 100) * pageSize[1];
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  return {
    blocks: blocks.filter((b) => {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh;
    }),
    lines: lines.filter((l) => inside(l[0], l[1]) && inside(l[2], l[3])),
  };
}

export interface ScaleCheck {
  /** Mierka výsledku 1:N. */
  ratio: number;
  /** Očakávaná mierka 1:N a odkiaľ je. */
  expected: number | null;
  source: "param" | "text" | "standard" | "none";
  /** Relatívna odchýlka od očakávanej (0,03 = 3 %). */
  deviation: number | null;
  ok: boolean;
}

/** Porovná mierku výsledku s očakávanou (parameter, text strany), inak s najbližšou bežnou. */
export function checkScale(ratio: number, param: number | null, text: number | null): ScaleCheck {
  let expected = param ?? text;
  let source: ScaleCheck["source"] = param !== null ? "param" : text !== null ? "text" : "none";
  if (expected === null) {
    expected = STANDARD_SCALES.reduce((a, b) => (Math.abs(Math.log(b / ratio)) < Math.abs(Math.log(a / ratio)) ? b : a));
    source = "standard";
  }
  const deviation = Math.abs(ratio - expected) / expected;
  const tol = source === "standard" ? SCALE_TOLERANCE : SCALE_TOLERANCE_KNOWN;
  return { ratio, expected, source, deviation: +deviation.toFixed(4), ok: deviation <= tol };
}

export interface RotationCheck {
  rotation_deg: number;
  /** Očakávané natočenie: najbližší násobok 90° (pôdorys), 0° (rez). */
  expected_deg: number;
  deviation_deg: number;
  ok: boolean;
}

/**
 * Kontrola natočenia (D-180): výkresy budovy sú kreslené rovnobežne s osami modelu, pôdorys môže byť na strane
 * otočený o 90°, rez nie. Väčšia odchýlka = ICP chytilo zlé čiary (strecha 4NP: -23,6°).
 */
export function checkRotation(rotationDeg: number, kind: "plan" | "section", gridDeg?: number): RotationCheck {
  // Pôdorys s natočenou sieťou osí na strane (D-184 dodatok): očakávané natočenie z osí strany (`gridRotations`).
  const expected = kind === "plan" ? (gridDeg !== undefined ? nearestRotation(rotationDeg, gridRotations(gridDeg)).to : Math.round(rotationDeg / 90) * 90) : 0;
  let d = Math.abs(rotationDeg - expected) % 360;
  if (d > 180) d = 360 - d;
  // `|| 0`: bez -0 vo výsledku.
  return { rotation_deg: rotationDeg, expected_deg: +(((((expected + 180) % 360) + 360) % 360) - 180).toFixed(3) || 0, deviation_deg: +d.toFixed(3), ok: d <= ROTATION_TOLERANCE_DEG };
}

function linesToPoints(lines: PageLine[]): Float64Array {
  return samplePoints(lines, PDF_STEP_PT);
}

/** Uzamknutie natočenia pôdorysu: `rotations` = povolené natočenia (násobky 90°, pri natočenej sieti osí `gridRotations`). */
interface PlanLock {
  rotations: number[];
  /** Osi strany a referencie: ICP, ktoré osi rozbije, sa nevezme (štart z osí ostane). */
  axes?: { page: AxisLine[]; ref: RefAxis[] };
}

/** Uhol `deg` najbližší k povoleným natočeniam a jeho odchýlka (stupne, 0 až 180). */
function nearestRotation(deg: number, rotations: number[]): { to: number; dev: number } {
  let best = { to: rotations[0], dev: Infinity };
  for (const r of rotations) {
    let d = Math.abs(deg - r) % 360;
    if (d > 180) d = 360 - d;
    if (d < best.dev) best = { to: r, dev: d };
  }
  return best;
}

/**
 * ICP pôdorysu pri pevnej mierke s uzamknutím natočenia a kontrolou osí (D-184 a dodatok): natočenie ďalej ako
 * 0,5° od povoleného = sklz na čiarach, ktoré v modeli nie sú (rozvody TZB, šrafy), posun sa doladí pri pevnom
 * natočení; keď štart osi spĺňa a doladenie ich rozbije, ostáva štart (čiary výkresu nie sú konštrukcie).
 */
function refinePlan(pdf: Float64Array, ifc: Float64Array, start: Affine, fixedScale: number | undefined, lock: PlanLock | undefined) {
  let { affine, pairs } = icp(pdf, ifc, start, { fixedScale });
  let lockedFrom: number | undefined;
  let fixedRotation: number | undefined;
  if (lock && fixedScale) {
    const rot = decompose(affine).rotationDeg;
    const near = nearestRotation(rot, lock.rotations);
    if (near.dev > ROTATION_LOCK_DEG) {
      lockedFrom = +rot.toFixed(4);
      fixedRotation = (near.to * Math.PI) / 180;
      ({ affine, pairs } = icp(pdf, ifc, start, { fixedScale, fixedRotation }));
    }
  }
  let rejected: CalibrationResult["icp_rejected"];
  const before = lock?.axes ? checkAxes(start, lock.axes.page, lock.axes.ref) : null;
  if (lock?.axes && before!.ok && before!.matched >= 2) {
    const after = checkAxes(affine, lock.axes.page, lock.axes.ref);
    if (!after.ok) {
      rejected = { reason: "axes", axes_median_mm: after.median_mm };
      affine = start;
      pairs = 0;
      lockedFrom = undefined;
      fixedRotation = (decompose(start).rotationDeg * Math.PI) / 180;
    }
  }
  return { affine, pairs, lockedFrom, fixedRotation, rejected };
}

function finish(
  pdf: Float64Array,
  ifc: Float64Array,
  start: Affine,
  mirror: boolean,
  startInfo: CalibrationResult["start"],
  anchors: P2[],
  fixedScale?: number,
  lock?: PlanLock,
): CalibrationResult {
  let affine: Affine;
  let pairs: number;
  let lockedFrom: number | undefined;
  let fixedRotation: number | undefined;
  let rejected: CalibrationResult["icp_rejected"];
  if (lock) ({ affine, pairs, lockedFrom, fixedRotation, rejected } = refinePlan(pdf, ifc, start, fixedScale, lock));
  else ({ affine, pairs } = icp(pdf, ifc, start, { mirror, fixedScale }));
  const { scale, rotationDeg, mirrored } = decompose(affine);
  const xs = anchors.map((p) => p[0]);
  const left = anchors[xs.indexOf(Math.min(...xs))];
  const right = anchors[xs.indexOf(Math.max(...xs))];
  return {
    affine,
    scale_m_per_pt: +scale.toPrecision(8),
    scale_ratio: +(scale / PT_M).toFixed(2),
    rotation_deg: +rotationDeg.toFixed(4),
    mirrored,
    start: startInfo,
    icp_pairs: pairs,
    quality: quality(pdf, ifc, affine),
    // Bez doladenia (ICP zamietnuté) sa krížová validácia nedá urobiť: polovice by ICP znova odtiahlo.
    cross_validation_max_mm: rejected ? NaN : crossValidate(pdf, ifc, affine, mirror, fixedScale, fixedRotation),
    calibration: [left, right].map((p) => ({ pdf_pt: p, plane_m: applyAffine(affine, p) })),
    ...(lockedFrom !== undefined ? { rotation_locked_from_deg: lockedFrom } : {}),
    ...(rejected ? { icp_rejected: rejected } : {}),
  };
}

function medianResidualMm(m: Affine, P: P2[], Q: P2[]): number {
  const r = P.map((p, i) => {
    const q = applyAffine(m, p);
    return Math.hypot(q[0] - Q[i][0], q[1] - Q[i][1]);
  }).sort((a, b) => a - b);
  return Math.round(quantile(r, 0.5) * 1000);
}

export class CalibrationError extends Error {}

export interface PlanInput {
  pageSize: P2;
  blocks: PageBlock[];
  lines: PageLine[];
  /** Priestory podlažia: Name (číslo miestnosti, ako na výkrese) a ťažisko v IFC (X, Y). */
  spaces: { name: string; centroid: P2 }[];
  /** Rez modelu vo výške pôdorysného rezu, (u, v) = IFC (X, Y). */
  cut: Seg[];
  /** Pevná mierka výkresu 1:N (parameter alebo text strany): štart aj ICP ju držia. */
  scale?: number;
  /**
   * Osi (gridy): rady osí tejto strany v bodoch strany a polohy osí z iných kalibrovaných výkresov (IFC). `gridDeg` =
   * natočenie siete osí na strane z radov bublín (D-184 dodatok), keď sieť nie je v smere strany (SF.01: 19°).
   */
  axes?: { page: AxisLine[]; ref: RefAxis[]; gridDeg?: number };
}

/** Pri pevnej mierke a menej popiskoch ako toľko sa porovná aj štart skenovaním (strecha 4NP: 3 popisky, zlý štart). */
const WEAK_LABELS = 4;
/** Pokrytie rezu modelu po ICP zo štartu z popiskov, pod ktorým súťaží aj sken a osi (SF.01: 5 popiskov, pokrytie 0,03). */
const LOW_COVERAGE = 0.3;

// ─── Osi (gridy) ─────────────────────────────────────────────────────────────

/** Os na strane: čiara medzi dvojicou rovnakých popiskov v rade osí (body strany, vľavo dole). */
export interface AxisLine {
  text: string;
  a: P2;
  b: P2;
}

/** Poloha osi v IFC z kalibrovaných výkresov: dir x = os je rovina X = at, dir y = rovina Y = at. */
export interface RefAxis {
  text: string;
  dir: "x" | "y";
  at: number;
  /** Z koľkých výkresov (strán, výrezov) poloha je. */
  sheets: number;
}

/** Os po transformácii `m`: smer podľa väčšieho rozmeru obrazu, poloha = priemer kolmej súradnice. */
export function axisInModel(m: Affine, l: { a: P2; b: P2 }): { dir: "x" | "y"; at: number } {
  const a = applyAffine(m, l.a);
  const b = applyAffine(m, l.b);
  return Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]) ? { dir: "x", at: (a[0] + b[0]) / 2 } : { dir: "y", at: (a[1] + b[1]) / 2 };
}

/** Osi z viacerých výkresov: medián polohy podľa popisku a smeru; popisok s rozptylom nad 0,3 m (iný grid) preč. */
export function mergeRefAxes(perSheet: { text: string; dir: "x" | "y"; at: number }[][]): RefAxis[] {
  const by = new Map<string, number[]>();
  for (const sheet of perSheet) {
    for (const x of sheet) {
      const k = `${x.dir}|${x.text}`;
      by.set(k, [...(by.get(k) ?? []), x.at]);
    }
  }
  const out: RefAxis[] = [];
  for (const [k, ats] of by) {
    const [dir, text] = k.split("|") as ["x" | "y", string];
    const med = median(ats);
    const near = ats.filter((v) => Math.abs(v - med) <= 0.3);
    if (near.length * 2 <= ats.length) continue;
    out.push({ text, dir, at: Math.round(median(near) * 1000) / 1000, sheets: near.length });
  }
  return out.sort((x, y) => (x.dir === y.dir ? x.at - y.at : x.dir < y.dir ? -1 : 1));
}

/** Posun osí pri danom lineárnom zobrazení: rozdiely ref - obraz, oddelene pre osi X a Y. */
function axisDiffs(m: Affine, lines: AxisLine[], refs: RefAxis[]): { text: string; dir: "x" | "y"; d: number }[] {
  const out: { text: string; dir: "x" | "y"; d: number }[] = [];
  for (const l of lines) {
    const got = axisInModel(m, l);
    const r = refs.find((x) => x.text === l.text && x.dir === got.dir);
    if (r) out.push({ text: l.text, dir: got.dir, d: r.at - got.at });
  }
  return out;
}

/**
 * Štart pôdorysu z osí (gridov): pri pevnej mierke pre natočenie 0, 90, 180 a 270° posun z popiskov osí strany
 * spárovaných s polohou rovnakých osí na iných kalibrovaných výkresoch. Natočenie vyberie zhoda smeru (os A je
 * na modeli rovina X) a počet osí do 0,5 m od mediánu; treba aspoň jednu os v každom smere a spolu 3.
 */
export function axisStart(lines: AxisLine[], refs: RefAxis[], s: number, rotationsDeg: number[] = [0, 90, 180, -90]): { affine: Affine; rotation: number; matched: number } | null {
  let best: { affine: Affine; rotation: number; matched: number; spread: number } | null = null;
  for (const rot of rotationsDeg) {
    const base = rotationAffine(s, rot);
    const diffs = axisDiffs(base, lines, refs);
    const xs = diffs.filter((x) => x.dir === "x").map((x) => x.d);
    const ys = diffs.filter((x) => x.dir === "y").map((x) => x.d);
    if (!xs.length || !ys.length) continue;
    const ix = xs.filter((v) => Math.abs(v - median(xs)) <= 0.5);
    const iy = ys.filter((v) => Math.abs(v - median(ys)) <= 0.5);
    const matched = ix.length + iy.length;
    if (matched < 3) continue;
    const tx = median(ix);
    const ty = median(iy);
    const spread = [...ix.map((v) => Math.abs(v - tx)), ...iy.map((v) => Math.abs(v - ty))].reduce((acc, v) => acc + v, 0);
    if (best && (matched < best.matched || (matched === best.matched && spread >= best.spread))) continue;
    const m = rotationAffine(s, rot);
    m[2] = tx;
    m[5] = ty;
    best = { affine: m, rotation: rot, matched, spread };
  }
  return best && { affine: best.affine, rotation: best.rotation, matched: best.matched };
}

/** Najväčší medián odchýlky osí (mm) od polôh z iných výkresov, nad ktorým je kalibrácia podozrivá. */
export const AXES_TOLERANCE_MM = 150;

export interface AxesCheck {
  /** Osi strany spárované s osami iných výkresov (rovnaký popisok a smer). */
  matched: number;
  median_mm: number | null;
  max_mm: number | null;
  /** false = osi výkresu nesedia s osami iných výkresov (posun o pole, zlé natočenie). */
  ok: boolean;
  axes: { text: string; dir: "x" | "y"; dev_mm: number }[];
}

/** Kontrola osí: poloha osí strany po kalibrácii voči polohe tých istých osí z iných kalibrovaných výkresov. */
export function checkAxes(m: Affine, lines: AxisLine[], refs: RefAxis[]): AxesCheck {
  const diffs = axisDiffs(m, lines, refs).map((x) => ({ text: x.text, dir: x.dir, dev_mm: Math.round(Math.abs(x.d) * 1000) }));
  const devs = diffs.map((x) => x.dev_mm).sort((a, b) => a - b);
  const med = devs.length ? quantile(devs, 0.5) : null;
  return {
    matched: diffs.length,
    median_mm: med,
    max_mm: devs.length ? devs[devs.length - 1] : null,
    ok: diffs.length < 2 || med! <= AXES_TOLERANCE_MM,
    axes: diffs,
  };
}

/**
 * Pôdorys: popisky miestností -> RANSAC, potom ICP na rez stien. Bez popiskov (strecha, základy, strop, PBR) pri
 * známej mierke štart skenovaním (D-180) a z osí iných výkresov; pri slabom štarte z popiskov (málo popiskov,
 * nízke pokrytie) súťažia všetky štarty. Víťaz: sedia osi s inými výkresmi, potom pokrytie rezu, potom medián.
 */
export function calibratePlan(input: PlanInput): CalibrationResult {
  const byName = new Map(input.spaces.filter((s) => s.name).map((s) => [s.name.trim(), s.centroid]));
  const cands: LabelCandidate[] = [];
  for (const b of input.blocks) {
    const model = byName.get(b.t.trim());
    if (model) cands.push({ name: b.t.trim(), page: blockCenter(b, input.pageSize), model });
  }
  const fixed = input.scale ? input.scale * PT_M : undefined;
  const found = new Set(cands.map((c) => c.name)).size;
  const start = ransacLabels(cands, 1.5, 50, fixed);
  const pdf = linesToPoints(input.lines);
  const ifc = samplePoints(input.cut, IFC_STEP_M);
  const labelsInfo = start
    ? {
        method: "room_labels" as const,
        points: start.inliers.length,
        median_mm: medianResidualMm(
          start.affine,
          start.inliers.map((c) => c.page),
          start.inliers.map((c) => c.model),
        ),
        labels_found: found,
      }
    : null;
  const rotations = input.axes?.gridDeg !== undefined ? gridRotations(input.axes.gridDeg) : [0, 90, 180, -90];
  const lock: PlanLock | undefined = fixed ? { rotations, axes: input.axes } : undefined;
  if (start && (!fixed || start.inliers.length >= WEAK_LABELS)) {
    const res = finish(pdf, ifc, start.affine, false, labelsInfo!, start.inliers.map((c) => c.page), fixed, lock);
    const axesOk = !input.axes || checkAxes(res.affine, input.axes.page, input.axes.ref).ok;
    if (!fixed || (res.quality.coverage >= LOW_COVERAGE && axesOk)) return res;
  }
  if (!fixed) {
    throw new CalibrationError(
      `Na strane je ${found} popiskov miestností zhodných s IfcSpace Name; treba aspoň 3 konzistentné, alebo mierku výkresu (text MERÍTKO 1 : N na strane alebo parameter scale), vtedy stačia 2 popisky alebo štart skenovaním bez popiskov (alebo mode=manual s dvojicami bodov).`,
    );
  }
  if (pdf.length === 0 || ifc.length === 0) throw new CalibrationError("Pôdorys bez popiskov: strana alebo rez modelu nemá čiary, sken posunu nemá s čím porovnať.");
  const scans = scanPlanStarts(pdf, ifc, fixed);
  const options: { affine: Affine; info: CalibrationResult["start"]; anchors: P2[] }[] = [];
  const anchors = spreadAnchors(pdf);
  const fromAxes = input.axes ? axisStart(input.axes.page, input.axes.ref, fixed, rotations) : null;
  if (fromAxes) {
    options.push({ affine: fromAxes.affine, info: { method: "plan_axes", points: 0, median_mm: null, labels_found: found, axes_matched: fromAxes.matched }, anchors });
  }
  for (const c of scans) {
    options.push({
      affine: c.affine,
      info: { method: "plan_scan", points: 0, median_mm: null, labels_found: found, scan: { rotation_deg: c.rotation, candidates: scans.length, score: +c.score.toFixed(4), labels_tried: !!start } },
      anchors,
    });
  }
  if (start) options.push({ affine: start.affine, info: labelsInfo!, anchors: start.inliers.map((c) => c.page) });
  if (options.length === 0) throw new CalibrationError("Pôdorys bez popiskov: sken posunu nenašiel polohu, kde by sa čiary strany prekrývali s rezom modelu.");
  const compared = [...new Set(options.map((o) => o.info.method))];
  // Víťaz po ICP: osi sedia s inými výkresmi, potom najväčšie pokrytie rezu modelu čiarami strany, pri zhode menší medián.
  // Osi: 2 = sedia (aspoň 2 spárované), 1 = nič sa nespárovalo (kontrola nemá čo povedať), 0 = nesedia; overené osi
  // predbehnú neoverené (sken natočený mimo siete osí nespáruje žiadnu os a inak by vyhral pokrytím, SF.01 1NP).
  let best: { o: (typeof options)[number]; ok: number; cov: number; med: number } | null = null;
  for (const o of options) {
    const { affine } = refinePlan(pdf, ifc, o.affine, fixed, lock);
    const q = quality(pdf, ifc, affine);
    const med = Number.isFinite(q.median_mm) ? q.median_mm : Infinity;
    const ax = input.axes ? checkAxes(affine, input.axes.page, input.axes.ref) : null;
    const ok = !ax ? 2 : !ax.ok ? 0 : ax.matched >= 2 ? 2 : 1;
    const better =
      !best ||
      ok > best.ok ||
      (ok === best.ok && (q.coverage > best.cov + 0.01 || (Math.abs(q.coverage - best.cov) <= 0.01 && med < best.med)));
    if (better) best = { o, ok, cov: q.coverage, med };
  }
  return finish(pdf, ifc, best!.o.affine, false, { ...best!.o.info, compared }, best!.o.anchors, fixed, lock);
}

/** Dva vzdialené body strany (10. a 90. percentil x pri mediáne y) na ručnú úpravu v paneli. */
function spreadAnchors(pdf: Float64Array): P2[] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < pdf.length; i += 2) {
    xs.push(pdf[i]);
    ys.push(pdf[i + 1]);
  }
  xs.sort((a, b) => a - b);
  const y = median(ys);
  return [[quantile(xs, 0.1), y], [quantile(xs, 0.9), y]];
}

/** Obsadené bunky mriežky (kľúč "i,j" -> počet bodov) pre body už v metroch. */
function cellCounts(pts: Float64Array, cell: number): { i: Int32Array; j: Int32Array; w: Float64Array; total: number } {
  const m = new Map<number, [number, number, number]>();
  for (let k = 0; k < pts.length; k += 2) {
    const i = Math.floor(pts[k] / cell);
    const j = Math.floor(pts[k + 1] / cell);
    const key = (i + 1_000_000) * 2_000_003 + (j + 1_000_000);
    const c = m.get(key);
    if (c) c[2]++;
    else m.set(key, [i, j, 1]);
  }
  const n = m.size;
  const out = { i: new Int32Array(n), j: new Int32Array(n), w: new Float64Array(n), total: pts.length / 2 };
  let k = 0;
  for (const [i, j, w] of m.values()) {
    out.i[k] = i;
    out.j[k] = j;
    out.w[k++] = w;
  }
  return out;
}

/** Raster obsadených buniek rozšírený o `dilate` buniek na každú stranu. */
function occupancy(c: ReturnType<typeof cellCounts>, dilate: number): { i0: number; j0: number; ni: number; nj: number; occ: Uint8Array } {
  let i0 = Infinity;
  let j0 = Infinity;
  let i1 = -Infinity;
  let j1 = -Infinity;
  for (let k = 0; k < c.i.length; k++) {
    i0 = Math.min(i0, c.i[k]);
    i1 = Math.max(i1, c.i[k]);
    j0 = Math.min(j0, c.j[k]);
    j1 = Math.max(j1, c.j[k]);
  }
  i0 -= dilate;
  j0 -= dilate;
  const ni = i1 + dilate - i0 + 1;
  const nj = j1 + dilate - j0 + 1;
  const occ = new Uint8Array(ni * nj);
  for (let k = 0; k < c.i.length; k++) {
    for (let di = -dilate; di <= dilate; di++) {
      for (let dj = -dilate; dj <= dilate; dj++) occ[(c.i[k] + di - i0) * nj + (c.j[k] + dj - j0)] = 1;
    }
  }
  return { i0, j0, ni, nj, occ };
}

/** Podiel váhy buniek `a` posunutých o (ti, tj), ktoré padnú do rastra `b`. */
function hitShare(a: ReturnType<typeof cellCounts>, b: ReturnType<typeof occupancy>, ti: number, tj: number): number {
  let hit = 0;
  for (let k = 0; k < a.i.length; k++) {
    const i = a.i[k] + ti - b.i0;
    const j = a.j[k] + tj - b.j0;
    if (i >= 0 && j >= 0 && i < b.ni && j < b.nj && b.occ[i * b.nj + j]) hit += a.w[k];
  }
  return hit / a.total;
}

/** Natočenie o `deg` stupňov: podobnosť s mierkou `s` bez posunu (násobky 90° presne, bez zaokrúhlenia sin a cos). */
export function rotationAffine(s: number, deg: number): Affine {
  const q = deg / 90;
  if (Number.isInteger(q)) return quarterTurn(s, ((q % 4) + 4) % 4);
  const r = (deg * Math.PI) / 180;
  return [s * Math.cos(r), -s * Math.sin(r), 0, s * Math.sin(r), s * Math.cos(r), 0];
}

/**
 * Natočenia kalibrácie, pri ktorých sieť osí strany natočená o `gridDeg` (smer radu bublín písmen, D-184 dodatok)
 * leží rovnobežne s osami modelu: rad písmen ide po X modelu (dva smery) alebo pri obrátenom poradí po -X.
 * Pri sieti v smere strany sú to 0, 90, 180 a 270°.
 */
export function gridRotations(gridDeg: number): number[] {
  const norm = (d: number) => +((((d % 360) + 540) % 360) - 180).toFixed(3) || 0;
  return [0, 90, 180, 270].map((k) => norm(k - gridDeg));
}

/** Natočenie o k·90°: podobnosť s mierkou `s` bez posunu. */
function quarterTurn(s: number, k: number): Affine {
  const c = [1, 0, -1, 0][k];
  const n = [0, 1, 0, -1][k];
  return [s * c, -s * n, 0, s * n, s * c, 0];
}

/**
 * Štart pôdorysu bez popiskov (D-180): pri pevnej mierke skúša natočenie 0, 90, 180 a 270° a posun najprv po 1 m,
 * potom po 0,25 m okolo najlepších. Skóre = podiel čiar strany pri reze modelu × podiel rezu pod čiarami strany
 * (samotné čiary strany by vyhrali aj pri pečiatke položenej na budovu). Vráti najviac 3 kandidátov, najlepší prvý.
 */
export function scanPlanStarts(pdf: Float64Array, ifc: Float64Array, s: number): { affine: Affine; rotation: number; score: number }[] {
  const coarse: { k: number; ti: number; tj: number; score: number }[] = [];
  const fine = (k: number, C: number) => {
    const src = applyToPoints(quarterTurn(s, k), pdf);
    return { src: cellCounts(src, C), dst: cellCounts(ifc, C) };
  };
  for (let k = 0; k < 4; k++) {
    const { src, dst } = fine(k, 1);
    const occDst = occupancy(dst, 1);
    const occSrc = occupancy(src, 1);
    const found: { ti: number; tj: number; score: number }[] = [];
    // Posun t (bunky): obraz strany + t musí prekryť rez modelu.
    for (let ti = occDst.i0 - (occSrc.i0 + occSrc.ni); ti <= occDst.i0 + occDst.ni - occSrc.i0; ti++) {
      for (let tj = occDst.j0 - (occSrc.j0 + occSrc.nj); tj <= occDst.j0 + occDst.nj - occSrc.j0; tj++) {
        const a = hitShare(src, occDst, ti, tj);
        if (a === 0) continue;
        const score = a * hitShare(dst, occSrc, -ti, -tj);
        found.push({ ti, tj, score });
      }
    }
    found.sort((x, y) => y.score - x.score);
    // Dva najlepší na natočenie, od seba aspoň 3 m (opakované polia osí dajú vedľajšie vrcholy).
    const keep: typeof found = [];
    for (const f of found) {
      if (keep.length >= 2) break;
      if (keep.every((q) => Math.max(Math.abs(q.ti - f.ti), Math.abs(q.tj - f.tj)) >= 3)) keep.push(f);
    }
    for (const f of keep) coarse.push({ k, ...f });
  }
  coarse.sort((x, y) => y.score - x.score);
  const out: { affine: Affine; rotation: number; score: number }[] = [];
  const C = 0.25;
  for (const c of coarse.slice(0, 3)) {
    const { src, dst } = fine(c.k, C);
    const occDst = occupancy(dst, 1);
    const occSrc = occupancy(src, 1);
    let best = { ti: c.ti * 4, tj: c.tj * 4, score: -1 };
    for (let ti = c.ti * 4 - 6; ti <= c.ti * 4 + 6; ti++) {
      for (let tj = c.tj * 4 - 6; tj <= c.tj * 4 + 6; tj++) {
        const score = hitShare(src, occDst, ti, tj) * hitShare(dst, occSrc, -ti, -tj);
        if (score > best.score) best = { ti, tj, score };
      }
    }
    const m = quarterTurn(s, c.k);
    m[2] = best.ti * C;
    m[5] = best.tj * C;
    out.push({ affine: m, rotation: [0, 90, 180, -90][c.k], score: best.score });
  }
  return out.sort((x, y) => y.score - x.score);
}

function applyToPoints(m: Affine, pts: Float64Array): Float64Array {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = m[0] * pts[i] + m[1] * pts[i + 1] + m[2];
    out[i + 1] = m[3] * pts[i] + m[4] * pts[i + 1] + m[5];
  }
  return out;
}

export interface SectionInput {
  pageSize: P2;
  blocks: PageBlock[];
  lines: PageLine[];
  /** Poloha osí po smere u (m), kľúč = popisok osi na výkrese (`1`, `A`); bez nich sken. */
  axes?: Record<string, number>;
  /** Rez modelu rovinou pohľadu, (u, v) = (po reze, výška Z). */
  cut: Seg[];
  /** Pevná mierka výkresu 1:N (parameter alebo text strany); kóty potom určia len výšku. */
  scale?: number;
  /** Výšky podlaží modelu (IfcBuildingStorey.Elevation v IFC Z, m): kóty sa s nimi spárujú (D-179). */
  storeys?: number[];
}

/** Zhoda kóty s výškou podlažia (m): kóty sú na mm, výška z parsera tiež. */
const STOREY_TOL_M = 0.005;

/**
 * Posun kót voči IFC Z (D-179): ±0,000 nemusí byť IFC Z = 0. Kandidáti sú rozdiely výška podlažia -
 * kóta, vyhrá posun, pri ktorom najviac podlaží má kótu (aspoň 2), pri zhode menší posun. Bez
 * spárovania 0 (kóty sú priamo v IFC Z, ako doteraz).
 */
export function levelOffset(values: number[], storeys: number[]): { offset: number; matched: number } {
  const uniq = [...new Set(values.map((v) => Math.round(v * 1000)))].map((v) => v / 1000);
  let best = { offset: 0, matched: 0 };
  const score = (d: number) => storeys.filter((e) => uniq.some((v) => Math.abs(v + d - e) < STOREY_TOL_M)).length;
  const zero = score(0);
  if (zero > 0) best = { offset: 0, matched: zero };
  for (const e of storeys) {
    for (const v of uniq) {
      const d = Math.round((e - v) * 1000) / 1000;
      const n = score(d);
      if (n > best.matched || (n === best.matched && n > 0 && Math.abs(d) < Math.abs(best.offset))) best = { offset: d, matched: n };
    }
  }
  return best.matched >= 2 ? best : { offset: 0, matched: zero };
}

/** Rez: výškové kóty -> mierka a výška, osi (alebo sken) -> posun a smer pohľadu, potom ICP. */
export function calibrateSection(input: SectionInput): CalibrationResult {
  const H = input.pageSize[1];
  // Kóta: hodnota proti spodku textu (text stojí nad čiarou úrovne, stály posun dorovná ICP).
  const levels: P2[] = [];
  for (const b of input.blocks) {
    const v = parseLevel(b.t);
    if (v !== null) levels.push([(1 - (b.y + b.h) / 100) * H, v]);
  }
  if (levels.length < 3) throw new CalibrationError(`Na strane sú ${levels.length} výškové kóty; treba aspoň 3 (alebo mode=manual).`);
  const lv = levelOffset(
    levels.map(([, v]) => v),
    input.storeys ?? [],
  );
  if (lv.offset !== 0) for (const l of levels) l[1] += lv.offset;
  const levelsInfo = { found: levels.length, storeys_matched: lv.matched, offset_m: lv.offset };
  let [s, z0] = lineFit(levels);
  const close = levels.filter(([y, v]) => Math.abs(v - (s * y + z0)) < 0.3);
  if (close.length >= 3) [s, z0] = lineFit(close);
  const fixed = input.scale ? input.scale * PT_M : undefined;
  if (fixed) {
    s = fixed;
    const used = close.length >= 3 ? close : levels;
    z0 = used.reduce((a, [y, v]) => a + (v - s * y), 0) / used.length;
  }
  if (!(s > 0)) throw new CalibrationError("Výškové kóty nedávajú kladnú mierku (strana otočená?).");

  const pdf = linesToPoints(input.lines);
  const ifc = samplePoints(input.cut, IFC_STEP_M);
  const axes: P2[] = [];
  for (const b of input.blocks) {
    const h = input.axes?.[b.t.trim()];
    if (h !== undefined) axes.push([blockCenter(b, input.pageSize)[0], h]);
  }
  const anchorY = median(levels.map(([y]) => y));
  if (axes.length >= 2) {
    let best: { res: number; sign: 1 | -1; t: number } | null = null;
    for (const sign of [1, -1] as const) {
      const t = median(axes.map(([x, h]) => h - sign * s * x));
      const res = median(axes.map(([x, h]) => Math.abs(h - (sign * s * x + t))));
      if (!best || res < best.res) best = { res, sign, t };
    }
    const start: Affine = [best!.sign * s, 0, best!.t, 0, s, z0];
    const anchors = axes.map(([x]): P2 => [x, anchorY]);
    return finish(
      pdf,
      ifc,
      start,
      best!.sign < 0,
      { method: "levels_axes", points: levels.length + axes.length, median_mm: Math.round(best!.res * 1000), levels: levelsInfo, axes_matched: axes.length },
      anchors,
      fixed,
    );
  }
  // Bez osí: vodorovný posun a smer pohľadu skenovaním (najviac bodov PDF pri reze IFC).
  const scan = scanOffset(pdf, ifc, s, z0);
  if (!scan) throw new CalibrationError("Rez: bez osí sa nepodarilo nájsť vodorovný posun (čiary PDF sa s rezom modelu neprekrývajú).");
  const start: Affine = [scan.sign * s, 0, scan.t, 0, s, z0];
  const xs: number[] = [];
  for (let i = 0; i < pdf.length; i += 2) xs.push(pdf[i]);
  xs.sort((a, b) => a - b);
  const anchors: P2[] = [[quantile(xs, 0.1), anchorY], [quantile(xs, 0.9), anchorY]];
  return finish(pdf, ifc, start, scan.sign < 0, { method: "levels_scan", points: levels.length, median_mm: null, levels: levelsInfo }, anchors, fixed);
}

/**
 * Vodorovný posun rezu bez osí: pri známej mierke a výške (kóty) skúša posun po 0,25 m a
 * oba smery pohľadu, vyhrá ten s najviac bodmi PDF do 0,2 m od rezu IFC.
 */
function scanOffset(pdf: Float64Array, ifc: Float64Array, s: number, z0: number): { sign: 1 | -1; t: number } | null {
  const src = decimate(pdf, 16);
  const grid = new PointGrid(decimate(ifc, 2), 0.2);
  const [u0, , u1] = bounds(ifc, 0);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < src.length; i += 2) {
    x0 = Math.min(x0, src[i]);
    x1 = Math.max(x1, src[i]);
  }
  let best: { sign: 1 | -1; t: number; n: number } | null = null;
  for (const sign of [1, -1] as const) {
    // Obraz strany [sign·s·x0, sign·s·x1] + t musí prekryť rez [u0, u1].
    const a = Math.min(sign * s * x0, sign * s * x1);
    const b = Math.max(sign * s * x0, sign * s * x1);
    for (let t = u0 - b; t <= u1 - a; t += 0.25) {
      let n = 0;
      for (let i = 0; i < src.length; i += 2) {
        if (grid.nearest(sign * s * src[i] + t, s * src[i + 1] + z0)[0] >= 0) n++;
      }
      if (!best || n > best.n) best = { sign, t, n };
    }
  }
  return best && best.n > 0 ? { sign: best.sign, t: best.t } : null;
}

/** Ručné dvojice (strana -> rovina), voliteľne doladené ICP. */
export function calibratePairs(
  pairs: { pdf_pt: P2; plane_m: P2 }[],
  refine?: { lines: PageLine[]; cut: Seg[]; mirror: boolean },
  mirror = refine?.mirror ?? false,
  ratio?: number,
): CalibrationResult {
  if (pairs.length < 2) throw new CalibrationError("mode=manual potrebuje aspoň 2 dvojice bodov.");
  const P = pairs.map((p) => p.pdf_pt);
  const Q = pairs.map((p) => p.plane_m);
  const fixed = ratio ? ratio * PT_M : undefined;
  const start = fitSimilarity(P, Q, mirror, fixed);
  if (!start) throw new CalibrationError("Dvojice bodov sú zhodné, podobnosť sa nedá určiť.");
  const info = { method: "pairs" as const, points: P.length, median_mm: pairs.length > 2 ? medianResidualMm(start, P, Q) : null };
  if (refine) return finish(linesToPoints(refine.lines), samplePoints(refine.cut, IFC_STEP_M), start, mirror, info, P, fixed);
  const { scale, rotationDeg, mirrored } = decompose(start);
  return {
    affine: start,
    scale_m_per_pt: +scale.toPrecision(8),
    scale_ratio: +(scale / PT_M).toFixed(2),
    rotation_deg: +rotationDeg.toFixed(4),
    mirrored,
    start: info,
    icp_pairs: 0,
    quality: { median_mm: info.median_mm ?? NaN, p90_mm: NaN, coverage: 0 },
    cross_validation_max_mm: NaN,
    calibration: pairs.slice(0, 2).map((p) => ({ pdf_pt: p.pdf_pt, plane_m: applyAffine(start, p.pdf_pt) })),
  };
}

function median(v: number[]): number {
  return quantile([...v].sort((a, b) => a - b), 0.5);
}

/** Priamka v = s·y + b najmenšími štvorcami. */
function lineFit(pts: P2[]): [number, number] {
  const n = pts.length;
  const my = pts.reduce((a, p) => a + p[0], 0) / n;
  const mv = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [y, v] of pts) {
    num += (y - my) * (v - mv);
    den += (y - my) * (y - my);
  }
  const s = den > 0 ? num / den : 0;
  return [s, mv - s * my];
}
