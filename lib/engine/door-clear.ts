import { toIfc, type Vec3 } from "./measure";

/**
 * Clear width and height of a door from geometry (addendum D-118, `ifc_measure clear_opening`).
 * Pset values (`AIM_Door.ClearWidth`, `OverallWidth`) are not the source of truth; the door mesh
 * is measured. The mesher gives each solid of the representation separately (frame, leaf, glass, hardware, threshold):
 * 1. Local door axes from the plan: the rectangle with the smallest area around the convex hull,
 *    longer side = width (u), shorter = depth (v), z up.
 * 2. The opening fill (leaf, glass, sliding panels, handles, grips) is removed, leaving the frame,
 *    lintel, threshold or portal (rules at `fill`).
 * 3. Width: horizontal rays along the u axis through the door centre in a grid of heights x depths. A ray inside
 *    a solid (odd number of intersections on the left) or without a wall on one side (outside the frame
 *    depth) is skipped. At each height the narrowest gap across the depth applies (frame stop),
 *    the result is the median over heights, the narrowest height stays in `width_min_m`.
 * 4. Height: vertical rays from half height at three places of the width, below the threshold or the door
 *    bottom (floor), above the lintel; the lowest across the depth, median across the width.
 * A leaf opened by 90° and a handle are not subtracted from the clear width.
 */

type P2 = [number, number];

/** The narrowest gap we take as a passage (narrower = a joint between leaves). */
const MIN_GAP = 0.2;
const WIDTH_HEIGHTS = 9;
const DEPTHS = 15;
const HEIGHT_COLUMNS = [0.3, 0.5, 0.7];

export interface ClearOpening {
  width_m: number | null;
  height_m: number | null;
  /** The narrowest spot over all heights (handle, strip), if narrower than the median. */
  width_min_m: number | null;
  /** Door envelope in its axes (with the frame). */
  overall_width_m: number;
  overall_height_m: number;
  depth_m: number;
  /** Valid width and height rays from the grid. */
  samples: { width: number; height: number };
  /** Door solids: all of them and the opening fill (leaf, glass, hardware) that is not counted in the measurement. */
  bodies: { total: number; fill: number };
  /** Ends of the measured width and height in IFC (Z up, without the frame offset) for the dimension in the viewer (D-155). */
  segments?: { width?: [Vec3, Vec3]; height?: [Vec3, Vec3] };
}

function cross(o: P2, a: P2, b: P2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull (monotone chain). */
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

/** Rectangle with the smallest area: the width axis (longer side) and the centre. */
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

/** Intersections of a ray parallel to the axis `w` through the point (s0, t0) in the plane (s, t) with triangles. */
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
 * Free gap around `at` between the nearest surfaces, null = inside a solid or open.
 * `floor` = lower bound when there is no surface below `at` (door bottom without a threshold).
 */
export function gapAround(hits: number[], at: number, floor?: number): number | null {
  const span = spanAround(hits, at, floor);
  return span && span[1] - span[0];
}

/** Like `gapAround`, but returns both surfaces [bottom, top] (the ends of the dimension). */
export function spanAround(hits: number[], at: number, floor?: number): [number, number] | null {
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
  return [below, above];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Offset of samples away from round values, so that a ray does not hit an edge between triangles. */
const JITTER = 0.00731;
const frac = (i: number, n: number) => (i + 0.5 + JITTER) / n;

/** Opening fill probes: shares of width and height where in a closed door the leaf is, not the frame. */
const PROBES = [0.3, 0.4, 0.5, 0.6, 0.7];
/** Depth above this share of the width = not a flat door assembly (revolving door). */
const ROUND_DOOR = 0.6;
/** Threshold: a solid at the door bottom lower than this share of the height. */
const SILL = 0.1;

/**
 * Clear door opening from a mesh (Y-up, metres, world coordinates); `parts` = starts of solids
 * in `indices`. Text = the reason why it cannot be measured.
 */
export function clearOpening(positions: Float32Array, indices: Uint32Array, parts: number[] = [0]): ClearOpening | string {
  if (indices.length < 3) return "dvere nemajú geometriu";
  const { center, u, v, bodies, fill, uMin, uMax, vMin, vMax, zMin, zMax } = doorLayout(positions, indices, parts);
  const depth = (j: number) => vMin + (vMax - vMin) * frac(j, DEPTHS);
  const uMid = (uMin + uMax) / 2;
  const zMid = (zMin + zMax) / 2;
  const kept = bodies.filter((_, n) => !fill[n]);
  // Revolving doors and other spatial assemblies have no opening plane.
  if (vMax - vMin > ROUND_DOOR * (uMax - uMin)) return "nie je plochá dverová zostava (napr. karuselové dvere)";
  if (kept.length === 0) return "dvere nemajú zárubňu ani portál oddelený od krídla";
  const tri = new Float64Array(kept.reduce((n, b) => n + b.length, 0));
  kept.reduce((off, b) => (tri.set(b, off), off + b.length), 0);
  // Point in door axes (u, v, z) -> IFC.
  const ifcAt = (pu: number, pv: number, pz: number): Vec3 => [
    center[0] + u[0] * pu + v[0] * pv,
    center[1] + u[1] * pu + v[1] * pv,
    pz,
  ];

  // Width: axis u (0), plane (v, z) = (1, 2); narrowest spot across the depth (frame stop).
  const perHeight: { gap: number; at: [Vec3, Vec3] }[] = [];
  let widthSamples = 0;
  for (let h = 0; h < WIDTH_HEIGHTS; h++) {
    const z = zMin + (zMax - zMin) * (0.1 + 0.8 * frac(h, WIDTH_HEIGHTS));
    let narrowest: { gap: number; at: [Vec3, Vec3] } | null = null;
    for (let j = 0; j < DEPTHS; j++) {
      const s = spanAround(rayHits(tri, 1, 2, 0, depth(j), z), uMid);
      const g = s && s[1] - s[0];
      if (s === null || g === null || g < MIN_GAP) continue;
      widthSamples++;
      if (!narrowest || g < narrowest.gap) narrowest = { gap: g, at: [ifcAt(s[0], depth(j), z), ifcAt(s[1], depth(j), z)] };
    }
    if (narrowest) perHeight.push(narrowest);
  }

  // Height: axis z (2), plane (u, v) = (0, 1); below the threshold, without it the door bottom (floor).
  const perColumn: { gap: number; at: [Vec3, Vec3] }[] = [];
  let heightSamples = 0;
  for (const c of HEIGHT_COLUMNS) {
    const uc = uMin + (uMax - uMin) * (c + JITTER);
    let lowest: { gap: number; at: [Vec3, Vec3] } | null = null;
    for (let j = 0; j < DEPTHS; j++) {
      const s = spanAround(rayHits(tri, 0, 1, 2, uc, depth(j)), zMid, zMin);
      const g = s && s[1] - s[0];
      if (s === null || g === null || g < MIN_GAP) continue;
      heightSamples++;
      if (!lowest || g < lowest.gap) lowest = { gap: g, at: [ifcAt(uc, depth(j), s[0]), ifcAt(uc, depth(j), s[1])] };
    }
    if (lowest) perColumn.push(lowest);
  }

  const width = perHeight.length > 0 ? median(perHeight.map((p) => p.gap)) : null;
  const height = perColumn.length > 0 ? median(perColumn.map((p) => p.gap)) : null;
  const widthMin = perHeight.length > 0 ? Math.min(...perHeight.map((p) => p.gap)) : null;
  // Dimension = the sample nearest to the median (with an even count the median is no sample), on a tie
  // nearer to the centre (width at half height, height at the centre of the width).
  const nearest = (xs: { gap: number; at: [Vec3, Vec3] }[], m: number | null) => {
    if (m === null) return undefined;
    const score = (x: (typeof xs)[number], i: number) => Math.abs(x.gap - m) * 1e3 + Math.abs(i - (xs.length - 1) / 2) * 1e-6;
    return xs.reduce((best, x, i) => (score(x, i) < score(xs[best], best) ? i : best), 0);
  };
  const wi = nearest(perHeight, width);
  const hi = nearest(perColumn, height);
  const wAt = wi === undefined ? undefined : perHeight[wi].at;
  const hAt = hi === undefined ? undefined : perColumn[hi].at;
  return {
    width_m: width === null ? null : round(width),
    height_m: height === null ? null : round(height),
    width_min_m: widthMin !== null && width !== null && widthMin < width - 0.001 ? round(widthMin) : null,
    overall_width_m: round(uMax - uMin),
    overall_height_m: round(zMax - zMin),
    depth_m: round(vMax - vMin),
    samples: { width: widthSamples, height: heightSamples },
    bodies: { total: bodies.length, fill: fill.filter(Boolean).length },
    ...(wAt || hAt ? { segments: { ...(wAt ? { width: wAt } : {}), ...(hAt ? { height: hAt } : {}) } } : {}),
  };
}

/**
 * Door axes, the solids in them and the opening fill mask (leaf, glass, hardware). Shared by the clear opening
 * and the area measurement (D-155), so that a leaf edge is not an "area" of the frame.
 */
export function doorLayout(positions: Float32Array, indices: Uint32Array, parts: number[] = [0]) {
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
  // Triangles in door axes: [u, v, z] per vertex, by solids.
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

  // The frame and lintel reach the side or top of the door envelope, the threshold lies low at the floor.
  // An inner solid is opening fill if it is low (handle, grip, panic bar) or wraps around the
  // centre from all sides (leaf frame with glass); an inner U-shaped portal (lift) stays.
  // Fill is also every solid hit by a ray along the depth in the central part of the opening (leaf,
  // glass, sliding panels). The fill is not counted in the measurement.
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
  return { center, u, v, bodies, fill, uMin, uMax, vMin, vMax, zMin, zMax };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
