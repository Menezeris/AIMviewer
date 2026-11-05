import type { AskAction } from "../llm/actions";
import type { MeasurePoint } from "../viewer-measure";
import { MAX_ROUTE_POINTS, ROUTE_COLOR, routeOp } from "../viewer-route";

import { ifcBox, toIfc, type Box, type MeshElement, type Vec3 } from "./measure";
import type { Endpoint, NavData, NavStair, RouteResult } from "./route";

/**
 * Route line in the viewer (D-137): path points from `ifc_measure route` in the IFC world,
 * 1.6 m above the walking surface. Surface = the highest surface of a slab, covering
 * or ramp under the point (vertical ray in a window around the space floor),
 * without a hit = bottom of the IfcSpace. The line goes through the centre of every door, in a space
 * straight (samples every 0.5 m follow the change of floor level) and along a stair
 * parallel to the line of the tread nosings (smoothly sloped, also on a winding
 * flight), horizontally on landings.
 */

export const WALK_HEIGHT_M = 1.6;
/**
 * Floor of a space: slab, covering (floor covering; a ceiling covering is under the slab and does not win), ramp. A stair
 * only in its own section: the straight line from the door to the flight runs in plan also above the stair opening and must not
 * drop to the treads below the floor.
 */
const FLOOR_TYPES = /^IFC(SLAB|COVERING|RAMP|RAMPFLIGHT)$/i;
/** Ray window around the reference height: the surface is searched this far below and above it. */
const BELOW = 0.6;
const ABOVE = 0.4;
const ROOM_STEP = 0.5;
const STAIR_STEP = 0.05;
const SIMPLIFY = 0.02;

interface Surface {
  box: Box;
  /** Triangles in the IFC frame of the mesh (x, y, z, nine per triangle). */
  tris: Float64Array;
}

function surfaceOf(e: MeshElement): Surface {
  const p = e.positions;
  const out = new Float64Array(e.indices.length * 3);
  for (let i = 0; i < e.indices.length; i++) {
    const v = toIfc([p[e.indices[i] * 3], p[e.indices[i] * 3 + 1], p[e.indices[i] * 3 + 2]]);
    out.set(v, i * 3);
  }
  return { box: ifcBox(e.bounds), tris: out };
}

/** The highest surface under the point (x, y) with a height in [lo, hi], otherwise null. */
export function surfaceZ(list: readonly Surface[], x: number, y: number, lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const s of list) {
    const b = s.box;
    if (x < b.min[0] - 1e-6 || x > b.max[0] + 1e-6 || y < b.min[1] - 1e-6 || y > b.max[1] + 1e-6) continue;
    if (b.max[2] < lo || b.min[2] > hi) continue;
    const t = s.tris;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(i, i + 9);
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue; // vertical surface (riser, wall)
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const z = l1 * az + l2 * bz + l3 * cz;
      if (z >= lo && z <= hi && (best === null || z > best)) best = z;
    }
  }
  return best;
}

/** Distance of a point from a segment (3D). */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
}

/** Douglas-Peucker: points closer than `tol` to the simplified line are dropped. */
export function simplify(pts: readonly Vec3[], tol: number): Vec3[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > worst) [worst, at] = [d, k];
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

/** Tread: upper horizontal surface of a flight (centroid in plan, height, area). */
interface Tread {
  x: number;
  y: number;
  z: number;
  area: number;
}

/**
 * Upper horizontal surfaces of an element grouped by height (1 cm): treads and landings.
 * Upper = nothing of the element is above it (the bottom surface of a tread and the foot of a column are not).
 * Small surfaces (top of the central column of a spiral stair, handrail) under 50 % of the median
 * area are dropped (FZK-Haus: column 0.031 m2, tread 0.098 m2).
 */
export function treadsOf(s: Surface): Tread[] {
  const faces: Tread[] = [];
  const t = s.tris;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(i, i + 9);
    const [ux, uy, uz, vx, vy, vz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9 || Math.abs(n[2]) / len < 0.98) continue;
    const [x, y, z] = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3];
    if (surfaceZ([s], x, y, z + 0.005, s.box.max[2] + 1) !== null) continue;
    faces.push({ x, y, z, area: len / 2 });
  }
  faces.sort((a, b) => a.z - b.z);
  const out: Tread[] = [];
  for (const f of faces) {
    const last = out[out.length - 1];
    if (last && f.z - last.z < 0.01) {
      const a = last.area + f.area;
      [last.x, last.y, last.z, last.area] = [(last.x * last.area + f.x * f.area) / a, (last.y * last.area + f.y * f.area) / a, (last.z * last.area + f.z * f.area) / a, a];
    } else out.push({ ...f });
  }
  const typical = median(out.map((g) => g.area));
  return out.filter((g) => g.area >= Math.max(0.02, 0.5 * typical));
}

/**
 * Reference line of a flight (decision by Samuel in #223): connects the nosings of the
 * treads, so it is sloped with the slope of the flight; horizontal on a landing and the upper storey.
 * Tread nosing = its front edge: from the centroid back against the walking direction by half
 * the depth (depth = area / flight width, width = median area / median distance of
 * centres; a landing thus comes out deeper). It starts at the foot one tread before the first
 * nosing (floor height), on a landing it runs horizontally to the foot of the next flight.
 * Points are at the height of the tread top (without 1.6 m).
 */
export function pitchLine(treads: readonly Tread[]): Vec3[] {
  if (treads.length < 2) return [];
  const xy = (t: Tread) => [t.x, t.y];
  const steps = treads.slice(1).map((t, i) => Math.hypot(t.x - treads[i].x, t.y - treads[i].y));
  const going = median(steps);
  const rise = median(treads.slice(1).map((t, i) => t.z - treads[i].z));
  const width = going > 1e-6 ? median(treads.map((t) => t.area)) / going : 0;
  const unit = (a: number[], b: number[]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  // Walking direction at tread i: from the previous centre to its own (first tread: to the next).
  const dir = (i: number) => (i === 0 ? unit(xy(treads[0]), xy(treads[1])) : unit(xy(treads[i - 1]), xy(treads[i])));
  const depth = (t: Tread) => (width > 1e-6 ? t.area / width : going);
  const nosing = treads.map((t, i): Vec3 => {
    const u = dir(i);
    const h = Math.min(depth(t), 4 * going) / 2;
    return [t.x - u[0] * h, t.y - u[1] * h, t.z];
  });
  const foot = (i: number): Vec3 => {
    const u = dir(i);
    return [nosing[i][0] - u[0] * going, nosing[i][1] - u[1] * going, nosing[i][2] - rise];
  };
  const line: Vec3[] = [foot(0), nosing[0]];
  for (let i = 1; i < treads.length; i++) {
    // Landing: more than 1.5 treads between nosings -> horizontally to the foot of the next flight.
    const gap = Math.hypot(nosing[i][0] - nosing[i - 1][0], nosing[i][1] - nosing[i - 1][1]);
    if (gap > 1.5 * going) line.push(foot(i));
    line.push(nosing[i]);
  }
  // Upper landing in the element: horizontally to its centre.
  const top = treads[treads.length - 1];
  if (depth(top) > 1.5 * going) line.push([top.x, top.y, top.z]);
  return line;
}

/**
 * Line along a stair from bottom to top: the reference line of a flight (`pitchLine`), smoothly
 * sloped, horizontal on landings. Valid for straight and winding flights. Flights (otherwise
 * parts of the stair) in order by height. An element without horizontal surfaces: the envelope axis
 * in the direction of the rise, height = top under the point.
 */
function stairLine(st: NavStair, meshes: Map<string, MeshElement>): Vec3[] {
  const runs = (st.flights.length > 0 ? st.flights : st.parts).map((g) => meshes.get(g)).filter((e): e is MeshElement => !!e);
  const lines: Vec3[][] = [];
  for (const e of runs) {
    const s = surfaceOf(e);
    const pitch = pitchLine(treadsOf(s));
    if (pitch.length >= 2) {
      lines.push(pitch);
      continue;
    }
    const { min, max } = s.box;
    const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const sample = (axis: 0 | 1): Vec3[] => {
      const out: Vec3[] = [];
      const n = Math.max(2, Math.ceil((max[axis] - min[axis]) / STAIR_STEP));
      for (let i = 0; i <= n; i++) {
        const v = min[axis] + 0.01 + ((max[axis] - min[axis] - 0.02) * i) / n;
        const [x, y] = axis === 0 ? [v, mid[1]] : [mid[0], v];
        const z = surfaceZ([s], x, y, min[2] - 0.01, max[2] + 0.01);
        if (z !== null) out.push([x, y, z]);
      }
      return out;
    };
    const rise = (l: Vec3[]) => (l.length > 1 ? Math.abs(l[l.length - 1][2] - l[0][2]) : -1);
    // Direction of the rise = the axis along which the height changes more (not the longer side of the envelope).
    const [ax, ay] = [sample(0), sample(1)];
    let line = rise(ax) >= rise(ay) ? ax : ay;
    if (line.length < 2) continue;
    if (line[0][2] > line[line.length - 1][2]) line = line.reverse();
    lines.push(line);
  }
  lines.sort((a, b) => a[0][2] - b[0][2]);
  return lines.flat().map((p): Vec3 => [p[0], p[1], p[2] + WALK_HEIGHT_M]);
}

/**
 * Route line points in the IFC world (m, Z up) from the start through the route steps to the goal
 * (`to` = null for escape: the goal is the last door of the steps).
 */
export function routeLine(nav: NavData, meshes: Map<string, MeshElement>, from: Endpoint, route: RouteResult, to: Endpoint | null): Vec3[] {
  const walk: Surface[] = [];
  for (const e of meshes.values()) if (FLOOR_TYPES.test(e.ifcType)) walk.push(surfaceOf(e));
  const floorAt = (x: number, y: number, ref: number): Vec3 => [
    x,
    y,
    (surfaceZ(walk, x, y, ref - BELOW, ref + ABOVE) ?? ref) + WALK_HEIGHT_M,
  ];
  const zRef = (space: string | null) => (space ? nav.spaces.get(space)?.zMin : undefined);

  const pts: Vec3[] = [];
  /** Into the space `space` from the last point to `next` (samples follow the floor). */
  const walkTo = (next: Vec3[], space: string | null) => {
    const p = pts[pts.length - 1];
    const ref = zRef(space);
    if (p && next.length > 0 && ref !== undefined) {
      const q = next[0];
      const n = Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1]) / ROOM_STEP);
      for (let i = 1; i < n; i++) pts.push(floorAt(p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n, ref));
    }
    pts.push(...next);
  };
  const endpointAt = (ep: Endpoint): Vec3 | null => {
    if (ep.kind === "door") return null; // the door is added by its step
    const s = nav.spaces.get(ep.space)!;
    const xy = ep.kind === "space" ? s.center : ep.at;
    return floorAt(xy[0], xy[1], s.zMin);
  };

  const start = endpointAt(from);
  if (start) pts.push(start);
  let space: string | null = from.kind === "door" ? null : from.space;
  for (const step of route.steps) {
    if (step.kind === "space") {
      space = step.global_id;
    } else if (step.kind === "door") {
      const d = nav.doors.get(step.global_id);
      const e = meshes.get(step.global_id);
      if (!d) continue;
      const ref = e ? ifcBox(e.bounds).min[2] : (zRef(d.spaces[0]) ?? 0);
      walkTo([floorAt(d.center[0], d.center[1], ref)], space);
      space = null;
    } else {
      const st = nav.stairs.find((s) => s.globalId === step.global_id);
      if (!st) continue;
      const line = stairLine(st, meshes);
      walkTo(step.up === false ? line.reverse() : line, space);
      space = null;
    }
  }
  const end = to ? endpointAt(to) : null;
  if (end) walkTo([end], space);

  let tol = SIMPLIFY;
  let out = simplify(pts, tol);
  while (out.length > MAX_ROUTE_POINTS) out = simplify(pts, (tol *= 2));
  const offset = [...meshes.values()].find((e) => e.worldOffset)?.worldOffset ?? [0, 0, 0];
  return out.map((p) => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
}

/** Command for the live viewer: the line replaces the previous route line. */
export function routeLineAction(points: readonly Vec3[]): AskAction {
  const pts: MeasurePoint[] = points.map(([x, y, z]) => ({ x, y, z }));
  return {
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(routeOp(pts, ROUTE_COLOR))}&r=${Date.now().toString(36)}`,
    label: "Trasa",
  };
}
