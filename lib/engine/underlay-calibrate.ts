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
  constructor(private readonly mirror: boolean) {}
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
    const a = (this.pq - n * (mpx * mqx + mpy * mqy)) / N;
    const b = (this.pxq - n * (mpx * mqy - mpy * mqx)) / N;
    const f = this.mirror ? -1 : 1;
    // s·R = [[a, -b], [b, a]]; s·R·F = [[f·a, -b], [f·b, a]].
    const m: Affine = [f * a, -b, 0, f * b, a, 0];
    m[2] = mqx - (a * mpx - b * mpy);
    m[5] = mqy - (b * mpx + a * mpy);
    return m;
  }
}

/** Podobnosť najmenších štvorcov z dvojíc (bez zrkadla, alebo so zrkadlom osi u). */
export function fitSimilarity(P: P2[], Q: P2[], mirror = false): Affine | null {
  const s = new PairSums(mirror);
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
export function ransacLabels(cands: LabelCandidate[], tol = 1.5, minPagePt = 50): { affine: Affine; inliers: LabelCandidate[] } | null {
  let best: { n: number; sum: number; idx: number[] } | null = null;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      if (cands[i].name === cands[j].name) continue;
      if (Math.hypot(cands[i].page[0] - cands[j].page[0], cands[i].page[1] - cands[j].page[1]) < minPagePt) continue;
      const m = fitSimilarity([cands[i].page, cands[j].page], [cands[i].model, cands[j].model]);
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
  if (!best || best.n < 3) return null;
  const inliers = best.idx.map((k) => cands[k]);
  const affine = fitSimilarity(
    inliers.map((c) => c.page),
    inliers.map((c) => c.model),
  );
  return affine ? { affine, inliers } : null;
}

// ─── ICP ─────────────────────────────────────────────────────────────────────

export interface IcpOptions {
  mirror?: boolean;
  /** Len body PDF, ktorých obraz (u, v) prejde filtrom (krížová validácia). */
  keep?: (u: number, v: number) => boolean;
  thresholds?: number[];
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
      const sums = new PairSums(opts.mirror ?? false);
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
export function crossValidate(pdf: Float64Array, ifc: Float64Array, full: Affine, mirror: boolean): number {
  const inv = invertAffine(full);
  let worst = 0;
  for (const axis of [0, 1]) {
    const vals: number[] = [];
    for (let i = axis; i < ifc.length; i += 2) vals.push(ifc[i]);
    vals.sort((a, b) => a - b);
    const mid = quantile(vals, 0.5);
    for (const side of [-1, 1]) {
      const inFit = (u: number, v: number) => side * ((axis === 0 ? u : v) - mid) < 0;
      const half = icp(pdf, ifc, full, { mirror, keep: inFit, thresholds: CV_THRESHOLDS }).affine;
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
  start: { method: "room_labels" | "levels_axes" | "levels_scan" | "pairs"; points: number; median_mm: number | null };
  icp_pairs: number;
  quality: Quality;
  cross_validation_max_mm: number;
  /** Dva vzdialené body (strana -> rovina) pre ručnú úpravu v paneli Underlays. */
  calibration: { pdf_pt: P2; plane_m: P2 }[];
}

function linesToPoints(lines: PageLine[]): Float64Array {
  return samplePoints(lines, PDF_STEP_PT);
}

function finish(
  pdf: Float64Array,
  ifc: Float64Array,
  start: Affine,
  mirror: boolean,
  startInfo: CalibrationResult["start"],
  anchors: P2[],
): CalibrationResult {
  const { affine, pairs } = icp(pdf, ifc, start, { mirror });
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
    cross_validation_max_mm: crossValidate(pdf, ifc, affine, mirror),
    calibration: [left, right].map((p) => ({ pdf_pt: p, plane_m: applyAffine(affine, p) })),
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
}

/** Pôdorys: popisky miestností -> RANSAC, potom ICP na rez stien. */
export function calibratePlan(input: PlanInput): CalibrationResult {
  const byName = new Map(input.spaces.filter((s) => s.name).map((s) => [s.name.trim(), s.centroid]));
  const cands: LabelCandidate[] = [];
  for (const b of input.blocks) {
    const model = byName.get(b.t.trim());
    if (model) cands.push({ name: b.t.trim(), page: blockCenter(b, input.pageSize), model });
  }
  const start = ransacLabels(cands);
  if (!start) {
    throw new CalibrationError(
      `Na strane je ${new Set(cands.map((c) => c.name)).size} popiskov miestností zhodných s IfcSpace Name; treba aspoň 3 konzistentné (alebo mode=manual s dvojicami bodov).`,
    );
  }
  const pdf = linesToPoints(input.lines);
  const ifc = samplePoints(input.cut, IFC_STEP_M);
  const P = start.inliers.map((c) => c.page);
  return finish(
    pdf,
    ifc,
    start.affine,
    false,
    { method: "room_labels", points: P.length, median_mm: medianResidualMm(start.affine, P, start.inliers.map((c) => c.model)) },
    P,
  );
}

export interface SectionInput {
  pageSize: P2;
  blocks: PageBlock[];
  lines: PageLine[];
  /** Poloha osí po smere u (m), kľúč = popisok osi na výkrese (`1`, `A`); bez nich sken. */
  axes?: Record<string, number>;
  /** Rez modelu rovinou pohľadu, (u, v) = (po reze, výška Z). */
  cut: Seg[];
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
  let [s, z0] = lineFit(levels);
  const close = levels.filter(([y, v]) => Math.abs(v - (s * y + z0)) < 0.3);
  if (close.length >= 3) [s, z0] = lineFit(close);
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
    return finish(pdf, ifc, start, best!.sign < 0, { method: "levels_axes", points: levels.length + axes.length, median_mm: Math.round(best!.res * 1000) }, anchors);
  }
  // Bez osí: vodorovný posun a smer pohľadu skenovaním (najviac bodov PDF pri reze IFC).
  const scan = scanOffset(pdf, ifc, s, z0);
  if (!scan) throw new CalibrationError("Rez: bez osí sa nepodarilo nájsť vodorovný posun (čiary PDF sa s rezom modelu neprekrývajú).");
  const start: Affine = [scan.sign * s, 0, scan.t, 0, s, z0];
  const xs: number[] = [];
  for (let i = 0; i < pdf.length; i += 2) xs.push(pdf[i]);
  xs.sort((a, b) => a - b);
  const anchors: P2[] = [[quantile(xs, 0.1), anchorY], [quantile(xs, 0.9), anchorY]];
  return finish(pdf, ifc, start, scan.sign < 0, { method: "levels_scan", points: levels.length, median_mm: null }, anchors);
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
): CalibrationResult {
  if (pairs.length < 2) throw new CalibrationError("mode=manual potrebuje aspoň 2 dvojice bodov.");
  const P = pairs.map((p) => p.pdf_pt);
  const Q = pairs.map((p) => p.plane_m);
  const mirror = refine?.mirror ?? false;
  const start = fitSimilarity(P, Q, mirror);
  if (!start) throw new CalibrationError("Dvojice bodov sú zhodné, podobnosť sa nedá určiť.");
  const info = { method: "pairs" as const, points: P.length, median_mm: pairs.length > 2 ? medianResidualMm(start, P, Q) : null };
  if (refine) return finish(linesToPoints(refine.lines), samplePoints(refine.cut, IFC_STEP_M), start, mirror, info, P);
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
