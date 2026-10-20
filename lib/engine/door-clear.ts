import { toIfc } from "./measure";

/**
 * Svetlá šírka a výška dverí z geometrie (dodatok D-118, `ifc_measure clear_opening`).
 * Hodnoty psetov (`AIM_Door.ClearWidth`, `OverallWidth`) nie sú zdroj pravdy; meria sa mesh
 * dverí. Mesher dáva každé teleso reprezentácie zvlášť (zárubňa, krídlo, sklo, kovanie, prah):
 * 1. Lokálne osi dverí z pôdorysu: obdĺžnik s najmenšou plochou okolo konvexného obalu,
 *    dlhšia strana = šírka (u), kratšia = hĺbka (v), z hore.
 * 2. Výplň otvoru (krídlo, sklo, posuvné panely, kľučky, madlá) sa odstráni, ostane zárubňa,
 *    nadpražie, prah alebo portál (pravidlá pri `fill`).
 * 3. Šírka: vodorovné lúče po osi u stredom dverí v mriežke výšok x hĺbok. Lúč vo vnútri
 *    telesa (nepárny počet priesečníkov naľavo) alebo bez steny na jednej strane (mimo hĺbky
 *    zárubne) sa preskočí. Na každej výške platí najužšia medzera cez hĺbku (doraz zárubne),
 *    výsledok je medián výšok, najužšia výška ostáva vo `width_min_m`.
 * 4. Výška: zvislé lúče z polovice výšky na troch miestach šírky, dole prah alebo spodok
 *    dverí (podlaha), hore nadpražie; najnižšia cez hĺbku, medián cez šírku.
 * Krídlo otvorené o 90° a kľučka sa od svetlej šírky neodpočítavajú.
 */

type P2 = [number, number];

/** Najužšia medzera, ktorú berieme ako priechod (užšia = škára medzi krídlami). */
const MIN_GAP = 0.2;
const WIDTH_HEIGHTS = 9;
const DEPTHS = 15;
const HEIGHT_COLUMNS = [0.3, 0.5, 0.7];

export interface ClearOpening {
  width_m: number | null;
  height_m: number | null;
  /** Najužšie miesto zo všetkých výšok (kľučka, lišta), ak je užšie ako medián. */
  width_min_m: number | null;
  /** Obálka dverí v ich osiach (so zárubňou). */
  overall_width_m: number;
  overall_height_m: number;
  depth_m: number;
  /** Platné lúče šírky a výšky z mriežky. */
  samples: { width: number; height: number };
  /** Telesá dverí: všetky a výplň otvoru (krídlo, sklo, kovanie), ktorá sa do merania neráta. */
  bodies: { total: number; fill: number };
}

function cross(o: P2, a: P2, b: P2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Konvexný obal (monotone chain). */
export function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Obdĺžnik s najmenšou plochou: os šírky (dlhšia strana) a stred. */
export function planAxes(points: P2[]): { center: P2; u: P2; v: P2 } {
  const hull = convexHull(points);
  let best = { area: Infinity, center: [0, 0] as P2, u: [1, 0] as P2, v: [0, 1] as P2 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const e1: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const e2: P2 = [-e1[1], e1[0]];
    let [min1, max1, min2, max2] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of hull) {
      const s = p[0] * e1[0] + p[1] * e1[1];
      const t = p[0] * e2[0] + p[1] * e2[1];
      min1 = Math.min(min1, s);
      max1 = Math.max(max1, s);
      min2 = Math.min(min2, t);
      max2 = Math.max(max2, t);
    }
    const area = (max1 - min1) * (max2 - min2);
    if (area < best.area - 1e-12) {
      const s0 = (min1 + max1) / 2;
      const t0 = (min2 + max2) / 2;
      const center: P2 = [s0 * e1[0] + t0 * e2[0], s0 * e1[1] + t0 * e2[1]];
      const wide = max1 - min1 >= max2 - min2;
      best = { area, center, u: wide ? e1 : e2, v: wide ? e2 : [-e1[0], -e1[1]] };
    }
  }
  return { center: best.center, u: best.u, v: best.v };
}

/** Priesečníky lúča rovnobežného s osou `w` cez bod (s0, t0) v rovine (s, t) s trojuholníkmi. */
function rayHits(tri: Float64Array, s: number, t: number, w: number, s0: number, t0: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < tri.length; i += 9) {
    const sa = tri[i + s], ta = tri[i + t];
    const sb = tri[i + 3 + s], tb = tri[i + 3 + t];
    const sc = tri[i + 6 + s], tc = tri[i + 6 + t];
    if (s0 < Math.min(sa, sb, sc) || s0 > Math.max(sa, sb, sc) || t0 < Math.min(ta, tb, tc) || t0 > Math.max(ta, tb, tc)) continue;
    const det = (tb - tc) * (sa - sc) + (sc - sb) * (ta - tc);
    if (Math.abs(det) < 1e-14) continue;
    const l1 = ((tb - tc) * (s0 - sc) + (sc - sb) * (t0 - tc)) / det;
    const l2 = ((tc - ta) * (s0 - sc) + (sa - sc) * (t0 - tc)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    hits.push(l1 * tri[i + w] + l2 * tri[i + 3 + w] + l3 * tri[i + 6 + w]);
  }
  return hits;
}

/**
 * Voľná medzera okolo `at` medzi najbližšími plochami, null = vo vnútri telesa alebo otvorené.
 * `floor` = dolná hranica, keď pod `at` nie je žiadna plocha (spodok dverí bez prahu).
 */
export function gapAround(hits: number[], at: number, floor?: number): number | null {
  let below = -Infinity;
  let above = Infinity;
  let nBelow = 0;
  for (const h of hits) {
    if (h < at) {
      nBelow++;
      if (h > below) below = h;
    } else if (h < above) above = h;
  }
  if (nBelow === 0 && floor !== undefined) below = floor;
  if (nBelow % 2 === 1 || !Number.isFinite(below) || !Number.isFinite(above)) return null;
  return above - below;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Posun vzoriek mimo okrúhlych hodnôt, aby lúč netrafil hranu medzi trojuholníkmi. */
const JITTER = 0.00731;
const frac = (i: number, n: number) => (i + 0.5 + JITTER) / n;

/** Sondy výplne otvoru: podiely šírky a výšky, kde je v zatvorených dverách krídlo, nie zárubňa. */
const PROBES = [0.3, 0.4, 0.5, 0.6, 0.7];
/** Hĺbka nad týmto podielom šírky = nie plochá dverová zostava (karuselové dvere). */
const ROUND_DOOR = 0.6;
/** Prah: teleso pri spodku dverí nižšie ako tento podiel výšky. */
const SILL = 0.1;

/**
 * Svetlý otvor dverí z meshu (Y-up, metre, svetové súradnice); `parts` = začiatky telies
 * v `indices`. Text = dôvod, prečo sa nedá zmerať.
 */
export function clearOpening(positions: Float32Array, indices: Uint32Array, parts: number[] = [0]): ClearOpening | string {
  if (indices.length < 3) return "dvere nemajú geometriu";
  const ifc = new Float64Array(positions.length);
  const plan: P2[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = toIfc([positions[i], positions[i + 1], positions[i + 2]]);
    ifc[i] = x;
    ifc[i + 1] = y;
    ifc[i + 2] = z;
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      plan.push([x, y]);
    }
  }
  const { center, u, v } = planAxes(plan);
  // Trojuholníky v osiach dverí: [u, v, z] na vrchol, po telesách.
  const all = new Float64Array(indices.length * 3);
  let [uMin, uMax, vMin, vMax, zMin, zMax] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k] * 3;
    const dx = ifc[i] - center[0];
    const dy = ifc[i + 1] - center[1];
    const pu = dx * u[0] + dy * u[1];
    const pv = dx * v[0] + dy * v[1];
    const pz = ifc[i + 2];
    all[k * 3] = pu;
    all[k * 3 + 1] = pv;
    all[k * 3 + 2] = pz;
    uMin = Math.min(uMin, pu);
    uMax = Math.max(uMax, pu);
    vMin = Math.min(vMin, pv);
    vMax = Math.max(vMax, pv);
    zMin = Math.min(zMin, pz);
    zMax = Math.max(zMax, pz);
  }
  const bodies = parts.map((s, n) => all.subarray(s * 3, (n + 1 < parts.length ? parts[n + 1] : indices.length) * 3));
  const depth = (j: number) => vMin + (vMax - vMin) * frac(j, DEPTHS);
  const uMid = (uMin + uMax) / 2;
  const zMid = (zMin + zMax) / 2;
  const around = (hits: number[], at: number) => hits.some((h) => h < at) && hits.some((h) => h > at);

  // Zárubňa a nadpražie siahajú na bok alebo vrch obálky dverí, prah leží nízko pri podlahe.
  // Vnútorné teleso je výplň otvoru, ak je nízke (kľučka, madlo, paniková tyč) alebo obopína
  // stred zo všetkých strán (rám krídla so sklom); vnútorný portál v tvare U (výťah) ostáva.
  // Výplň je aj každé teleso, ktoré zasiahne lúč po hĺbke v strednej časti otvoru (krídlo,
  // sklo, posuvné panely). Výplň sa do merania nepočíta.
  const tol = 0.005;
  const fill = bodies.map((b) => {
    if (PROBES.some((pu) => PROBES.some((pz) => rayHits(b, 0, 2, 1, uMin + (uMax - uMin) * (pu + JITTER), zMin + (zMax - zMin) * (pz + JITTER)).length > 0))) return true;
    let [bu0, bu1, bz0, bz1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < b.length; i += 3) {
      bu0 = Math.min(bu0, b[i]);
      bu1 = Math.max(bu1, b[i]);
      bz0 = Math.min(bz0, b[i + 2]);
      bz1 = Math.max(bz1, b[i + 2]);
    }
    const frame = bu0 < uMin + tol || bu1 > uMax - tol || bz1 > zMax - tol;
    const sill = bz0 < zMin + tol && bz1 - bz0 < SILL * (zMax - zMin);
    if (frame || sill) return false;
    if (bz1 - bz0 < 0.5 * (zMax - zMin)) return true;
    for (let j = 0; j < DEPTHS; j++) {
      if (around(rayHits(b, 1, 2, 0, depth(j), zMid), uMid) && around(rayHits(b, 0, 1, 2, uMid, depth(j)), zMid)) return true;
    }
    return false;
  });
  const kept = bodies.filter((_, n) => !fill[n]);
  // Karuselové dvere a iné priestorové zostavy nemajú rovinu otvoru.
  if (vMax - vMin > ROUND_DOOR * (uMax - uMin)) return "nie je plochá dverová zostava (napr. karuselové dvere)";
  if (kept.length === 0) return "dvere nemajú zárubňu ani portál oddelený od krídla";
  const tri = new Float64Array(kept.reduce((n, b) => n + b.length, 0));
  kept.reduce((off, b) => (tri.set(b, off), off + b.length), 0);

  // Šírka: os u (0), rovina (v, z) = (1, 2); najužšie miesto cez hĺbku (doraz zárubne).
  const perHeight: number[] = [];
  let widthSamples = 0;
  for (let h = 0; h < WIDTH_HEIGHTS; h++) {
    const z = zMin + (zMax - zMin) * (0.1 + 0.8 * frac(h, WIDTH_HEIGHTS));
    let narrowest = Infinity;
    for (let j = 0; j < DEPTHS; j++) {
      const g = gapAround(rayHits(tri, 1, 2, 0, depth(j), z), uMid);
      if (g === null || g < MIN_GAP) continue;
      widthSamples++;
      narrowest = Math.min(narrowest, g);
    }
    if (Number.isFinite(narrowest)) perHeight.push(narrowest);
  }

  // Výška: os z (2), rovina (u, v) = (0, 1); dole prah, bez neho spodok dverí (podlaha).
  const perColumn: number[] = [];
  let heightSamples = 0;
  for (const c of HEIGHT_COLUMNS) {
    const uc = uMin + (uMax - uMin) * (c + JITTER);
    let lowest = Infinity;
    for (let j = 0; j < DEPTHS; j++) {
      const g = gapAround(rayHits(tri, 0, 1, 2, uc, depth(j)), zMid, zMin);
      if (g === null || g < MIN_GAP) continue;
      heightSamples++;
      lowest = Math.min(lowest, g);
    }
    if (Number.isFinite(lowest)) perColumn.push(lowest);
  }

  const width = perHeight.length > 0 ? median(perHeight) : null;
  const widthMin = perHeight.length > 0 ? Math.min(...perHeight) : null;
  return {
    width_m: width === null ? null : round(width),
    height_m: perColumn.length > 0 ? round(median(perColumn)) : null,
    width_min_m: widthMin !== null && width !== null && widthMin < width - 0.001 ? round(widthMin) : null,
    overall_width_m: round(uMax - uMin),
    overall_height_m: round(zMax - zMin),
    depth_m: round(vMax - vMin),
    samples: { width: widthSamples, height: heightSamples },
    bodies: { total: bodies.length, fill: fill.filter(Boolean).length },
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
