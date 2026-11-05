import type { MeasureSegment } from "../viewer-measure";

import { doorLayout, planAxes } from "./door-clear";
import { InputError } from "./tools";
import type { MeshElement, Vec3 } from "./measure";
import { toWorld } from "./measure-dimension";

/**
 * `ifc_measure` axis and face_a / face_b (D-155): one element axis and the perpendicular distance
 * of two parallel faces, from the mesh in the IFC world (Z up, m, with the frame offset).
 * Element axes = the rectangle with the smallest area in plan (like the clear door opening, D-118):
 * x = width (longer side), y = depth, z = up. The x direction is turned towards the world +X (for a
 * vertical x towards +Y), y is x rotated by 90° counter-clockwise, so that "+x"
 * always means the same for both a and b. The IfcObjectPlacement axes are left for later.
 */

export type AxisName = "x" | "y" | "z" | "width" | "depth" | "height";
export const AXES: readonly AxisName[] = ["x", "y", "z", "width", "depth", "height"];
const FACE_RE = /^([+-])([xyz])$/;

/** A face is perpendicular to the axis when its normal deviates from the axis by no more than 2°. */
const PARALLEL_COS = Math.cos((2 * Math.PI) / 180);
/** Triangles within 1 mm of each other along the axis direction = one plane. */
const PLANE_TOL = 0.001;
/** Opposite faces closer than this are a joint or a touch of solids, not a measured gap. */
const MIN_FACING_GAP = 0.005;

export interface ElementAxes {
  /** Centre of the plan rectangle in the IFC world (x, y). */
  origin: [number, number];
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
const point = (v: Vec3) => ({ x: round(v[0]), y: round(v[1]), z: round(v[2]) });

/** Mesh vertices in the IFC world. */
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

/** IFC world point -> coordinates in the element axes. */
function local(ax: ElementAxes, p: Vec3): Vec3 {
  const dx = p[0] - ax.origin[0];
  const dy = p[1] - ax.origin[1];
  return [dx * ax.x[0] + dy * ax.x[1], dx * ax.y[0] + dy * ax.y[1], p[2]];
}

/** Coordinates in the element axes -> IFC world. */
function world(ax: ElementAxes, l: Vec3): Vec3 {
  return [ax.origin[0] + ax.x[0] * l[0] + ax.y[0] * l[1], ax.origin[1] + ax.x[1] * l[0] + ax.y[1] * l[1], l[2]];
}

/**
 * One element axis: x/y/z = envelope edge in the IFC world axes, width/depth/height = in the element
 * axes. The dimension runs along the bottom front edge, like one of the three edges of `sizeDimensions`.
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

/** A plane composed of triangles: the position on the axis and the rectangle in the other two axes. */
export interface Plane {
  offset: number;
  area: number;
  lo: [number, number];
  hi: [number, number];
}

/** Planes of an element with normal `face` in axes `ax`; for IfcDoor without the opening fill (leaf, hardware). */
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

/** Door fill mask by solids (same rules as the clear opening), otherwise null. */
function doorFill(e: MeshElement): boolean[] | null {
  if (!e.ifcType.startsWith("IfcDoor") || e.parts.length < 2) return null;
  return doorLayout(e.positions, e.indices, e.parts).fill;
}

/** Overlap of two rectangles (in each axis, negative = gap). */
function overlap(a: Plane, b: Plane): [number, number] {
  return [Math.min(a.hi[0], b.hi[0]) - Math.max(a.lo[0], b.lo[0]), Math.min(a.hi[1], b.hi[1]) - Math.max(a.lo[1], b.lo[1])];
}

export type FaceRelation = "facing" | "away" | "same_direction";

/**
 * Perpendicular distance of faces `fa` of element `a` and `fb` of element `b` (may be the same) in the axes of `a`.
 * Opposite faces (normal of a points to b and vice versa, e.g. inner faces of a frame) = the nearest
 * pair with an overlap in projection and a gap above 5 mm. Otherwise (wall thickness, faces facing the same
 * direction) = the largest faces, on a tie the farther.
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
  // Dimension at the centre of the face overlap; without an overlap between the face centres.
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
