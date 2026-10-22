import type { MeasureSegment } from "../viewer-measure";

import { doorLayout, planAxes } from "./door-clear";
import { InputError } from "./tools";
import type { MeshElement, Vec3 } from "./measure";
import { toWorld } from "./measure-dimension";

/**
 * `ifc_measure` axis a face_a / face_b (D-155): jedna os prvku a kolmá vzdialenosť
 * dvoch rovnobežných plôch, z meshu v IFC svete (Z hore, m, s posunom rámca).
 * Osi prvku = obdĺžnik s najmenšou plochou v pôdoryse (ako svetlý otvor dverí, D-118):
 * x = width (dlhšia strana), y = depth, z = hore. Smer x je otočený k +X sveta (pri
 * zvislom x k +Y), y je x otočené o 90° proti smeru hodinových ručičiek, aby "+x"
 * znamenalo vždy to isté pri a aj b. Osi z IfcObjectPlacement sú na neskôr.
 */

export type AxisName = "x" | "y" | "z" | "width" | "depth" | "height";
export const AXES: readonly AxisName[] = ["x", "y", "z", "width", "depth", "height"];
const FACE_RE = /^([+-])([xyz])$/;

/** Plocha je kolmá na os, keď normála od osi neodbočí o viac ako 2°. */
const PARALLEL_COS = Math.cos((2 * Math.PI) / 180);
/** Trojuholníky do 1 mm od seba v smere osi = jedna rovina. */
const PLANE_TOL = 0.001;
/** Plochy oproti sebe bližšie ako toto sú škára alebo dotyk telies, nie meraná medzera. */
const MIN_FACING_GAP = 0.005;

export interface ElementAxes {
  /** Stred pôdorysného obdĺžnika v IFC svete (x, y). */
  origin: [number, number];
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
const point = (v: Vec3) => ({ x: round(v[0]), y: round(v[1]), z: round(v[2]) });

/** Vrcholy meshu v IFC svete. */
function worldPositions(e: MeshElement): Float64Array {
  const out = new Float64Array(e.positions.length);
  for (let i = 0; i < e.positions.length; i += 3) {
    const w = toWorld(e, [e.positions[i], e.positions[i + 1], e.positions[i + 2]]);
    out[i] = w[0];
    out[i + 1] = w[1];
    out[i + 2] = w[2];
  }
  return out;
}

export function elementAxes(e: MeshElement): ElementAxes {
  const w = worldPositions(e);
  const plan: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < w.length; i += 3) {
    const key = `${Math.round(w[i] * 1000)},${Math.round(w[i + 1] * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plan.push([w[i], w[i + 1]]);
  }
  const { center, u } = planAxes(plan);
  const flip = u[0] < -1e-9 || (Math.abs(u[0]) <= 1e-9 && u[1] < 0);
  const ux = flip ? -u[0] : u[0];
  const uy = flip ? -u[1] : u[1];
  return { origin: center, x: [ux, uy, 0], y: [-uy, ux, 0], z: [0, 0, 1] };
}

/** Bod IFC sveta -> súradnice v osiach prvku. */
function local(ax: ElementAxes, p: Vec3): Vec3 {
  const dx = p[0] - ax.origin[0];
  const dy = p[1] - ax.origin[1];
  return [dx * ax.x[0] + dy * ax.x[1], dx * ax.y[0] + dy * ax.y[1], p[2]];
}

/** Súradnice v osiach prvku -> IFC svet. */
function world(ax: ElementAxes, l: Vec3): Vec3 {
  return [ax.origin[0] + ax.x[0] * l[0] + ax.y[0] * l[1], ax.origin[1] + ax.x[1] * l[0] + ax.y[1] * l[1], l[2]];
}

/**
 * Jedna os prvku: x/y/z = hrana obálky v osiach IFC sveta, width/depth/height = v osiach
 * prvku. Kóta ide po spodnej prednej hrane, ako jedna z troch hrán `sizeDimensions`.
 */
export function axisDimension(e: MeshElement, axis: AxisName): { axis: AxisName; length_m: number; segment: MeasureSegment } {
  const k = axis === "x" || axis === "width" ? 0 : axis === "y" || axis === "depth" ? 1 : 2;
  const ax: ElementAxes =
    axis === "x" || axis === "y" || axis === "z"
      ? { origin: [0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
      : elementAxes(e);
  const w = worldPositions(e);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < w.length; i += 3) {
    const l = local(ax, [w[i], w[i + 1], w[i + 2]]);
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c], l[c]);
      hi[c] = Math.max(hi[c], l[c]);
    }
  }
  const end: Vec3 = [...lo];
  end[k] = hi[k];
  return { axis, length_m: round(hi[k] - lo[k]), segment: { a: point(world(ax, lo)), b: point(world(ax, end)) } };
}

export interface FacePick {
  sign: 1 | -1;
  axis: 0 | 1 | 2;
  name: string;
}

export function parseFace(raw: unknown, key: string): FacePick {
  const m = typeof raw === "string" ? FACE_RE.exec(raw.trim().toLowerCase()) : null;
  if (!m) throw new InputError(`${key} je smer normály plochy v osiach prvku: +x, -x, +y, -y, +z alebo -z.`);
  return { sign: m[1] === "-" ? -1 : 1, axis: m[2] === "x" ? 0 : m[2] === "y" ? 1 : 2, name: `${m[1]}${m[2]}` };
}

/** Rovina zložená z trojuholníkov: poloha na osi a obdĺžnik v ďalších dvoch osiach. */
export interface Plane {
  offset: number;
  area: number;
  lo: [number, number];
  hi: [number, number];
}

/** Roviny prvku s normálou `face` v osiach `ax`; pri IfcDoor bez výplne otvoru (krídlo, kovanie). */
export function facePlanes(e: MeshElement, ax: ElementAxes, face: FacePick): Plane[] {
  const w = worldPositions(e);
  const skip = doorFill(e);
  const [p, q] = ([0, 1, 2] as const).filter((c) => c !== face.axis);
  const tris: { offset: number; area: number; pts: Vec3[] }[] = [];
  for (let n = 0, t = 0; t + 2 < e.indices.length; t += 3) {
    while (n + 1 < e.parts.length && e.parts[n + 1] <= t) n++;
    if (skip?.[n]) continue;
    const v = [0, 1, 2].map((j) => local(ax, [w[e.indices[t + j] * 3], w[e.indices[t + j] * 3 + 1], w[e.indices[t + j] * 3 + 2]]));
    const u1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const u2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const nrm = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (len < 1e-12 || (face.sign * nrm[face.axis]) / len < PARALLEL_COS) continue;
    tris.push({ offset: (v[0][face.axis] + v[1][face.axis] + v[2][face.axis]) / 3, area: len / 2, pts: v });
  }
  tris.sort((a, b) => a.offset - b.offset);
  const planes: Plane[] = [];
  let cur: (Plane & { sum: number }) | null = null;
  for (const t of tris) {
    if (!cur || t.offset - cur.offset > PLANE_TOL) {
      cur = { offset: t.offset, area: 0, sum: 0, lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] };
      planes.push(cur);
    }
    cur.sum += t.offset * t.area;
    cur.area += t.area;
    for (const pt of t.pts) {
      cur.lo = [Math.min(cur.lo[0], pt[p]), Math.min(cur.lo[1], pt[q])];
      cur.hi = [Math.max(cur.hi[0], pt[p]), Math.max(cur.hi[1], pt[q])];
    }
  }
  return planes.map((pl) => {
    const { sum, ...rest } = pl as Plane & { sum: number };
    return { ...rest, offset: rest.area > 0 ? sum / rest.area : rest.offset };
  });
}

/** Maska výplne dverí po telesách (rovnaké pravidlá ako svetlý otvor), inak null. */
function doorFill(e: MeshElement): boolean[] | null {
  if (!e.ifcType.startsWith("IfcDoor") || e.parts.length < 2) return null;
  return doorLayout(e.positions, e.indices, e.parts).fill;
}

/** Prekrytie dvoch obdĺžnikov (v každej osi, záporné = medzera). */
function overlap(a: Plane, b: Plane): [number, number] {
  return [Math.min(a.hi[0], b.hi[0]) - Math.max(a.lo[0], b.lo[0]), Math.min(a.hi[1], b.hi[1]) - Math.max(a.lo[1], b.lo[1])];
}

export type FaceRelation = "facing" | "away" | "same_direction";

/**
 * Kolmá vzdialenosť plôch `fa` prvku `a` a `fb` prvku `b` (môže byť ten istý) v osiach `a`.
 * Plochy oproti sebe (normála a mieri k b a naopak, napr. vnútorné líca zárubne) = najbližšia
 * dvojica s prekrytím v priemete a medzerou nad 5 mm. Inak (hrúbka steny, plochy rovnakým
 * smerom) = najväčšie plochy, pri zhode vzdialenejšie.
 */
export function faceDistance(a: MeshElement, b: MeshElement, fa: FacePick, fb: FacePick) {
  if (fa.axis !== fb.axis) throw new InputError(`Plochy ${fa.name} a ${fb.name} nie sú rovnobežné: zadaj obe na tej istej osi (napr. +x a -x).`);
  const ax = elementAxes(a);
  const pa = facePlanes(a, ax, fa);
  const pb = facePlanes(b, ax, fb);
  const label = (f: FacePick, e: MeshElement) => `${f.name} (${e.ifcType}${e.name ? ` ${e.name}` : ""})`;
  if (pa.length === 0 || pb.length === 0) {
    throw new InputError(`Prvok nemá plochu ${pa.length === 0 ? label(fa, a) : label(fb, b)} kolmú na os prvku (do 2°): skús iný smer alebo axis.`);
  }
  type Pair = { a: Plane; b: Plane; gap: number; relation: FaceRelation; ov: [number, number] };
  const pairs: Pair[] = [];
  for (const x of pa) {
    for (const y of pb) {
      const d = y.offset - x.offset;
      const relation: FaceRelation =
        fa.sign === fb.sign ? "same_direction" : fa.sign * d > 0 && fb.sign * -d > 0 ? "facing" : "away";
      pairs.push({ a: x, b: y, gap: Math.abs(d), relation, ov: overlap(x, y) });
    }
  }
  const covering = (p: Pair) => p.ov[0] > 0 && p.ov[1] > 0;
  const facing = pairs.filter((p) => p.relation === "facing" && p.gap >= MIN_FACING_GAP && covering(p));
  let best: Pair | undefined;
  if (facing.length > 0) {
    best = facing.reduce((m, p) => (p.gap < m.gap ? p : m));
  } else {
    const rest = pairs.filter((p) => p.relation !== "facing");
    const score = (p: Pair) => Math.min(p.a.area, p.b.area);
    best = rest.reduce<Pair | undefined>((m, p) => (!m || score(p) > score(m) + 1e-9 || (Math.abs(score(p) - score(m)) <= 1e-9 && p.gap > m.gap) ? p : m), undefined);
  }
  if (!best) throw new InputError(`Plochy ${label(fa, a)} a ${label(fb, b)} sú len oproti sebe bez prekrytia alebo bližšie ako 5 mm: skús opačné smery.`);
  const k = fa.axis;
  const [p, q] = ([0, 1, 2] as const).filter((c) => c !== k);
  // Kóta v strede prekrytia plôch; bez prekrytia medzi stredmi plôch.
  const mid = (i: 0 | 1) =>
    best.ov[i] > 0
      ? (Math.max(best.a.lo[i], best.b.lo[i]) + Math.min(best.a.hi[i], best.b.hi[i])) / 2
      : (best.a.lo[i] + best.a.hi[i] + best.b.lo[i] + best.b.hi[i]) / 4;
  const at = (offset: number): Vec3 => {
    const l: Vec3 = [0, 0, 0];
    l[k] = offset;
    l[p] = mid(0);
    l[q] = mid(1);
    return world(ax, l);
  };
  const plane = (pl: Plane, f: FacePick) => ({ face: f.name, offset_m: round(pl.offset), area_m2: round(pl.area) });
  return {
    distance_m: round(best.gap),
    relation: best.relation,
    face_a: plane(best.a, fa),
    face_b: plane(best.b, fb),
    candidates: { a: pa.length, b: pb.length },
    axes: { x: ax.x.map((c) => round(c, 4)), y: ax.y.map((c) => round(c, 4)), z: ax.z },
    overlap: best.ov[0] > 0 && best.ov[1] > 0,
    segment: { a: point(at(best.a.offset)), b: point(at(best.b.offset)) } as MeasureSegment,
  };
}
