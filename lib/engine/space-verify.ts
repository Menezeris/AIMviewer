import { GeometryProcessor } from "@ifc-lite/geometry";

import {
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
 * SPIKE (D-185, NÁVRH): overovač výmer IfcSpace voči geometrii. Nie je zapojený do toolov.
 *
 * Vlastné telesá z `extractExtrusionDefinitions` (`@ifc-lite/geometry`, presné zdrojové
 * parametre extrúzie bez tesselácie) ako zvislé hranoly: pôdorys (prstence s dierami) v IFC
 * svete (m) a rozsah z0..z1. Recepty porovnajú Qto_SpaceBaseQuantities zo súboru s hodnotou
 * z hranolov miestnosti, dosiek a krytín, ktoré sa s miestnosťou prekrývajú v pôdoryse
 * (presný 2D prienik), a vrátia stav, metódu, definíciu, toleranciu, vzorec s dosadenými
 * číslami a kotvy na kóty. Pravidlá (tolerancie, výber, konštantnosť) sú v registri
 * `lib/verify/quantity-methods.ts`, nie tu.
 *
 * Mimo spiku: šikmé extrúzie, CSG operandy (`source_modified`), ostatné analytické tvary
 * (IfcSweptDiskSolid, IfcRevolvedAreaSolid...) a mesh ako náhrada (sivá zatiaľ aj tam).
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
export interface Body {
  expressId: number;
  prisms: Prism[];
  /** Dôvod, prečo prvok nemá (celé) analytické teleso. */
  unsupported?: string;
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

/** Oblúk sa vzorkuje (spike); presne by sa rátal kruhový výsek. */
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
    for (const i of inst) {
      const src = byKey.get(JSON.stringify(i.source))?.source;
      if (i.status.type !== "complete" || !src || src.status.type !== "complete" || !src.profile || !i.world_from_source) {
        body.unsupported = i.status.reason ?? src?.status.reason ?? "nekompletný zdroj extrúzie";
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
        body.unsupported = "šikmá alebo vodorovná extrúzia (mimo spiku)";
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
    out.set(id, body);
  }
  return out;
}

export async function extractBodies(bytes: Uint8Array, ids: readonly number[]): Promise<Map<number, Body>> {
  const gp = new GeometryProcessor({ enableInstancing: false });
  const log = console.log;
  console.log = () => undefined;
  try {
    await gp.init();
    const defs = gp.extractExtrusionDefinitions(bytes, Uint32Array.from(ids));
    if (!defs) throw new Error("extractExtrusionDefinitions nie je k dispozícii");
    return bodiesFromExtrusions(defs as unknown as ExtrusionDefinitionsLike, ids);
  } finally {
    console.log = log;
    gp.dispose();
  }
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
  /** Pravidlo konštantnosti: počet rôznych výšok v pôdoryse miestnosti (len pri porušení). */
  distinct_heights?: number[];
  anchors: Anchor[];
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

function region(b: Body): { rings: Ring[]; z0: number; z1: number } | null {
  if (!b.prisms.length) return null;
  // Spike: viac telies prvku = zjednotenie ako súčet (predpoklad: sa neprekrývajú).
  return { rings: b.prisms.flatMap((p) => p.rings), z0: Math.min(...b.prisms.map((p) => p.z0)), z1: Math.max(...b.prisms.map((p) => p.z1)) };
}

function judge(file: number | undefined, computed: number, kind: QuantityKind): Status {
  if (file == null) return "grey";
  return withinTolerance(file, computed, kind) ? "green" : "red";
}

/** Prvky, ktorých pôdorys pokrýva aspoň `minShare` pôdorysu miestnosti, s plochou prekryvu. */
function overlapping(space: Ring[], others: Element[], minShare: number) {
  const a = regionArea(space);
  return others
    .map((e) => {
      const r = region(e.body);
      return r ? { e, r, overlap: regionIntersectionArea(space, r.rings) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.overlap > minShare * a);
}

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

function base(key: SpaceMethodKey) {
  const m: QuantityMethod = SPACE_METHODS[key];
  return { target: m.target, recipe: m.id, method: m.method, definition: m.definition, spec_ref: m.spec_ref, tolerance: TOLERANCES[m.kind].text };
}

/** Výsledok pri viacerých výškach (pravidlo konštantnosti zo schémy). */
function nonConstant(key: SpaceMethodKey, file: number | undefined, heights: number[], ref: number, anchors: Anchor[]): RecipeResult {
  const values = heights.map((h) => r4(h - ref));
  return {
    ...base(key),
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
    for (const k of ["height_own", "gross_floor_area", "gross_volume", "net_volume", "ffh", "fch"] as const) {
      const b = base(k);
      out.push({ ...b, status: "grey", file: s.qto[b.target.split(".")[1]], note: s.body.unsupported, anchors: [] });
    }
    return out;
  }
  const A = regionArea(own.rings);
  const P = regionPerimeter(own.rings);
  const H = own.z1 - own.z0;
  const gv = s.body.prisms.reduce((sum, p) => sum + regionArea(p.rings) * (p.z1 - p.z0), 0);
  const self: Anchor = { global_id: s.globalId, role: "teleso miestnosti" };
  const modified = s.body.unsupported ? `; ${s.body.unsupported}` : "";

  out.push({ ...base("height_own"), status: judge(s.qto.Height, H, "length"), file: s.qto.Height, computed: r4(H),
    formula: `${r3(own.z1)} - ${r3(own.z0)} = ${r4(H)} m`, anchors: [{ ...self, z_m: own.z0 }, { ...self, z_m: own.z1 }] });
  out.push({ ...base("gross_floor_area"), status: judge(s.qto.GrossFloorArea, A, "area"), file: s.qto.GrossFloorArea, computed: r4(A),
    formula: `plocha profilu = ${r4(A)} m2`, anchors: [self] });
  out.push({ ...base("gross_perimeter"), status: judge(s.qto.GrossPerimeter, P, "length"), file: s.qto.GrossPerimeter, computed: r4(P),
    formula: `obvod vonkajšej slučky = ${r4(P)} m`, anchors: [self] });
  out.push({ ...base("gross_volume"), status: judge(s.qto.GrossVolume, gv, "volume"), file: s.qto.GrossVolume, computed: r4(gv),
    formula: `${r4(A)} x ${r4(H)} = ${r4(gv)} m3${modified}`, anchors: [self] });

  // Dosky pod a nad.
  const c = SELECTION.contact_m;
  const slabs = overlapping(own.rings, ctx.slabs, SELECTION.slab_min_overlap);
  const below = slabs.filter((x) => Math.abs(x.r.z1 - own.z0) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  const above = slabs.filter((x) => Math.abs(x.r.z0 - own.z1) <= c).sort((a, b) => b.overlap - a.overlap)[0];
  if (below && above) {
    const hs = above.r.z0 - below.r.z1;
    out.push({ ...base("height_slabs"), status: judge(s.qto.Height, hs, "length"), file: s.qto.Height, computed: r4(hs),
      formula: `spodok(${above.e.name}) - vrch(${below.e.name}) = ${r3(above.r.z0)} - ${r3(below.r.z1)} = ${r4(hs)} m`,
      anchors: [{ global_id: below.e.globalId, role: "doska pod", z_m: below.r.z1 }, { global_id: above.e.globalId, role: "doska nad", z_m: above.r.z0 }] });
  } else {
    out.push({ ...base("height_slabs"), status: "grey", file: s.qto.Height,
      note: `${below ? "" : "doska pod nenájdená; "}${above ? "" : "doska nad nenájdená"}`.trim(), anchors: [] });
  }

  // Podlahovina.
  const floors = overlapping(own.rings, ctx.coverings.filter((x) => x.predefinedType === "FLOORING"), SELECTION.flooring_min_overlap)
    .filter((x) => x.r.z0 >= own.z0 - c && x.r.z1 <= own.z1);
  const floorTops = distinct(floors.map((x) => x.r.z1));
  const floorAnchors = floors.map((x) => ({ global_id: x.e.globalId, role: "podlahovina", z_m: x.r.z1 }));
  const floorTop = floorTops.length === 1 ? floorTops[0] : null;
  if (floorTops.length > 1) out.push(nonConstant("ffh", s.qto.FinishFloorHeight, floorTops, own.z0, [{ ...self, z_m: own.z0 }, ...floorAnchors]));
  else if (floorTop != null) {
    const ffh = floorTop - own.z0;
    out.push({ ...base("ffh"), status: judge(s.qto.FinishFloorHeight, ffh, "length"), file: s.qto.FinishFloorHeight, computed: r4(ffh),
      formula: `vrch(podlahovina) - spodok(miestnosť) = ${r3(floorTop)} - ${r3(own.z0)} = ${r4(ffh)} m`, anchors: [{ ...self, z_m: own.z0 }, ...floorAnchors] });
  } else {
    out.push({ ...base("ffh"), status: s.qto.FinishFloorHeight == null ? "grey" : "red", file: s.qto.FinishFloorHeight,
      note: "podlahovina v pôdoryse miestnosti nenájdená", anchors: [] });
  }

  // Podhľad: každý podhľad s prekryvom aspoň SELECTION.ceiling_min_overlap je jedna výška; viac výšok = pravidlo konštantnosti.
  const ceilings = overlapping(own.rings, ctx.coverings.filter((x) => x.predefinedType === "CEILING"), SELECTION.ceiling_min_overlap)
    .filter((x) => x.r.z0 > own.z0 && x.r.z1 <= own.z1 + c);
  const ref = floorTop ?? own.z0;
  const ceilingAnchors = ceilings.map((x) => ({ global_id: x.e.globalId, role: "podhľad", z_m: x.r.z0 }));
  const bottoms = distinct(ceilings.map((x) => x.r.z0));
  if (bottoms.length > 1) out.push(nonConstant("fch", s.qto.FinishCeilingHeight, bottoms, ref, [{ ...self, z_m: ref }, ...ceilingAnchors]));
  else if (bottoms.length === 1) {
    const fch = bottoms[0] - ref;
    out.push({ ...base("fch"), status: judge(s.qto.FinishCeilingHeight, fch, "length"), file: s.qto.FinishCeilingHeight, computed: r4(fch),
      formula: `spodok(podhľad) - vrch(podlahy) = ${r3(bottoms[0])} - ${r3(ref)} = ${r4(fch)} m`, anchors: [{ ...self, z_m: ref }, ...ceilingAnchors] });
  } else {
    out.push({ ...base("fch"), status: s.qto.FinishCeilingHeight == null ? "green" : "red", file: s.qto.FinishCeilingHeight,
      note: s.qto.FinishCeilingHeight == null ? "bez podhľadu, hodnota správne neuvedená" : "podhľad nad miestnosťou nenájdený", anchors: [] });
  }

  // NetVolume = GrossVolume - prieniky krytín s telesom miestnosti, prizmaticky.
  const parts = overlapping(own.rings, ctx.coverings, 0)
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
  out.push({ ...base("net_volume"), ...(nvTol ? { tolerance: nvTol.text } : {}), status: nvStatus, file: nvFile, computed: r4(nv),
    formula: `${r4(gv)} - ${parts.map((x) => `${r4(x.overlap)} x ${r4(x.dz)} (${x.e.name})`).join(" - ") || "0"} = ${r4(nv)} m3`, note,
    anchors: [self, ...parts.map((x) => ({ global_id: x.e.globalId, role: "krytina vnútri telesa" }))] });

  return out;
}

/** Ťažisko pôdorysu miestnosti = miesto, kde sa kreslia zvislé kóty. */
export function dimensionPoint(s: SpaceInput): Pt | null {
  const r = region(s.body);
  return r ? centroid(r.rings) : null;
}
