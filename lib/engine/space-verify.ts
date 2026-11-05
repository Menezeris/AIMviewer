import { GeometryProcessor } from "@ifc-lite/geometry";

import {
  FFH_ABSENT_RULE,
  NET_FLOOR_AREA,
  NET_VOLUME_COVERINGS,
  NFA_OPENINGS_RULE,
  NON_CONSTANT_RULE,
  SELECTION,
  SPACE_METHODS,
  TOLERANCES,
  netVolumeTolerance,
  toleranceAbs,
  withinTolerance,
  type QuantityKind,
  type QuantityMethod,
  type SpaceMethodKey,
} from "../verify/quantity-methods";

/**
 * Verifier of IfcSpace quantities against geometry (D-185): pure computations; the wiring into `ifc_measure verify=true`
 * is in `space-verify-run.ts`.
 *
 * Own solids from `extractExtrusionDefinitions` (`@ifc-lite/geometry`, exact source
 * extrusion parameters without tessellation) as vertical prisms: plan (rings with holes) in the IFC
 * world (m) and the range z0..z1. The recipes compare Qto_SpaceBaseQuantities from the file with the value from
 * the prisms of the space, slabs and coverings that overlap the space in plan
 * (exact 2D intersection), and return the status, method, definition, tolerance, a formula with the substituted
 * numbers and anchors for the elevation marks. The rules (tolerances, selection, constancy) are in the registry
 * `lib/verify/quantity-methods.ts`, not here.
 *
 * An element without a usable extrusion (other representation, profile rejected by ifc-lite, sloped extrusion or only part of the
 * solids) gets a solid from the closed mesh of the engine (`bodyFromMeshTriangles`); grey only for an open
 * mesh. Not yet: further analytic shapes (IfcSweptDiskSolid, IfcRevolvedAreaSolid...).
 */

export type Pt = [number, number];
export interface Ring {
  pts: Pt[];
  /** +1 = outer, -1 = hole. */
  sign: 1 | -1;
}
export interface Prism {
  rings: Ring[];
  z0: number;
  z1: number;
}
export type Vec3 = [number, number, number];
export interface Body {
  expressId: number;
  prisms: Prism[];
  /** Reason why the element has no (whole) analytic solid. */
  unsupported?: string;
  /** Where the solid comes from: analytic extrusion, or a substitute from the closed mesh of the engine. */
  source?: "extrusion" | "mesh" | "mesh_open";
  /** For a mesh: the prism rings are plan triangles, so the volume (NaN for an open mesh), perimeter and centroid are carried by the mesh. */
  mesh?: { volume: number; perimeter: number; centroid: Pt };
  /** Envelope in the IFC world (also for an open mesh): decides whether an element without a solid can be a reference of the space. */
  bbox?: { min: Vec3; max: Vec3 };
}

// ── 2D geometry ──────────────────────────────────────────────────────────────

export function signedArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12;
}

/** Removes duplicated and collinear points (otherwise ear clipping gets stuck). */
function clean(p: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-9) out.push(q);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const c = out[(i + 1) % out.length];
      if (Math.abs(cross(a, out[i], c)) < 1e-12) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Ear clipping of a simple polygon (without holes) into triangles (counter-clockwise). */
export function triangulate(poly: readonly Pt[]): Array<[Pt, Pt, Pt]> {
  let p = clean(poly);
  if (signedArea(p) < 0) p = [...p].reverse();
  const tris: Array<[Pt, Pt, Pt]> = [];
  let guard = 0;
  while (p.length > 3 && guard++ < 10_000) {
    let cut = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      if (cross(a, b, c) <= 1e-12) continue; // reflex vertex
      const inside = p.some((q) => q !== a && q !== b && q !== c && inTriangle(q, a, b, c));
      if (inside) continue;
      tris.push([a, b, c]);
      p = p.filter((_, k) => k !== i);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate input: the rest is discarded (the area would be inexact, reported via the area check)
  }
  if (p.length === 3) tris.push([p[0], p[1], p[2]]);
  return tris;
}

/** Sutherland-Hodgman: an arbitrary polygon clipped by a convex counter-clockwise polygon (a triangle from `triangulate`). */
function clipByConvex(subject: readonly Pt[], clip: readonly Pt[]): Pt[] {
  let out = [...subject];
  for (let e = 0; e < clip.length && out.length; e++) {
    const a = clip[e];
    const b = clip[(e + 1) % clip.length];
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i - 1 + input.length) % input.length];
      const cIn = cross(a, b, cur) >= 0;
      const pIn = cross(a, b, prev) >= 0;
      if (cIn !== pIn) {
        const d1 = cross(a, b, prev);
        const d2 = cross(a, b, cur);
        const t = d1 / (d1 - d2);
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      if (cIn) out.push(cur);
    }
  }
  return out;
}

/** Area of the intersection of two simple polygons (m2), exact. */
export function ringIntersectionArea(a: readonly Pt[], b: readonly Pt[]): number {
  let area = 0;
  for (const t of triangulate(a)) {
    const clipped = clipByConvex(b, t);
    if (clipped.length >= 3) area += Math.abs(signedArea(clipped));
  }
  return area;
}

type Box2 = [number, number, number, number];
function box2(p: readonly Pt[]): Box2 {
  const b: Box2 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of p) {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  return b;
}
const boxDisjoint = (a: Box2, b: Box2) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];

/** Area of the intersection of three simple polygons (m2), exact: convex pieces a x b clip c. */
export function ringIntersectionArea3(a: readonly Pt[], b: readonly Pt[], c: readonly Pt[]): number {
  if (boxDisjoint(box2(a), box2(b)) || boxDisjoint(box2(a), box2(c)) || boxDisjoint(box2(b), box2(c))) return 0;
  let area = 0;
  const tb = triangulate(b);
  for (const ta of triangulate(a)) {
    for (const t of tb) {
      const ab = clipByConvex(t, ta);
      if (ab.length < 3 || Math.abs(signedArea(ab)) < 1e-12) continue;
      const k = clipByConvex(c, signedArea(ab) < 0 ? [...ab].reverse() : ab);
      if (k.length >= 3) area += Math.abs(signedArea(k));
    }
  }
  return area;
}

/** Area of the intersection of three plans with holes (inclusion-exclusion over rings). */
export function regionIntersectionArea3(a: readonly Ring[], b: readonly Ring[], c: readonly Ring[]): number {
  let s = 0;
  for (const ra of a) for (const rb of b) for (const rc of c) s += ra.sign * rb.sign * rc.sign * ringIntersectionArea3(ra.pts, rb.pts, rc.pts);
  return Math.max(0, s);
}

/** Area of the intersection of two plans with holes (inclusion-exclusion over rings). */
export function regionIntersectionArea(a: readonly Ring[], b: readonly Ring[]): number {
  let s = 0;
  for (const ra of a) for (const rb of b) s += ra.sign * rb.sign * ringIntersectionArea(ra.pts, rb.pts);
  return Math.max(0, s);
}

export const regionArea = (r: readonly Ring[]) => r.reduce((s, x) => s + x.sign * Math.abs(signedArea(x.pts)), 0);

export function regionPerimeter(r: readonly Ring[]): number {
  let s = 0;
  for (const x of r.filter((q) => q.sign > 0)) for (let i = 0; i < x.pts.length; i++) {
    const a = x.pts[i];
    const b = x.pts[(i + 1) % x.pts.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

export function centroid(r: readonly Ring[]): Pt {
  const outer = r.find((x) => x.sign > 0)?.pts ?? [];
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < outer.length; i++) {
    const [x1, y1] = outer[i];
    const [x2, y2] = outer[(i + 1) % outer.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : (outer[0] ?? [0, 0]);
}

// ── extrusions from ifc-lite -> prisms ───────────────────────────────────────

type Mat = readonly number[];
/** Column-major 4x4 matrix times a point (w = 1) or a vector (w = 0). */
const mul = (m: Mat, v: readonly number[], w: number) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
const matMul = (a: Mat, b: Mat) => Array.from({ length: 16 }, (_, i) => {
  const c = Math.floor(i / 4);
  const r = i % 4;
  return a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
});
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The arc is sampled (32 segments, circle area error under 0.7 %); a circular sector would be computed exactly. */
const ARC_STEPS = 32;

interface Segment {
  type: string;
  start?: number[];
  end?: number[];
  center?: number[];
  normal?: number[];
  x_axis?: number[];
  radius?: number;
  start_angle?: number;
  sweep_angle?: number;
}

function loopPoints(segments: Segment[]): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  const push = (p: number[]) => pts.push([p[0], p[1], p[2] ?? 0]);
  for (const s of segments) {
    if (s.type === "line" && s.start) push(s.start);
    else if (s.type === "arc" && s.center && s.x_axis && s.normal && s.radius != null) {
      const x = s.x_axis;
      const n = s.normal;
      const y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
      for (let k = 0; k < ARC_STEPS; k++) {
        const t = (s.start_angle ?? 0) + ((s.sweep_angle ?? 0) * k) / ARC_STEPS;
        push([0, 1, 2].map((i) => s.center![i] + s.radius! * (Math.cos(t) * x[i] + Math.sin(t) * (y[i] ?? 0))));
      }
    }
  }
  return pts;
}

interface ExtrusionSource {
  key: unknown;
  source: {
    profile: { loops: Array<{ kind: "outer" | "inner"; segments: Segment[] }>; profile_position: number[] | null } | null;
    position_matrix: number[] | null;
    axis_unit_vector: number[] | null;
    Depth: number | null;
    status: { type: string; reason?: string };
  };
}
interface ExtrusionInstance {
  source: unknown;
  product_id: number;
  source_modified: boolean;
  world_from_source: number[] | null;
  status: { type: string; reason?: string };
}
export interface ExtrusionDefinitionsLike {
  sources: ExtrusionSource[];
  instances: Record<number, ExtrusionInstance[]>;
}

/** Prisms of elements from extrusion sources; only vertical extrusions (axis parallel to Z after the transform). */
export function bodiesFromExtrusions(defs: ExtrusionDefinitionsLike, ids: readonly number[]): Map<number, Body> {
  const byKey = new Map(defs.sources.map((s) => [JSON.stringify(s.key), s]));
  const out = new Map<number, Body>();
  for (const id of ids) {
    const inst = defs.instances[id] ?? [];
    const body: Body = { expressId: id, prisms: [] };
    if (!inst.length) body.unsupported = "bez extrúzie (Brep, CSG alebo iná reprezentácia)";
    /** Reason for rejecting part of the solids: the element is then not computed from a part (D-185 fix B1). */
    let rejected: string | null = null;
    for (const i of inst) {
      const src = byKey.get(JSON.stringify(i.source))?.source;
      if (i.status.type !== "complete" || !src || src.status.type !== "complete" || !src.profile || !i.world_from_source) {
        rejected = i.status.reason ?? src?.status.reason ?? "nekompletný zdroj extrúzie";
        continue;
      }
      if (i.source_modified) body.unsupported = "teleso je operand CSG (source_modified), hranol je len horný odhad";
      const local = matMul(src.position_matrix ?? IDENTITY, src.profile.profile_position ?? IDENTITY);
      const m = matMul(i.world_from_source, local);
      const axis = mul(matMul(i.world_from_source, src.position_matrix ?? IDENTITY), src.axis_unit_vector ?? [0, 0, 1], 0);
      const depth = src.Depth ?? 0;
      const d = axis.map((x) => x * depth);
      const horiz = Math.hypot(d[0], d[1]);
      if (horiz > 1e-6 * Math.max(1, Math.abs(d[2]))) {
        rejected = "šikmá alebo vodorovná extrúzia";
        continue;
      }
      const rings: Ring[] = [];
      let zBase = Infinity;
      for (const loop of src.profile.loops) {
        const w = loopPoints(loop.segments).map((p) => mul(m, p, 1));
        for (const p of w) zBase = Math.min(zBase, p[2]);
        rings.push({ pts: w.map((p) => [p[0], p[1]] as Pt), sign: loop.kind === "outer" ? 1 : -1 });
      }
      const z0 = Math.min(zBase, zBase + d[2]);
      body.prisms.push({ rings, z0, z1: z0 + Math.abs(d[2]) });
    }
    if (rejected) {
      body.unsupported = inst.length > 1 ? `${rejected} (aspoň jedno z ${inst.length} telies; z časti sa nepočíta)` : rejected;
      body.prisms = [];
    }
    if (body.prisms.length) body.source = "extrusion";
    out.set(id, body);
  }
  return out;
}

/** Prisms of elements and the length unit of the file (m per unit), for converting Qto lengths. */
export async function extractExtrusions(bytes: Uint8Array, ids: readonly number[]): Promise<{ bodies: Map<number, Body>; lengthUnitScale: number }> {
  const gp = new GeometryProcessor({ enableInstancing: false });
  const log = console.log;
  console.log = () => undefined;
  try {
    await gp.init();
    const defs = gp.extractExtrusionDefinitions(bytes, Uint32Array.from(ids));
    if (!defs) throw new Error("extractExtrusionDefinitions nie je k dispozícii");
    const scale = (defs as unknown as { length_unit_scale?: number }).length_unit_scale;
    return { bodies: bodiesFromExtrusions(defs as unknown as ExtrusionDefinitionsLike, ids), lengthUnitScale: typeof scale === "number" && scale > 0 ? scale : 1 };
  } finally {
    console.log = log;
    gp.dispose();
  }
}

export async function extractBodies(bytes: Uint8Array, ids: readonly number[]): Promise<Map<number, Body>> {
  return (await extractExtrusions(bytes, ids)).bodies;
}

// ── solid substitute from a mesh ─────────────────────────────────────────────

/**
 * Solid from mesh triangles in the IFC world (9 numbers per triangle): plan = projection of faces with a downward normal
 * (each triangle is a ring), perimeter = plan edges without a neighbour (rounded to mm), centroid weighted by area,
 * z0 / z1 from vertices. `closed` and `volume` are supplied by the engine (`meshMetrics`). An open mesh (source `mesh_open`) gives the plan,
 * height range and perimeter, not the volume (NaN); without downward faces only the envelope.
 */
export function bodyFromMeshTriangles(expressId: number, tris: ArrayLike<number>, closed: boolean, volume: number): Body {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const k = i % 3;
    if (tris[i] < min[k]) min[k] = tris[i];
    if (tris[i] > max[k]) max[k] = tris[i];
  }
  const bbox = tris.length ? { min, max } : undefined;
  const openNote = "mesh nie je uzavretý, objem ani pôdorys sa z neho nedajú overiť";
  const rings: Ring[] = [];
  const edges = new Map<string, { n: number; len: number }>();
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const a: Pt = [tris[t], tris[t + 1]];
    const b: Pt = [tris[t + 3], tris[t + 4]];
    const c: Pt = [tris[t + 6], tris[t + 7]];
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
    if (len === 0 || nz / len > -1e-6) continue; // only faces with a downward normal
    const ar = Math.abs(signedArea([a, b, c]));
    if (ar < 1e-12) continue;
    rings.push({ pts: [a, b, c], sign: 1 });
    area += ar;
    cx += ((a[0] + b[0] + c[0]) / 3) * ar;
    cy += ((a[1] + b[1] + c[1]) / 3) * ar;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as Array<[Pt, Pt]>) {
      const kp = key(p[0], p[1]);
      const kq = key(q[0], q[1]);
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const e = edges.get(k);
      if (e) e.n++;
      else edges.set(k, { n: 1, len: Math.hypot(q[0] - p[0], q[1] - p[1]) });
    }
  }
  if (!rings.length) return { expressId, prisms: [], unsupported: closed ? "mesh bez plôch s normálou nadol" : openNote, ...(bbox ? { bbox } : {}) };
  let perimeter = 0;
  for (const e of edges.values()) if (e.n === 1) perimeter += e.len;
  return {
    expressId,
    prisms: [{ rings, z0: min[2], z1: max[2] }],
    // Open mesh (D-185 addendum 2, BODY_FALLBACK.open_mesh): plan and height range yes, volume no.
    source: closed ? "mesh" : "mesh_open",
    mesh: { volume: closed ? volume : NaN, perimeter, centroid: [cx / area, cy / area] },
    ...(closed ? {} : { unsupported: "mesh nie je uzavretý: z neho len výška, pôdorys a obvod (nesúlad = sivá), objem sa neoveruje" }),
    bbox: { min, max },
  };
}

// ── IfcSpace recipes (rules: lib/verify/quantity-methods.ts) ──────────────────

export type Status = "green" | "yellow" | "red" | "grey";

export interface Anchor {
  global_id: string;
  role: string;
  z_m?: number;
}
/** Named formula input ("cell", D-185 UI): the value and the element it comes from (m, m2, m3). */
export interface Cell {
  key: string;
  label: string;
  value: number;
  unit: "m" | "m2" | "m3";
  global_id?: string;
  /** Derived cell: the quantity of the same element whose value the cell carries (the viewer shows "(Height)" and scrolls to the row). */
  quantity?: string;
}

export interface RecipeResult {
  target: string;
  /** Recipe with the version from the method registry. */
  recipe: string;
  status: Status;
  /** What is measured from geometry and the literal definition from the schema (method registry). */
  method: string;
  definition: string;
  spec_ref: string;
  /** Tolerance used (text from the registry). */
  tolerance: string;
  file?: number;
  computed?: number;
  /** How it is computed, 1 to 2 sentences for a human (method registry). */
  explanation: string;
  /** Expression over cell keys (`A - B`, `A x B`); missing for grey and for multiple heights. */
  expression?: string;
  /** Formula cells (named inputs with the source element); empty for grey. */
  cells?: Cell[];
  /** Formula with the substituted numbers (m, m2, m3). */
  formula?: string;
  note?: string;
  /** Constancy rule: different heights in the space plan (only for multiple). */
  distinct_heights?: number[];
  anchors: Anchor[];
  /** Vertical elevation mark (z from - to, m in the IFC world) for length recipes; drawn at the centroid of the space plan. */
  dimension?: { z0: number; z1: number };
}

export interface Element {
  globalId: string;
  name: string;
  body: Body;
  /** For IfcCovering: CEILING, FLOORING...; for IfcSlab: FLOOR, ROOF... */
  predefinedType?: string;
  /** IFC class in capitals (IFCCOLUMN...), for the label in the NetFloorArea cell. */
  ifcType?: string;
}
/** IfcOpeningElement that cuts a slab (`host` = GlobalId of the slab). */
export interface Opening extends Element {
  host: string;
}
export interface SpaceInput extends Element {
  /** Qto_SpaceBaseQuantities from the file, converted to m / m2 / m3. */
  qto: Record<string, number>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

interface Region {
  rings: Ring[];
  z0: number;
  z1: number;
  /** Plan envelope (x0, y0, x1, y1) for quick rejection. */
  plan: [number, number, number, number];
}

function region(b: Body): Region | null {
  if (!b.prisms.length) return null;
  // Several solids of an element = union as a sum (assumption: they do not overlap).
  const rings = b.prisms.flatMap((p) => p.rings);
  const plan: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r.pts) {
    if (x < plan[0]) plan[0] = x;
    if (y < plan[1]) plan[1] = y;
    if (x > plan[2]) plan[2] = x;
    if (y > plan[3]) plan[3] = y;
  }
  return { rings, z0: Math.min(...b.prisms.map((p) => p.z0)), z1: Math.max(...b.prisms.map((p) => p.z1)), plan };
}

const planDisjoint = (a: Region["plan"], b: Region["plan"]) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];

function judge(file: number | undefined, computed: number, kind: QuantityKind): Status {
  if (file == null) return "grey";
  return withinTolerance(file, computed, kind) ? "green" : "red";
}

/** Elements whose plan covers at least `minShare` of the space plan; an intersection under `min_overlap_m2` is only a touch (B4). */
function overlapping(space: Region, others: Element[], minShare: number) {
  const a = regionArea(space.rings);
  const floor = Math.max(minShare * a, SELECTION.min_overlap_m2);
  return others
    .map((e) => {
      const r = region(e.body);
      if (!r || planDisjoint(space.plan, r.plan)) return null;
      return { e, r, overlap: regionIntersectionArea(space.rings, r.rings) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.overlap > floor);
}

/**
 * Elements of the given class without a solid (neither extrusion nor closed mesh) that can be in the space plan and at height
 * [lo, hi]: the envelope overlaps, or the envelope is unknown. When the reference is missing and such an element exists, the result is
 * "cannot be verified" (grey), not a finding (D-185 fix B2).
 */
function unresolved(space: Region, others: Element[], lo: number, hi: number): Element[] {
  return others.filter((e) => {
    if (e.body.prisms.length) return false;
    const b = e.body.bbox;
    if (!b) return true;
    return !planDisjoint(space.plan, [b.min[0], b.min[1], b.max[0], b.max[1]]) && b.max[2] >= lo && b.min[2] <= hi;
  });
}

const names = (els: Element[]) => els.slice(0, 5).map((e) => e.name).join(", ") + (els.length > 5 ? ` a ďalšie (${els.length})` : "");
const cannot = (what: string, els: Element[]) =>
  `nedá sa overiť: ${what} v pôdoryse miestnosti nemá teleso (${els.length}: ${names(els)}; ${els[0].body.unsupported ?? "bez telesa"})`;

/** Different heights (clustered by the length tolerance) sorted ascending. */
function distinct(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > TOLERANCES.length.abs!) out.push(v);
  return out;
}

/**
 * Volume of the covering inside the space solid (NetVolume @3): sum over pairs of space and covering solids of the
 * plan intersection x overlap of height ranges. Exact for extrusions (vertical prisms). Covering from a closed mesh:
 * prismatic estimate multiplied by the fullness of the mesh (mesh volume / (plan x height)), so that a sloped or stepped solid
 * does not subtract more than it has; an open mesh only prismatically.
 */
export function cutVolume(space: Body, cov: Body): { volume: number; area: number; dz: number; exact: boolean; how: string } {
  let volume = 0;
  let area = 0;
  let dz = 0;
  let pairs = 0;
  for (const sp of space.prisms) for (const cp of cov.prisms) {
    const h = Math.min(sp.z1, cp.z1) - Math.max(sp.z0, cp.z0);
    if (h <= 0) continue;
    const a = regionIntersectionArea(sp.rings, cp.rings);
    if (a <= SELECTION.min_overlap_m2) continue;
    volume += a * h;
    area += a;
    dz = h;
    pairs++;
  }
  let how = `prienik ${pairs} telies`;
  if (cov.source === "mesh" && cov.mesh && cov.prisms.length) {
    const p = cov.prisms[0];
    const prismatic = regionArea(p.rings) * (p.z1 - p.z0);
    const fill = prismatic > 0 ? Math.min(1, Math.max(0, cov.mesh.volume / prismatic)) : 1;
    volume *= fill;
    how = `uzavretý mesh, plnosť ${r4(fill)}`;
  } else if (cov.source === "mesh_open") how = "neuzavretý mesh, prizmaticky";
  const exact = pairs === 1 && cov.source === "extrusion" && (space.source === "extrusion" || space.source === "mesh");
  return { volume, area, dz, exact, how };
}

export interface Context {
  slabs: Element[];
  coverings: Element[];
  /** NetFloorArea: elements of the classes `NET_FLOOR_AREA` (columns, walls, built-ins) of the model; without them nothing is subtracted. */
  inner?: Element[];
  /** NetFloorArea: openings cutting slabs of the model. */
  slabOpenings?: Opening[];
}

function base(key: SpaceMethodKey, body?: Body) {
  const m: QuantityMethod = SPACE_METHODS[key];
  const meshNote = body?.source === "mesh" ? " (teleso miestnosti: uzavretý mesh motora, náhrada za extrúziu)"
    : body?.source === "mesh_open" ? " (teleso miestnosti: NEUZAVRETÝ mesh motora, len výška, pôdorys a obvod; nesúlad = sivá)" : "";
  return { target: m.target, recipe: m.id, method: m.method + meshNote, explanation: m.explanation, definition: m.definition, spec_ref: m.spec_ref, tolerance: TOLERANCES[m.kind].text };
}

/** Cell key by order: A, B, ... Z, then X27, X28... */
const cellKey = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `X${i + 1}`);
/** Cells in the order of keys A, B, ... (value rounded to 4 decimal places like the formula). */
function cells(...items: Array<Omit<Cell, "key">>): Cell[] {
  return items.map((c, i) => ({ key: cellKey(i), ...c, value: r4(c.value) }));
}
/** Expression `A - B - C` over n cells. */
const minus = (n: number) => Array.from({ length: n }, (_, i) => cellKey(i)).join(" - ");

const ALL_KEYS = ["height_own", "height_slabs", "gross_floor_area", "net_floor_area", "gross_perimeter", "gross_volume", "ffh", "fch", "net_volume"] as const;

/** Result for multiple heights (constancy rule from the schema). */
function nonConstant(key: SpaceMethodKey, file: number | undefined, heights: number[], ref: number, anchors: Anchor[], body: Body): RecipeResult {
  const values = heights.map((h) => r4(h - ref));
  const what = key === "ffh" ? "výška podlahoviny" : "výška podhľadu";
  return {
    ...base(key, body),
    cells: cells(...values.map((v, i) => ({ label: `${what} ${i + 1} v pôdoryse miestnosti`, value: v, unit: "m" as const }))),
    status: file == null ? "green" : "red",
    file,
    distinct_heights: values,
    note: file == null
      ? `správne neuvedená: v pôdoryse miestnosti je ${values.length} výšok (${values.join(", ")} m)`
      : `vlastnosť nie je jednoznačná, miestnosť má ${values.length} výšok (${values.join(", ")} m). ${NON_CONSTANT_RULE.text}`,
    anchors,
  };
}

/** Label of the subtracted NetFloorArea element by IFC class: [genitive into the cell, anchor role]. */
function innerWhat(e: Element): [string, string] {
  const t = e.ifcType ?? "";
  if (t.startsWith("IFCCOLUMN")) return ["stĺpa", "stĺp"];
  if (t.startsWith("IFCWALL")) return ["steny", "stena"];
  if (t === "IFCCHIMNEY") return ["komína", "komín"];
  return ["vstavky", "vstavka"];
}

/**
 * NetFloorArea (`space.netfloorarea.profile@1`, rules `NET_FLOOR_AREA`): GrossFloorArea from geometry minus the plan of elements
 * inside the space and of openings in the slab below it, each only within the range of the space plan. A piece carries only the part that
 * the piece before it did not subtract (intersection of three plans), so an overlap is not subtracted twice.
 */
function netFloorArea(
  s: SpaceInput,
  own: Region,
  A: number,
  floorLevel: number,
  ctx: Context,
  openJudge: (file: number | undefined, v: number, kind: QuantityKind) => { status: Status; note?: string },
): RecipeResult {
  const body = s.body;
  const sp = s.globalId;
  const c = SELECTION.contact_m;
  const band = NET_FLOOR_AREA.floor_band_m;
  const file = s.qto.NetFloorArea;
  /** The element protrudes above the finished floor and reaches into the band above it (not a wall of the storey below the space nor a beam under the ceiling). */
  const inBand = (r: { z0: number; z1: number }) => r.z1 > floorLevel + c && r.z0 < floorLevel + band;
  const inner = ctx.inner ?? [];
  const openings = ctx.slabOpenings ?? [];

  /** A subtraction piece; `opening` = an opening or hole in the slab (they go after the elements, so their subtraction does not change the element cells). */
  interface Piece { e: Element; rings: Ring[]; plan: Region["plan"]; label: string; role: string; opening: boolean }
  const pieces: Piece[] = [];
  for (const x of overlapping(own, inner, 0)) {
    if (!inBand(x.r)) continue;
    const [gen, nom] = innerWhat(x.e);
    pieces.push({ e: x.e, rings: x.r.rings, plan: x.r.plan, label: `pôdorys ${gen} vnútri miestnosti`, role: `${nom} vnútri miestnosti`, opening: false });
  }
  // Slab under the space: top at the bottom of the space; its openings and holes in the profile within the range of the space plan.
  const hosts = overlapping(own, ctx.slabs, 0).filter((x) => Math.abs(x.r.z1 - own.z0) <= c);
  const hostIds = new Set(hosts.map((x) => x.e.globalId));
  for (const x of overlapping(own, openings.filter((o) => hostIds.has(o.host)), 0)) {
    pieces.push({ e: x.e, rings: x.r.rings, plan: x.r.plan, label: "otvor v doske pod miestnosťou", role: "otvor v doske", opening: true });
  }
  for (const h of hosts) {
    for (const ring of h.r.rings.filter((q) => q.sign < 0)) {
      const rings: Ring[] = [{ pts: ring.pts, sign: 1 }];
      if (regionIntersectionArea(own.rings, rings) <= SELECTION.min_overlap_m2) continue;
      pieces.push({ e: h.e, rings, plan: box2(ring.pts), label: `diera v profile dosky ${h.e.name} pod miestnosťou`, role: "diera v doske", opening: true });
    }
  }
  // Net part of the piece: intersection with the space minus intersection with the space and the pieces before it.
  const parts: Array<Piece & { value: number; shared: boolean }> = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    let v = regionIntersectionArea(own.rings, p.rings);
    let shared = false;
    for (let j = 0; j < i; j++) {
      if (planDisjoint(p.plan, pieces[j].plan)) continue;
      const both = regionIntersectionArea3(own.rings, p.rings, pieces[j].rings);
      if (both > SELECTION.min_overlap_m2) {
        v -= both;
        shared = true;
      }
    }
    if (v > SELECTION.min_overlap_m2) parts.push({ ...p, value: v, shared });
  }
  const nfa = A - parts.reduce((sum, x) => sum + x.value, 0);
  const self: Anchor = { global_id: sp, role: "teleso miestnosti" };
  const anchors: Anchor[] = [self, ...parts.map((x) => ({ global_id: x.e.globalId, role: x.role }))];
  let { status, note } = openJudge(file, nfa, "area");
  if (status === "red" && parts.some((x) => x.opening)) {
    const withoutOpenings = A - parts.filter((x) => !x.opening).reduce((sum, x) => sum + x.value, 0);
    if (withinTolerance(file!, withoutOpenings, "area")) {
      status = "yellow";
      note = `${NFA_OPENINGS_RULE.text} (${r4(withoutOpenings)} m2)`;
    }
  }
  // Element without a solid in the floor band or a slab under the space without a solid: the mismatch is not certain (D-185 B2).
  const missing = [
    ...unresolved(own, inner, floorLevel + c, floorLevel + band),
    ...unresolved(own, openings.filter((o) => hostIds.has(o.host)), own.z0 - 1, own.z0 + c),
    ...unresolved(own, ctx.slabs, own.z0 - c, own.z0 + c),
  ];
  if (status === "red" && missing.length) {
    status = "grey";
    note = cannot("prvok vnútri miestnosti alebo doska pod ňou", missing);
  }
  // The subtracted element is a CSG operand (wall with openings) or an open mesh: its plan is only an upper estimate.
  const rough = parts.filter((x) => x.e.body.unsupported);
  if (status === "red" && rough.length) {
    status = "grey";
    note = `nedá sa overiť: pôdorys odčítaného prvku je len horný odhad (${names(rough.map((x) => x.e))}; ${rough[0].e.body.unsupported})`;
  }
  const cut = A - nfa;
  if (!note && cut > 0 && file != null && cut <= (toleranceAbs("area", file) ?? 0)) {
    note = `odpočet ${r4(cut)} m2 je v tolerancii plochy: zhoda nerozlíši, či súbor odpočet urobil`;
  }
  return {
    ...base("net_floor_area", body), status, file, computed: r4(nfa),
    expression: minus(parts.length + 1),
    cells: cells(
      { label: "GrossFloorArea miestnosti (z geometrie)", value: A, unit: "m2", global_id: sp, quantity: "Qto_SpaceBaseQuantities.GrossFloorArea" },
      ...parts.map((x) => ({ label: x.shared ? `${x.label} (bez časti už odčítanej)` : x.label, value: x.value, unit: "m2" as const, global_id: x.e.globalId })),
    ),
    formula: `${r4(A)} - ${parts.map((x) => `${r4(x.value)} (${x.e.name})`).join(" - ") || "0"} = ${r4(nfa)} m2`,
    ...(note ? { note } : {}),
    anchors,
  };
}

export function verifySpace(s: SpaceInput, ctx: Context): RecipeResult[] {
  const out: RecipeResult[] = [];
  const own = region(s.body);
  if (!own) {
    for (const k of ALL_KEYS) {
      const b = base(k);
      out.push({ ...b, status: "grey", file: s.qto[b.target.split(".")[1]], note: s.body.unsupported ?? "miestnosť nemá teleso", anchors: [] });
    }
    return out;
  }
  const body = s.body;
  const isMesh = (body.source === "mesh" || body.source === "mesh_open") && !!body.mesh;
  /** Open mesh: the mismatch need not be a quantity error (the plan may be incomplete), hence grey, not red. */
  const open = body.source === "mesh_open";
  const openJudge = (file: number | undefined, v: number, kind: QuantityKind): { status: Status; note?: string } => {
    const st = judge(file, v, kind);
    return open && st === "red" ? { status: "grey", note: `nedá sa overiť: ${body.unsupported}` } : { status: st };
  };
  const A = regionArea(own.rings);
  const P = isMesh ? body.mesh!.perimeter : regionPerimeter(own.rings);
  const H = own.z1 - own.z0;
  const gv = open ? NaN : isMesh ? body.mesh!.volume : body.prisms.reduce((sum, p) => sum + regionArea(p.rings) * (p.z1 - p.z0), 0);
  const self: Anchor = { global_id: s.globalId, role: "teleso miestnosti" };
  const modified = body.unsupported ? `; ${body.unsupported}` : "";
  const c = SELECTION.contact_m;

  const sp = s.globalId;
  out.push({ ...base("height_own", body), ...openJudge(s.qto.Height, H, "length"), file: s.qto.Height, computed: r4(H),
    expression: "A - B", cells: cells({ label: "vrch telesa miestnosti", value: own.z1, unit: "m", global_id: sp }, { label: "spodok telesa miestnosti", value: own.z0, unit: "m", global_id: sp }),
    formula: `${r3(own.z1)} - ${r3(own.z0)} = ${r4(H)} m`, anchors: [{ ...self, z_m: own.z0 }, { ...self, z_m: own.z1 }], dimension: { z0: own.z0, z1: own.z1 } });
  out.push({ ...base("gross_floor_area", body), ...openJudge(s.qto.GrossFloorArea, A, "area"), file: s.qto.GrossFloorArea, computed: r4(A),
    expression: "A", cells: cells({ label: isMesh ? "plocha pôdorysu meshu miestnosti (plochy s normálou nadol)" : "plocha profilu telesa miestnosti", value: A, unit: "m2", global_id: sp }),
    formula: isMesh ? `priemet plôch meshu s normálou nadol = ${r4(A)} m2` : `plocha profilu = ${r4(A)} m2`, anchors: [self] });
  out.push({ ...base("gross_perimeter", body), ...openJudge(s.qto.GrossPerimeter, P, "perimeter"), file: s.qto.GrossPerimeter, computed: r4(P),
    expression: "A", cells: cells({ label: isMesh ? "obvod pôdorysu meshu miestnosti" : "obvod vonkajšej slučky profilu miestnosti", value: P, unit: "m", global_id: sp }),
    formula: isMesh ? `obvod pôdorysu meshu = ${r4(P)} m` : `obvod vonkajšej slučky = ${r4(P)} m`, anchors: [self] });
  if (open) out.push({ ...base("gross_volume", body), status: "grey", file: s.qto.GrossVolume, note: `nedá sa overiť: ${body.unsupported}`, anchors: [self] });
  else out.push({ ...base("gross_volume", body), status: judge(s.qto.GrossVolume, gv, "volume"), file: s.qto.GrossVolume, computed: r4(gv),
    ...(isMesh
      ? { expression: "A", cells: cells({ label: "objem uzavretého meshu miestnosti", value: gv, unit: "m3", global_id: sp }) }
      : body.prisms.length === 1
        ? { expression: "A x B", cells: cells({ label: "plocha profilu miestnosti", value: A, unit: "m2", global_id: sp }, { label: "výška extrúzie miestnosti", value: H, unit: "m", global_id: sp, quantity: "Qto_SpaceBaseQuantities.Height" }) }
        : { expression: "A", cells: cells({ label: `objem telesa miestnosti (${body.prisms.length} hranoly, súčet plocha x výška)`, value: gv, unit: "m3", global_id: sp }) }),
    formula: isMesh ? `objem uzavretého meshu = ${r4(gv)} m3` : `${r4(A)} x ${r4(H)} = ${r4(gv)} m3${modified}`, anchors: [self] });

  // Slabs below and above.
  const slabs = overlapping(own, ctx.slabs, SELECTION.slab_min_overlap);
  const below = slabs.filter((x) => Math.abs(x.r.z1 - own.z0) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  const above = slabs.filter((x) => Math.abs(x.r.z0 - own.z1) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  if (below && above) {
    const hs = above.r.z0 - below.r.z1;
    out.push({ ...base("height_slabs", body), status: judge(s.qto.Height, hs, "length"), file: s.qto.Height, computed: r4(hs),
      expression: "A - B",
      cells: cells({ label: "spodok dosky nad", value: above.r.z0, unit: "m", global_id: above.e.globalId }, { label: "vrch dosky pod", value: below.r.z1, unit: "m", global_id: below.e.globalId }),
      formula: `spodok(${above.e.name}) - vrch(${below.e.name}) = ${r3(above.r.z0)} - ${r3(below.r.z1)} = ${r4(hs)} m`,
      anchors: [{ global_id: below.e.globalId, role: "doska pod", z_m: below.r.z1 }, { global_id: above.e.globalId, role: "doska nad", z_m: above.r.z0 }],
      dimension: { z0: below.r.z1, z1: above.r.z0 } });
  } else {
    const missing = unresolved(own, ctx.slabs, own.z0 - 1, own.z1 + 1);
    out.push({ ...base("height_slabs", body), status: "grey", file: s.qto.Height,
      note: missing.length ? cannot("doska", missing) : `${below ? "" : "doska pod nenájdená; "}${above ? "" : "doska nad nenájdená"}`.trim(), anchors: [] });
  }

  // Floor covering; without a found floor covering FFH is grey (B2).
  const floorings = ctx.coverings.filter((x) => x.predefinedType === "FLOORING");
  const floors = overlapping(own, floorings, SELECTION.flooring_min_overlap).filter((x) => x.r.z0 >= own.z0 - c && x.r.z1 <= own.z1);
  const floorTops = distinct(floors.map((x) => x.r.z1));
  const floorAnchors = floors.map((x) => ({ global_id: x.e.globalId, role: "podlahovina", z_m: x.r.z1 }));
  const floorTop = floorTops.length === 1 ? floorTops[0] : null;
  const floorMissing = unresolved(own, floorings, own.z0 - c, own.z1);
  if (floorTops.length > 1) out.push(nonConstant("ffh", s.qto.FinishFloorHeight, floorTops, own.z0, [{ ...self, z_m: own.z0 }, ...floorAnchors], body));
  else if (floorTop != null) {
    const ffh = floorTop - own.z0;
    // Constant floor covering and the file gives no value: the schema requires it for a constant height -> yellow (D-185 addendum 2).
    const absent = s.qto.FinishFloorHeight == null;
    const topFloor = floors.filter((x) => Math.abs(x.r.z1 - floorTop) <= TOLERANCES.length.abs!).sort((a, b) => b.overlap - a.overlap)[0];
    out.push({ ...base("ffh", body), status: absent ? "yellow" : judge(s.qto.FinishFloorHeight, ffh, "length"), file: s.qto.FinishFloorHeight, computed: r4(ffh),
      ...(absent ? { note: FFH_ABSENT_RULE.text } : {}),
      expression: "A - B",
      cells: cells({ label: "vrch podlahoviny", value: floorTop, unit: "m", global_id: topFloor?.e.globalId }, { label: "spodok telesa miestnosti", value: own.z0, unit: "m", global_id: sp }),
      formula: `vrch(podlahovina) - spodok(miestnosť) = ${r3(floorTop)} - ${r3(own.z0)} = ${r4(ffh)} m`, anchors: [{ ...self, z_m: own.z0 }, ...floorAnchors],
      dimension: { z0: own.z0, z1: floorTop } });
  } else {
    out.push({ ...base("ffh", body), status: "grey", file: s.qto.FinishFloorHeight,
      note: floorMissing.length ? cannot("podlahovina", floorMissing) : "podlahovina v pôdoryse miestnosti nenájdená", anchors: [] });
  }

  // NetFloorArea: elements must protrude above the finished floor (top of the floor covering, without it the bottom of the space).
  out.push(netFloorArea(s, own, A, floorTop ?? own.z0, ctx, openJudge));

  // Ceiling: every ceiling with an overlap of at least ceiling_min_overlap is one height; several heights = the constancy rule.
  const ceilingEls = ctx.coverings.filter((x) => x.predefinedType === "CEILING");
  const ceilings = overlapping(own, ceilingEls, SELECTION.ceiling_min_overlap).filter((x) => x.r.z0 > own.z0 && x.r.z1 <= own.z1 + c);
  const ceilingMissing = unresolved(own, ceilingEls, own.z0, own.z1 + c);
  // Reference floor: the found floor covering; without it only when the file gives no floor covering (FFH 0 or missing).
  const noFloorInFile = !(s.qto.FinishFloorHeight > 0);
  const ref = floorTop ?? (noFloorInFile && !floorMissing.length ? own.z0 : null);
  const ceilingAnchors = ceilings.map((x) => ({ global_id: x.e.globalId, role: "podhľad", z_m: x.r.z0 }));
  const bottoms = distinct(ceilings.map((x) => x.r.z0));
  if (bottoms.length && ref == null) {
    out.push({ ...base("fch", body), status: "grey", file: s.qto.FinishCeilingHeight,
      note: floorMissing.length ? cannot("podlahovina (vzťažná úroveň podhľadu)", floorMissing) : "podlahovina nenájdená, výška podhľadu sa nedá merať od podlahy", anchors: ceilingAnchors });
  } else if (bottoms.length > 1) out.push(nonConstant("fch", s.qto.FinishCeilingHeight, bottoms, ref!, [{ ...self, z_m: ref! }, ...ceilingAnchors], body));
  else if (bottoms.length === 1) {
    const fch = bottoms[0] - ref!;
    const ceiling = ceilings.filter((x) => Math.abs(x.r.z0 - bottoms[0]) <= TOLERANCES.length.abs!).sort((a, b) => b.overlap - a.overlap)[0];
    const floorEl = floorTop != null ? floors.filter((x) => Math.abs(x.r.z1 - floorTop) <= TOLERANCES.length.abs!).sort((a, b) => b.overlap - a.overlap)[0] : undefined;
    out.push({ ...base("fch", body), status: judge(s.qto.FinishCeilingHeight, fch, "length"), file: s.qto.FinishCeilingHeight, computed: r4(fch),
      expression: "A - B",
      cells: cells(
        { label: "spodok podhľadu", value: bottoms[0], unit: "m", global_id: ceiling?.e.globalId },
        floorTop != null
          ? { label: "vrch podlahoviny", value: ref!, unit: "m", global_id: floorEl?.e.globalId }
          : { label: "spodok telesa miestnosti (súbor podlahovinu neuvádza)", value: ref!, unit: "m", global_id: sp },
      ),
      formula: `spodok(podhľad) - vrch(podlahy) = ${r3(bottoms[0])} - ${r3(ref!)} = ${r4(fch)} m`, anchors: [{ ...self, z_m: ref! }, ...ceilingAnchors],
      dimension: { z0: ref!, z1: bottoms[0] } });
  } else if (ceilingMissing.length) {
    out.push({ ...base("fch", body), status: "grey", file: s.qto.FinishCeilingHeight, note: cannot("podhľad", ceilingMissing), anchors: [] });
  } else {
    out.push({ ...base("fch", body), status: s.qto.FinishCeilingHeight == null ? "green" : "red", file: s.qto.FinishCeilingHeight,
      note: s.qto.FinishCeilingHeight == null ? "bez podhľadu, hodnota správne neuvedená" : "podhľad nad miestnosťou nenájdený", anchors: [] });
  }

  // NetVolume = GrossVolume - volume of intersections of floor coverings and ceilings (NET_VOLUME_COVERINGS, B3) with the space solid (@3).
  const subtracted = ctx.coverings.filter((x) => NET_VOLUME_COVERINGS.includes(x.predefinedType ?? ""));
  const nvMissing = unresolved(own, subtracted, own.z0 - c, own.z1 + c);
  const parts = overlapping(own, subtracted, 0)
    .map((x) => ({ ...x, cut: cutVolume(body, x.e.body), dz: Math.max(0, Math.min(x.r.z1, own.z1) - Math.max(x.r.z0, own.z0)) }))
    .filter((x) => x.cut.volume > 0);
  const nv = gv - parts.reduce((sum, x) => sum + x.cut.volume, 0);
  const nvFile = s.qto.NetVolume;
  const nvTol = nvFile != null && s.qto.GrossVolume != null ? netVolumeTolerance(s.qto.GrossVolume, nvFile) : null;
  const within = (v: number) => nvFile != null && nvTol != null && Math.abs(v - nvFile) <= nvTol.abs_m3;
  let nvStatus: Status = nvFile == null || !nvTol ? "grey" : within(nv) ? "green" : "red";
  let note: string | undefined = nvFile != null && !nvTol ? "chýba GrossVolume zo súboru, tolerancia NetVolume sa nedá určiť" : undefined;
  if (nvStatus === "red") {
    const full = gv - parts.reduce((sum, x) => sum + A * x.dz, 0);
    if (within(full)) {
      nvStatus = "yellow";
      note = `sedí len metóda "krytiny po celej ploche miestnosti" (${r4(full)} m3), nie prienik podľa schémy`;
    }
  }
  if (nvStatus !== "green" && nvMissing.length) {
    nvStatus = "grey";
    note = cannot("krytina (podlahovina alebo podhľad)", nvMissing);
  }
  if (open) {
    out.push({ ...base("net_volume", body), status: "grey", file: nvFile, note: `nedá sa overiť: ${body.unsupported}`, anchors: [self] });
    return out;
  }
  const term = (x: (typeof parts)[number]) =>
    x.cut.exact ? `${r4(x.cut.area)} x ${r4(x.cut.dz)} (${x.e.name})` : `${r4(x.cut.volume)} (${x.e.name}, ${x.cut.how})`;
  const covWhat = (x: (typeof parts)[number]) => (x.e.predefinedType === "CEILING" ? "podhľadu" : "podlahoviny");
  out.push({ ...base("net_volume", body), ...(nvTol ? { tolerance: nvTol.text } : {}), status: nvStatus, file: nvFile, computed: r4(nv),
    expression: minus(parts.length + 1),
    cells: cells(
      { label: "GrossVolume miestnosti (z geometrie)", value: gv, unit: "m3", global_id: sp, quantity: "Qto_SpaceBaseQuantities.GrossVolume" },
      ...parts.map((x) => ({
        label: x.cut.exact ? `objem ${covWhat(x)} vnútri telesa (${r4(x.cut.area)} m2 x ${r4(x.cut.dz)} m)` : `objem ${covWhat(x)} vnútri telesa (${x.cut.how})`,
        value: x.cut.volume, unit: "m3" as const, global_id: x.e.globalId,
      })),
    ),
    formula: `${r4(gv)} - ${parts.map(term).join(" - ") || "0"} = ${r4(nv)} m3`, note,
    anchors: [self, ...parts.map((x) => ({ global_id: x.e.globalId, role: "krytina vnútri telesa" }))] });

  return out;
}

/** Centroid of the space plan = the place where vertical marks are drawn. */
export function dimensionPoint(s: SpaceInput): Pt | null {
  if (s.body.mesh) return s.body.mesh.centroid;
  const r = region(s.body);
  return r ? centroid(r.rings) : null;
}
