import { GeometryProcessor } from "@ifc-lite/geometry";

import {
  NET_VOLUME_COVERINGS,
  NON_CONSTANT_RULE,
  SELECTION,
  SPACE_METHODS,
  TOLERANCES,
  netVolumeTolerance,
  withinTolerance,
  type QuantityKind,
  type QuantityMethod,
  type SpaceMethodKey,
} from "../verify/quantity-methods";

/**
 * Overovač výmer IfcSpace voči geometrii (D-185): čisté výpočty; zapojenie do `ifc_measure verify=true`
 * je v `space-verify-run.ts`.
 *
 * Vlastné telesá z `extractExtrusionDefinitions` (`@ifc-lite/geometry`, presné zdrojové
 * parametre extrúzie bez tesselácie) ako zvislé hranoly: pôdorys (prstence s dierami) v IFC
 * svete (m) a rozsah z0..z1. Recepty porovnajú Qto_SpaceBaseQuantities zo súboru s hodnotou
 * z hranolov miestnosti, dosiek a krytín, ktoré sa s miestnosťou prekrývajú v pôdoryse
 * (presný 2D prienik), a vrátia stav, metódu, definíciu, toleranciu, vzorec s dosadenými
 * číslami a kotvy na kóty. Pravidlá (tolerancie, výber, konštantnosť) sú v registri
 * `lib/verify/quantity-methods.ts`, nie tu.
 *
 * Prvok bez použiteľnej extrúzie (iná reprezentácia, profil odmietnutý ifc-lite, šikmá extrúzia alebo len
 * časť telies) dostane teleso z uzavretého meshu motora (`bodyFromMeshTriangles`); sivý je len pri neuzavretom
 * meshi. Zatiaľ nie: ďalšie analytické tvary (IfcSweptDiskSolid, IfcRevolvedAreaSolid...).
 */

export type Pt = [number, number];
export interface Ring {
  pts: Pt[];
  /** +1 = vonkajší, -1 = diera. */
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
  /** Dôvod, prečo prvok nemá (celé) analytické teleso. */
  unsupported?: string;
  /** Odkiaľ je teleso: analytická extrúzia, alebo náhrada z uzavretého meshu motora. */
  source?: "extrusion" | "mesh";
  /** Pri meshi: prstence prizmy sú trojuholníky pôdorysu, preto objem, obvod a ťažisko nesie mesh. */
  mesh?: { volume: number; perimeter: number; centroid: Pt };
  /** Obálka v IFC svete (aj pri neuzavretom meshi): rozhodne, či prvok bez telesa môže byť referenciou miestnosti. */
  bbox?: { min: Vec3; max: Vec3 };
}

// ── 2D geometria ─────────────────────────────────────────────────────────────

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

/** Odstráni zdvojené a kolineárne body (inak ear clipping uviazne). */
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

/** Ear clipping jednoduchého polygónu (bez dier) na trojuholníky (proti smeru hodín). */
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
      if (cross(a, b, c) <= 1e-12) continue; // reflexný vrchol
      const inside = p.some((q) => q !== a && q !== b && q !== c && inTriangle(q, a, b, c));
      if (inside) continue;
      tris.push([a, b, c]);
      p = p.filter((_, k) => k !== i);
      cut = true;
      break;
    }
    if (!cut) break; // degenerovaný vstup: zvyšok sa zahodí (plocha by bola nepresná, hlási sa cez kontrolu plochy)
  }
  if (p.length === 3) tris.push([p[0], p[1], p[2]]);
  return tris;
}

/** Sutherland-Hodgman: ľubovoľný polygón orezaný konvexným trojuholníkom (proti smeru hodín). */
function clipByTriangle(subject: readonly Pt[], tri: readonly [Pt, Pt, Pt]): Pt[] {
  let out = [...subject];
  for (let e = 0; e < 3 && out.length; e++) {
    const a = tri[e];
    const b = tri[(e + 1) % 3];
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

/** Plocha prieniku dvoch jednoduchých polygónov (m2), presne. */
export function ringIntersectionArea(a: readonly Pt[], b: readonly Pt[]): number {
  let area = 0;
  for (const t of triangulate(a)) {
    const clipped = clipByTriangle(b, t);
    if (clipped.length >= 3) area += Math.abs(signedArea(clipped));
  }
  return area;
}

/** Plocha prieniku dvoch pôdorysov s dierami (inklúzia-exklúzia po prstencoch). */
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

// ── extrúzie z ifc-lite -> hranoly ───────────────────────────────────────────

type Mat = readonly number[];
/** Stĺpcová 4x4 matica krát bod (w = 1) alebo vektor (w = 0). */
const mul = (m: Mat, v: readonly number[], w: number) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
const matMul = (a: Mat, b: Mat) => Array.from({ length: 16 }, (_, i) => {
  const c = Math.floor(i / 4);
  const r = i % 4;
  return a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
});
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Oblúk sa vzorkuje (32 úsekov, chyba plochy kruhu pod 0,7 %); presne by sa rátal kruhový výsek. */
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

/** Hranoly prvkov zo zdrojov extrúzií; len zvislé extrúzie (os po transformácii rovnobežná so Z). */
export function bodiesFromExtrusions(defs: ExtrusionDefinitionsLike, ids: readonly number[]): Map<number, Body> {
  const byKey = new Map(defs.sources.map((s) => [JSON.stringify(s.key), s]));
  const out = new Map<number, Body>();
  for (const id of ids) {
    const inst = defs.instances[id] ?? [];
    const body: Body = { expressId: id, prisms: [] };
    if (!inst.length) body.unsupported = "bez extrúzie (Brep, CSG alebo iná reprezentácia)";
    /** Dôvod odmietnutia časti telies: prvok sa potom nepočíta z časti (D-185 oprava B1). */
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

/** Hranoly prvkov a dĺžková jednotka súboru (m na jednotku), na prevod Qto dĺžok. */
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

// ── náhrada telesa z meshu ───────────────────────────────────────────────────

/**
 * Teleso z trojuholníkov meshu v IFC svete (9 čísel na trojuholník): pôdorys = priemet plôch s normálou nadol
 * (každý trojuholník je prstenec), obvod = hrany pôdorysu bez suseda (zaokrúhlené na mm), ťažisko vážené plochou,
 * z0 / z1 z vrcholov. `closed` a `volume` dodá motor (`meshMetrics`); neuzavretý mesh nedá teleso, len obálku.
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
  if (!closed) return { expressId, prisms: [], unsupported: "mesh nie je uzavretý, objem ani pôdorys sa z neho nedajú overiť", ...(bbox ? { bbox } : {}) };
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
    if (len === 0 || nz / len > -1e-6) continue; // len plochy s normálou nadol
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
  if (!rings.length) return { expressId, prisms: [], unsupported: "mesh bez plôch s normálou nadol", ...(bbox ? { bbox } : {}) };
  let perimeter = 0;
  for (const e of edges.values()) if (e.n === 1) perimeter += e.len;
  return {
    expressId,
    prisms: [{ rings, z0: min[2], z1: max[2] }],
    source: "mesh",
    mesh: { volume, perimeter, centroid: [cx / area, cy / area] },
    bbox: { min, max },
  };
}

// ── recepty IfcSpace (pravidlá: lib/verify/quantity-methods.ts) ───────────────

export type Status = "green" | "yellow" | "red" | "grey";

export interface Anchor {
  global_id: string;
  role: string;
  z_m?: number;
}
export interface RecipeResult {
  target: string;
  /** Recept s verziou z registra metód. */
  recipe: string;
  status: Status;
  /** Čo sa z geometrie meria a doslovná definícia zo schémy (register metód). */
  method: string;
  definition: string;
  spec_ref: string;
  /** Použitá tolerancia (text z registra). */
  tolerance: string;
  file?: number;
  computed?: number;
  /** Vzorec s dosadenými číslami (m, m2, m3). */
  formula?: string;
  note?: string;
  /** Pravidlo konštantnosti: rôzne výšky v pôdoryse miestnosti (len pri viacerých). */
  distinct_heights?: number[];
  anchors: Anchor[];
  /** Zvislá kóta (z od - do, m v IFC svete) pre dĺžkové recepty; kreslí sa v ťažisku pôdorysu miestnosti. */
  dimension?: { z0: number; z1: number };
}

export interface Element {
  globalId: string;
  name: string;
  body: Body;
  /** Pre IfcCovering: CEILING, FLOORING...; pre IfcSlab: FLOOR, ROOF... */
  predefinedType?: string;
}
export interface SpaceInput extends Element {
  /** Qto_SpaceBaseQuantities zo súboru, prevedené na m / m2 / m3. */
  qto: Record<string, number>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

interface Region {
  rings: Ring[];
  z0: number;
  z1: number;
  /** Pôdorysná obálka (x0, y0, x1, y1) na rýchle vyradenie. */
  plan: [number, number, number, number];
}

function region(b: Body): Region | null {
  if (!b.prisms.length) return null;
  // Viac telies prvku = zjednotenie ako súčet (predpoklad: sa neprekrývajú).
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

/** Prvky, ktorých pôdorys pokrýva aspoň `minShare` pôdorysu miestnosti; prienik pod `min_overlap_m2` je len dotyk (B4). */
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
 * Prvky danej triedy bez telesa (ani extrúzia, ani uzavretý mesh), ktoré môžu byť v pôdoryse miestnosti a vo výške
 * [lo, hi]: obálka sa prekrýva, alebo obálku nepoznáme. Keď referencia chýba a taký prvok existuje, výsledok
 * "nedá sa overiť" (sivá), nie nález (D-185 oprava B2).
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

/** Rôzne výšky (zhlukované po tolerancii dĺžky) zoradené vzostupne. */
function distinct(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > TOLERANCES.length.abs!) out.push(v);
  return out;
}

export interface Context {
  slabs: Element[];
  coverings: Element[];
}

function base(key: SpaceMethodKey, body?: Body) {
  const m: QuantityMethod = SPACE_METHODS[key];
  const meshNote = body?.source === "mesh" ? " (teleso miestnosti: uzavretý mesh motora, náhrada za extrúziu)" : "";
  return { target: m.target, recipe: m.id, method: m.method + meshNote, definition: m.definition, spec_ref: m.spec_ref, tolerance: TOLERANCES[m.kind].text };
}

const ALL_KEYS = ["height_own", "height_slabs", "gross_floor_area", "gross_perimeter", "gross_volume", "ffh", "fch", "net_volume"] as const;

/** Výsledok pri viacerých výškach (pravidlo konštantnosti zo schémy). */
function nonConstant(key: SpaceMethodKey, file: number | undefined, heights: number[], ref: number, anchors: Anchor[], body: Body): RecipeResult {
  const values = heights.map((h) => r4(h - ref));
  return {
    ...base(key, body),
    status: file == null ? "green" : "red",
    file,
    distinct_heights: values,
    note: file == null
      ? `správne neuvedená: v pôdoryse miestnosti je ${values.length} výšok (${values.join(", ")} m)`
      : `vlastnosť nie je jednoznačná, miestnosť má ${values.length} výšok (${values.join(", ")} m). ${NON_CONSTANT_RULE.text}`,
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
  const isMesh = body.source === "mesh" && !!body.mesh;
  const A = regionArea(own.rings);
  const P = isMesh ? body.mesh!.perimeter : regionPerimeter(own.rings);
  const H = own.z1 - own.z0;
  const gv = isMesh ? body.mesh!.volume : body.prisms.reduce((sum, p) => sum + regionArea(p.rings) * (p.z1 - p.z0), 0);
  const self: Anchor = { global_id: s.globalId, role: "teleso miestnosti" };
  const modified = body.unsupported ? `; ${body.unsupported}` : "";
  const c = SELECTION.contact_m;

  out.push({ ...base("height_own", body), status: judge(s.qto.Height, H, "length"), file: s.qto.Height, computed: r4(H),
    formula: `${r3(own.z1)} - ${r3(own.z0)} = ${r4(H)} m`, anchors: [{ ...self, z_m: own.z0 }, { ...self, z_m: own.z1 }], dimension: { z0: own.z0, z1: own.z1 } });
  out.push({ ...base("gross_floor_area", body), status: judge(s.qto.GrossFloorArea, A, "area"), file: s.qto.GrossFloorArea, computed: r4(A),
    formula: isMesh ? `priemet plôch meshu s normálou nadol = ${r4(A)} m2` : `plocha profilu = ${r4(A)} m2`, anchors: [self] });
  out.push({ ...base("gross_perimeter", body), status: judge(s.qto.GrossPerimeter, P, "length"), file: s.qto.GrossPerimeter, computed: r4(P),
    formula: isMesh ? `obvod pôdorysu meshu = ${r4(P)} m` : `obvod vonkajšej slučky = ${r4(P)} m`, anchors: [self] });
  out.push({ ...base("gross_volume", body), status: judge(s.qto.GrossVolume, gv, "volume"), file: s.qto.GrossVolume, computed: r4(gv),
    formula: isMesh ? `objem uzavretého meshu = ${r4(gv)} m3` : `${r4(A)} x ${r4(H)} = ${r4(gv)} m3${modified}`, anchors: [self] });

  // Dosky pod a nad.
  const slabs = overlapping(own, ctx.slabs, SELECTION.slab_min_overlap);
  const below = slabs.filter((x) => Math.abs(x.r.z1 - own.z0) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  const above = slabs.filter((x) => Math.abs(x.r.z0 - own.z1) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  if (below && above) {
    const hs = above.r.z0 - below.r.z1;
    out.push({ ...base("height_slabs", body), status: judge(s.qto.Height, hs, "length"), file: s.qto.Height, computed: r4(hs),
      formula: `spodok(${above.e.name}) - vrch(${below.e.name}) = ${r3(above.r.z0)} - ${r3(below.r.z1)} = ${r4(hs)} m`,
      anchors: [{ global_id: below.e.globalId, role: "doska pod", z_m: below.r.z1 }, { global_id: above.e.globalId, role: "doska nad", z_m: above.r.z0 }],
      dimension: { z0: below.r.z1, z1: above.r.z0 } });
  } else {
    const missing = unresolved(own, ctx.slabs, own.z0 - 1, own.z1 + 1);
    out.push({ ...base("height_slabs", body), status: "grey", file: s.qto.Height,
      note: missing.length ? cannot("doska", missing) : `${below ? "" : "doska pod nenájdená; "}${above ? "" : "doska nad nenájdená"}`.trim(), anchors: [] });
  }

  // Podlahovina; bez nájdenej podlahoviny je FFH sivá (B2).
  const floorings = ctx.coverings.filter((x) => x.predefinedType === "FLOORING");
  const floors = overlapping(own, floorings, SELECTION.flooring_min_overlap).filter((x) => x.r.z0 >= own.z0 - c && x.r.z1 <= own.z1);
  const floorTops = distinct(floors.map((x) => x.r.z1));
  const floorAnchors = floors.map((x) => ({ global_id: x.e.globalId, role: "podlahovina", z_m: x.r.z1 }));
  const floorTop = floorTops.length === 1 ? floorTops[0] : null;
  const floorMissing = unresolved(own, floorings, own.z0 - c, own.z1);
  if (floorTops.length > 1) out.push(nonConstant("ffh", s.qto.FinishFloorHeight, floorTops, own.z0, [{ ...self, z_m: own.z0 }, ...floorAnchors], body));
  else if (floorTop != null) {
    const ffh = floorTop - own.z0;
    out.push({ ...base("ffh", body), status: judge(s.qto.FinishFloorHeight, ffh, "length"), file: s.qto.FinishFloorHeight, computed: r4(ffh),
      formula: `vrch(podlahovina) - spodok(miestnosť) = ${r3(floorTop)} - ${r3(own.z0)} = ${r4(ffh)} m`, anchors: [{ ...self, z_m: own.z0 }, ...floorAnchors],
      dimension: { z0: own.z0, z1: floorTop } });
  } else {
    out.push({ ...base("ffh", body), status: "grey", file: s.qto.FinishFloorHeight,
      note: floorMissing.length ? cannot("podlahovina", floorMissing) : "podlahovina v pôdoryse miestnosti nenájdená", anchors: [] });
  }

  // Podhľad: každý podhľad s prekryvom aspoň ceiling_min_overlap je jedna výška; viac výšok = pravidlo konštantnosti.
  const ceilingEls = ctx.coverings.filter((x) => x.predefinedType === "CEILING");
  const ceilings = overlapping(own, ceilingEls, SELECTION.ceiling_min_overlap).filter((x) => x.r.z0 > own.z0 && x.r.z1 <= own.z1 + c);
  const ceilingMissing = unresolved(own, ceilingEls, own.z0, own.z1 + c);
  // Vzťažná podlaha: nájdená podlahovina; bez nej len keď súbor podlahovinu neuvádza (FFH 0 alebo chýba).
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
    out.push({ ...base("fch", body), status: judge(s.qto.FinishCeilingHeight, fch, "length"), file: s.qto.FinishCeilingHeight, computed: r4(fch),
      formula: `spodok(podhľad) - vrch(podlahy) = ${r3(bottoms[0])} - ${r3(ref!)} = ${r4(fch)} m`, anchors: [{ ...self, z_m: ref! }, ...ceilingAnchors],
      dimension: { z0: ref!, z1: bottoms[0] } });
  } else if (ceilingMissing.length) {
    out.push({ ...base("fch", body), status: "grey", file: s.qto.FinishCeilingHeight, note: cannot("podhľad", ceilingMissing), anchors: [] });
  } else {
    out.push({ ...base("fch", body), status: s.qto.FinishCeilingHeight == null ? "green" : "red", file: s.qto.FinishCeilingHeight,
      note: s.qto.FinishCeilingHeight == null ? "bez podhľadu, hodnota správne neuvedená" : "podhľad nad miestnosťou nenájdený", anchors: [] });
  }

  // NetVolume = GrossVolume - prieniky podlahovín a podhľadov (NET_VOLUME_COVERINGS, B3) s telesom miestnosti, prizmaticky.
  const subtracted = ctx.coverings.filter((x) => NET_VOLUME_COVERINGS.includes(x.predefinedType ?? ""));
  const nvMissing = unresolved(own, subtracted, own.z0 - c, own.z1 + c);
  const parts = overlapping(own, subtracted, 0)
    .map((x) => ({ ...x, dz: Math.max(0, Math.min(x.r.z1, own.z1) - Math.max(x.r.z0, own.z0)) }))
    .filter((x) => x.dz > 0);
  const nv = gv - parts.reduce((sum, x) => sum + x.overlap * x.dz, 0);
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
  out.push({ ...base("net_volume", body), ...(nvTol ? { tolerance: nvTol.text } : {}), status: nvStatus, file: nvFile, computed: r4(nv),
    formula: `${r4(gv)} - ${parts.map((x) => `${r4(x.overlap)} x ${r4(x.dz)} (${x.e.name})`).join(" - ") || "0"} = ${r4(nv)} m3`, note,
    anchors: [self, ...parts.map((x) => ({ global_id: x.e.globalId, role: "krytina vnútri telesa" }))] });

  return out;
}

/** Ťažisko pôdorysu miestnosti = miesto, kde sa kreslia zvislé kóty. */
export function dimensionPoint(s: SpaceInput): Pt | null {
  if (s.body.mesh) return s.body.mesh.centroid;
  const r = region(s.body);
  return r ? centroid(r.rings) : null;
}
