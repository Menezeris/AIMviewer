import type { AskAction } from "../llm/actions";
import type { MeasurePoint } from "../viewer-measure";
import { MAX_ROUTE_POINTS, ROUTE_COLOR, routeOp } from "../viewer-route";

import { ifcBox, toIfc, type Box, type MeshElement, type Vec3 } from "./measure";
import type { Endpoint, NavData, NavStair, RouteResult } from "./route";

/**
 * Čiara trasy vo vieweri (D-137): body cesty z `ifc_measure route` v IFC svete,
 * 1,6 m nad pochôdznou plochou. Plocha = najvyšší povrch dosky, krytiny
 * alebo rampy pod bodom (zvislý lúč v okne okolo podlahy miestnosti),
 * bez zásahu = spodok IfcSpace. Čiara ide stredom každých dverí, v miestnosti
 * priamo (vzorky každých 0,5 m kopírujú zmenu úrovne podlahy) a po schodisku
 * stredom každého stupňa nad jeho vrchom (schodovito), aj na točitom ramene.
 */

export const WALK_HEIGHT_M = 1.6;
/**
 * Podlaha miestnosti: doska, krytina (podlahová; stropná je pod doskou a nevyhrá), rampa. Schodisko
 * len vo vlastnom úseku: priamka od dverí k ramenu ide v pôdoryse aj nad otvorom schodiska a nesmie
 * klesnúť na stupne pod podlahou.
 */
const FLOOR_TYPES = /^IFC(SLAB|COVERING|RAMP|RAMPFLIGHT)$/i;
/** Okno lúča okolo referenčnej výšky: o toľko pod ňou a nad ňou sa hľadá plocha. */
const BELOW = 0.6;
const ABOVE = 0.4;
const ROOM_STEP = 0.5;
const STAIR_STEP = 0.05;
const SIMPLIFY = 0.02;

interface Surface {
  box: Box;
  /** Trojuholníky v IFC rámci meshu (x, y, z po deviatich). */
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

/** Najvyšší povrch pod bodom (x, y) s výškou v [lo, hi], inak null. */
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
      if (Math.abs(d) < 1e-12) continue; // zvislá plocha (podstupnica, stena)
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

/** Vzdialenosť bodu od úsečky (3D). */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
}

/** Douglas-Peucker: body bližšie ako `tol` k zjednodušenej čiare sa vynechajú. */
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

/** Stupeň: horná vodorovná plocha ramena (ťažisko v pôdoryse, výška, plocha). */
interface Tread {
  x: number;
  y: number;
  z: number;
  area: number;
}

/**
 * Horné vodorovné plochy prvku zoskupené podľa výšky (1 cm): stupne a podesty.
 * Horná = nad ňou z prvku už nič nie je (spodná plocha stupňa ani päta stĺpa nie).
 * Malé plochy (vrch stredového stĺpa točitého schodiska, madlo) pod 50 % mediánu
 * plôch sa vynechajú (FZK-Haus: stĺp 0,031 m², stupeň 0,098 m²).
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
  const areas = out.map((g) => g.area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] ?? 0;
  return out.filter((g) => g.area >= Math.max(0.02, 0.5 * median));
}

/**
 * Čiara po schodisku zdola nahor, schodovito: stredom každého stupňa (ťažisko
 * hornej plochy) vo výške jeho vrchu, podstupnica = zvislý skok v polovici medzi
 * stredmi susedných stupňov. Platí pre rovné aj točité ramená a podesty. Ramená
 * (inak časti schodiska) v poradí podľa výšky. Prvok bez vodorovných plôch: os
 * obálky v smere stúpania, výška = vrch pod bodom.
 */
function stairLine(st: NavStair, meshes: Map<string, MeshElement>): Vec3[] {
  const runs = (st.flights.length > 0 ? st.flights : st.parts).map((g) => meshes.get(g)).filter((e): e is MeshElement => !!e);
  const lines: Vec3[][] = [];
  for (const e of runs) {
    const s = surfaceOf(e);
    const treads = treadsOf(s);
    if (treads.length >= 2) {
      const line: Vec3[] = [[treads[0].x, treads[0].y, treads[0].z]];
      for (let i = 1; i < treads.length; i++) {
        const [a, b] = [treads[i - 1], treads[i]];
        const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        line.push([mx, my, a.z], [mx, my, b.z], [b.x, b.y, b.z]);
      }
      lines.push(line);
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
    // Smer stúpania = os, po ktorej sa výška mení viac (nie dlhšia strana obálky).
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
 * Body čiary trasy v IFC svete (m, Z hore) zo štartu cez kroky trasy do cieľa
 * (`to` = null pri úniku: cieľom sú posledné dvere krokov).
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
  /** Do miestnosti `space` od posledného bodu k `next` (vzorky kopírujú podlahu). */
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
    if (ep.kind === "door") return null; // dvere pridá ich krok
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

/** Príkaz pre živý viewer: čiara nahradí predošlú čiaru trasy. */
export function routeLineAction(points: readonly Vec3[]): AskAction {
  const pts: MeasurePoint[] = points.map(([x, y, z]) => ({ x, y, z }));
  return {
    type: "navigate",
    url: `/ifc?ops=${encodeURIComponent(routeOp(pts, ROUTE_COLOR))}&r=${Date.now().toString(36)}`,
    label: "Trasa",
  };
}
