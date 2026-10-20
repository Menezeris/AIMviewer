import type { AskAction } from "../llm/actions";
import { measureOp, type MeasureSegment } from "../viewer-measure";

import { toIfc, type MeshElement, type Vec3 } from "./measure";

/**
 * Kóta k `ifc_measure` (D-124): body, medzi ktorými sa meralo, v IFC svete,
 * a príkaz, ktorý ich ukáže v nástroji Measure forku (`MEASURE_SHOW`).
 * Clash engine vracia pri svetlej vzdialenosti stred najkratšej úsečky; jej
 * konce sú najbližšie body každého meshu k tomuto stredu (pre dvojicu
 * s minimom presne tie isté body). Rozmery prvku sú hrany obálky X, Y, Z.
 */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (a: Vec3, d: Vec3, t: number): Vec3 => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];

/** Najbližší bod trojuholníka abc k p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

/** Najbližší bod povrchu meshu k p (rámec meshu); prvok má stovky až tisíce trojuholníkov. */
export function closestOnMesh(e: Pick<MeshElement, "positions" | "indices">, p: Vec3): Vec3 {
  const v = (i: number): Vec3 => [e.positions[i * 3], e.positions[i * 3 + 1], e.positions[i * 3 + 2]];
  let best: Vec3 = v(e.indices[0]);
  let bestD = Infinity;
  for (let t = 0; t + 2 < e.indices.length; t += 3) {
    const q = closestOnTriangle(p, v(e.indices[t]), v(e.indices[t + 1]), v(e.indices[t + 2]));
    const d = sub(q, p);
    const dd = dot(d, d);
    if (dd < bestD) {
      bestD = dd;
      best = q;
    }
  }
  return best;
}

/** Bod meshu (Y hore, posunutý rámec) -> IFC svet (Z hore) cez posun rámca, ktorý zapísal mesher. */
export function toWorld(e: Pick<MeshElement, "worldOffset">, p: readonly number[]): Vec3 {
  const q = toIfc(p);
  const o = e.worldOffset ?? [0, 0, 0];
  return [q[0] + o[0], q[1] + o[1], q[2] + o[2]];
}

const mm = (v: number) => Math.round(v * 1000) / 1000;
const point = (v: Vec3) => ({ x: mm(v[0]), y: mm(v[1]), z: mm(v[2]) });

/** Kóta svetlej vzdialenosti a-b zo stredu najkratšej úsečky; prienik a dotyk nemajú čo kótovať. */
export function pairDimension(a: MeshElement, b: MeshElement, mid: Vec3, distance: number): MeasureSegment | null {
  if (!(distance > 1e-4)) return null;
  return { a: point(toWorld(a, closestOnMesh(a, mid))), b: point(toWorld(b, closestOnMesh(b, mid))) };
}

/** Rozmery obálky prvku: tri hrany z rohu s najmenšími súradnicami (X, Y, Z v IFC svete). */
export function sizeDimensions(e: MeshElement): MeasureSegment[] {
  const p = toWorld(e, e.bounds.min);
  const q = toWorld(e, e.bounds.max);
  const lo: Vec3 = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])];
  const hi: Vec3 = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
  return [
    { a: point(lo), b: point([hi[0], lo[1], lo[2]]) },
    { a: point(lo), b: point([lo[0], hi[1], lo[2]]) },
    { a: point(lo), b: point([lo[0], lo[1], hi[2]]) },
  ];
}

/** Príkaz pre živý viewer: kóty nahradia predošlé kóty od hosta (vlastné merania používateľa ostanú). */
export function dimensionAction(segments: readonly MeasureSegment[]): AskAction {
  return {
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(measureOp(segments))}&r=${Date.now().toString(36)}`,
    label: segments.length === 1 ? "Kóta" : `Kóty: ${segments.length}`,
  };
}
