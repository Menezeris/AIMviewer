import { toGeorefV2, type GeorefCalibration, type Tuple3 } from "../data/georef";

import type { PctRect } from "./snapshot-plan";

/**
 * A document page region in the IFC world (D-158 step 4): page calibration (`_georef` v2, D-133)
 * converts region corners (% from top left) to page points (bottom left), affine to plane meters
 * (u, v) and the plane to the IFC world (Z up, m, viewer frame). From that a proposal of elements in the region
 * (floor plan: bounding box in the storey band, section: elements cut by the plane), a BCF camera over the region and
 * a clipping plane. Pure functions; meshes and calibration are supplied by the caller.
 */

export type Vec3 = Tuple3;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** Page point (points, bottom left) -> plane meters (u, v) by `_georef.affine` [a, b, tx, c, d, ty]. */
export function applyAffine(a: GeorefCalibration["affine"], p: [number, number]): [number, number] {
  return [a[0] * p[0] + a[1] * p[1] + a[2], a[3] * p[0] + a[4] * p[1] + a[5]];
}

/** Plane meters -> IFC world: floor plan (without `plane`) = (u, v, storey height), section = origin + u*s + v*t. */
export function planeToWorld(cal: GeorefCalibration, uv: [number, number]): Vec3 {
  if (!cal.plane) return [uv[0], uv[1], cal.storey_z ?? 0];
  const { origin, u, v } = cal.plane;
  return add(origin, add(mul(u, uv[0]), mul(v, uv[1])));
}

/** % of the page (top left) -> page points (bottom left). */
const pagePoint = (cal: GeorefCalibration, xPct: number, yPct: number): [number, number] => [
  (xPct / 100) * cal.page_size[0],
  cal.page_size[1] - (yPct / 100) * cal.page_size[1],
];

const inside = (outer: [number, number, number, number], r: PctRect) =>
  r.x >= outer[0] - 0.5 && r.y >= outer[1] - 0.5 && r.x + r.width <= outer[0] + outer[2] + 0.5 && r.y + r.height <= outer[1] + outer[3] + 0.5;

/**
 * Calibration for a page and region: with several drawings on a page the one whose crop contains the region;
 * a manual one takes precedence over an automatic one (the manual adjustment has the last word, D-133).
 */
export function pickCalibration(georef: unknown, page: number, region: PctRect | null): GeorefCalibration | null {
  const cals = toGeorefV2(georef).calibrations.filter((c) => c.page === page);
  const fits = cals.filter((c) => !c.region || (region ? inside(c.region, region) : cals.length === 1));
  return fits.find((c) => c.source === "manual") ?? fits[0] ?? null;
}

export interface RegionFrame {
  kind: "plan" | "section";
  /** Region corners in the IFC world (top left, top right, bottom right, bottom left on the page). */
  corners: [Vec3, Vec3, Vec3, Vec3];
  center: Vec3;
  /** Region width and height in m (along the page). */
  size: [number, number];
  /** Smery strany v IFC svete: doprava a hore po strane. */
  right: Vec3;
  up: Vec3;
  /** Plane normal toward the camera (floor plan = +Z). */
  normal: Vec3;
  storey_guid: string | null;
  storey_z: number | null;
}

/** Region (null = calibration crop or the whole page) -> frame in the IFC world. */
export function regionFrame(cal: GeorefCalibration, region: PctRect | null): RegionFrame {
  const r: PctRect = region ?? (cal.region ? { x: cal.region[0], y: cal.region[1], width: cal.region[2], height: cal.region[3] } : { x: 0, y: 0, width: 100, height: 100 });
  const w = (x: number, y: number) => planeToWorld(cal, applyAffine(cal.affine, pagePoint(cal, x, y)));
  const tl = w(r.x, r.y);
  const tr = w(r.x + r.width, r.y);
  const br = w(r.x + r.width, r.y + r.height);
  const bl = w(r.x, r.y + r.height);
  const center = mul(add(add(tl, tr), add(br, bl)), 0.25);
  const rightV = sub(tr, tl);
  const upV = sub(tl, bl);
  const normal = cal.plane ? norm(cross(cal.plane.u, cal.plane.v)) : ([0, 0, 1] as Vec3);
  return {
    kind: cal.plane ? "section" : "plan",
    corners: [tl, tr, br, bl],
    center,
    size: [Math.hypot(...rightV), Math.hypot(...upV)],
    right: norm(rightV),
    up: norm(upV),
    normal,
    storey_guid: cal.storey_guid ?? null,
    storey_z: cal.plane ? null : (cal.storey_z ?? null),
  };
}

const vec = (a: Vec3) => ({ x: r3(a[0]), y: r3(a[1]), z: r3(a[2]) });

/** Section height above the storey when the storey top edge is unknown (doors stay whole). */
export const DEFAULT_CUT_M = 2.0;

/**
 * BCF viewpoint over the region: perspective from the "bottom of the drawing" side obliquely from above (floor plan),
 * perpendicular to the plane from its front side (section); the clipping plane above the storey or in the section
 * plane, direction like an unflipped viewer section (`sectionPlaneToClippingPlane`, visible side).
 */
export function regionViewpoint(f: RegionFrame, opts: { storeyTop?: number | null; aspect?: number } = {}): Record<string, unknown> {
  const span = Math.max(f.size[0], f.size[1], 2);
  const aspect = opts.aspect && Number.isFinite(opts.aspect) && opts.aspect > 0 ? r3(opts.aspect) : 1.5;
  if (f.kind === "plan") {
    const z = f.storey_z ?? f.center[2];
    const cut = opts.storeyTop != null && opts.storeyTop > z + 0.5 ? opts.storeyTop - 0.1 : z + DEFAULT_CUT_M;
    const target: Vec3 = [f.center[0], f.center[1], z + 1];
    // Camera from the side that is at the bottom of the drawing, 55 degrees above the horizontal.
    const back = norm([-f.up[0], -f.up[1], 0]);
    const dist = span * 1.3 + 4;
    const position = add(target, add(mul(back, dist * Math.cos(0.96)), [0, 0, dist * Math.sin(0.96)]));
    const dir = norm(sub(target, position));
    const camUp = norm(cross(cross(dir, [0, 0, 1]), dir));
    return {
      perspective_camera: { camera_view_point: vec(position), camera_direction: vec(dir), camera_up_vector: vec(camUp), field_of_view: 60, aspect_ratio: aspect },
      clipping_planes: [{ location: vec([f.center[0], f.center[1], cut]), direction: { x: 0, y: 0, z: -1 } }],
    };
  }
  const dist = span * 1.2 + 3;
  const position = add(f.center, mul(f.normal, dist));
  return {
    perspective_camera: {
      camera_view_point: vec(position),
      camera_direction: vec(mul(f.normal, -1)),
      camera_up_vector: vec(f.up),
      field_of_view: 60,
      aspect_ratio: aspect,
    },
    clipping_planes: [{ location: vec(f.center), direction: vec(mul(f.normal, -1)) }],
  };
}

/** Camera without calibration: a top-down view (BCF 3.0 wants a camera in every viewpoint, D-158 step 3). */
export function overviewViewpoint(aspect = 1.5): Record<string, unknown> {
  return {
    orthogonal_camera: {
      camera_view_point: { x: 0, y: 0, z: 100 },
      camera_direction: { x: 0, y: 0, z: -1 },
      camera_up_vector: { x: 0, y: 1, z: 0 },
      view_to_world_scale: 100,
      aspect_ratio: r3(aspect),
    },
  };
}

// --- Proposal of elements in the region -------------------------------------------------

/** IFC engine element in the IFC world: triangles (x, y, z) and a bounding box. */
export interface RegionElement {
  globalId: string;
  ifcType: string;
  name: string | null;
  model: string;
  /** Points in the IFC world (x, y, z in triples) and triangle indices. */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  min: Vec3;
  max: Vec3;
}

/** These are not the elements the comment concerns (spaces and the storey go separately as parents). */
const NOT_COMPONENT = new Set([
  "IfcSpace",
  "IfcSpatialZone",
  "IfcZone",
  "IfcOpeningElement",
  "IfcVirtualElement",
  "IfcAnnotation",
  "IfcSite",
  "IfcBuilding",
  "IfcBuildingStorey",
  "IfcGrid",
]);

type P2 = [number, number];

/** Projection into the region frame: (s, t) along the sides from the center, d = distance from the plane along the normal. */
function projector(f: RegionFrame) {
  return (p: Vec3): [number, number, number] => {
    const q = sub(p, f.center);
    return [dot(q, f.right), dot(q, f.up), dot(q, f.normal)];
  };
}

/** Separating axis test: convex polygons in 2D overlap. */
function overlap2d(a: P2[], b: P2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax: P2 = [q[1] - p[1], p[0] - q[0]];
      if (ax[0] === 0 && ax[1] === 0) continue;
      let aMin = Infinity;
      let aMax = -Infinity;
      for (const v of a) {
        const d = v[0] * ax[0] + v[1] * ax[1];
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const v of b) {
        const d = v[0] * ax[0] + v[1] * ax[1];
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
  }
  return true;
}

export interface RegionHit {
  globalId: string;
  ifcType: string;
  name: string | null;
  model: string;
  /** Share of the element's floor plan (section) inside the region 0..1 by bounding box, for sorting. */
  inside: number;
}

export interface RegionMatch {
  components: RegionHit[];
  spaces: RegionHit[];
}

const corners8 = (min: Vec3, max: Vec3): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);

/**
 * Elements in the region: floor plan = an element triangle in the storey band (`depth`, heights above the storey
 * plane) and its projection into the region; section = a triangle cut by the plane (a band around it)
 * and a projection into the region. The bounding box is only a preselection, geometry decides.
 */
export function elementsInRegion(f: RegionFrame, elements: Iterable<RegionElement>, depth: [number, number]): RegionMatch {
  const proj = projector(f);
  const hw = f.size[0] / 2;
  const hh = f.size[1] / 2;
  const area: P2[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const components: RegionHit[] = [];
  const spaces: RegionHit[] = [];
  for (const e of elements) {
    if (NOT_COMPONENT.has(e.ifcType) && e.ifcType !== "IfcSpace") continue;
    const pc = corners8(e.min, e.max).map(proj);
    const dMin = Math.min(...pc.map((p) => p[2]));
    const dMax = Math.max(...pc.map((p) => p[2]));
    if (dMax <= depth[0] || dMin >= depth[1]) continue;
    const sMin = Math.min(...pc.map((p) => p[0]));
    const sMax = Math.max(...pc.map((p) => p[0]));
    const tMin = Math.min(...pc.map((p) => p[1]));
    const tMax = Math.max(...pc.map((p) => p[1]));
    if (sMax <= -hw || sMin >= hw || tMax <= -hh || tMin >= hh) continue;
    if (!trianglesHit(e, proj, area, depth)) continue;
    const ix = Math.max(0, Math.min(sMax, hw) - Math.max(sMin, -hw));
    const iy = Math.max(0, Math.min(tMax, hh) - Math.max(tMin, -hh));
    const own = Math.max(1e-9, (sMax - sMin) * (tMax - tMin));
    const hit: RegionHit = { globalId: e.globalId, ifcType: e.ifcType, name: e.name, model: e.model, inside: r3(Math.min(1, (ix * iy) / own)) };
    (e.ifcType === "IfcSpace" ? spaces : components).push(hit);
  }
  const order = (a: RegionHit, b: RegionHit) => b.inside - a.inside || a.ifcType.localeCompare(b.ifcType) || a.globalId.localeCompare(b.globalId);
  return { components: components.sort(order), spaces: spaces.sort(order) };
}

function trianglesHit(e: RegionElement, proj: (p: Vec3) => [number, number, number], area: P2[], depth: [number, number]): boolean {
  const pos = e.positions;
  const idx = e.indices;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t: [number, number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const j = idx[i + k] * 3;
      t.push(proj([pos[j], pos[j + 1], pos[j + 2]]));
    }
    const dMin = Math.min(t[0][2], t[1][2], t[2][2]);
    const dMax = Math.max(t[0][2], t[1][2], t[2][2]);
    if (dMax < depth[0] || dMin > depth[1]) continue;
    if (overlap2d(area, t.map((p) => [p[0], p[1]] as P2))) return true;
  }
  return false;
}

/** Storey top edge at height `z`: the nearest higher storey height (at least 0.5 m above). */
export function storeyTop(elevations: number[], z: number | null): number | null {
  if (z === null) return null;
  return [...elevations].sort((a, b) => a - b).find((e) => e > z + 0.5) ?? null;
}

/** Depth band: floor plan from the floor to the storey top edge (without slabs above and below), section around the plane. */
export function regionDepth(f: RegionFrame, storeyTop: number | null): [number, number] {
  if (f.kind === "section") return [-0.05, 0.05];
  const z = f.storey_z ?? f.center[2];
  const top = storeyTop != null && storeyTop > z + 0.5 ? storeyTop : z + 3;
  return [0.05, top - z - 0.05];
}
