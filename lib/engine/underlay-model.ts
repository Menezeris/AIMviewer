import { toIfc, type MeshElement } from "./measure";
import { footprintCentroid, sliceTriangles, type P2, type Plane, type Seg } from "./underlay-calibrate";

/**
 * Model for underlay calibration (D-133): IFC engine meshes (Y-up, `meshModel`) converted into the
 * IFC world (Z up, m, + `worldOffset` D-124), i.e. into the same frame in which the viewer
 * stores calibration points (`_georef`, `worldToIfcMetres`).
 */

/**
 * Floor plan: structures that the drawing draws with a thick cut line. Doors, windows and equipment
 * are thin in a plan (under the ETL `LINE_MIN_WIDTH`) and would only disturb ICP (p90 1NP 41 -> 20 mm).
 */
const PLAN_TYPES = new Set([
  "IfcWall",
  "IfcWallStandardCase",
  "IfcColumn",
  "IfcCurtainWall",
  "IfcPlate",
  "IfcMember",
  "IfcSlab",
  "IfcRoof",
  "IfcBeam",
  "IfcStair",
  "IfcStairFlight",
  "IfcRamp",
  "IfcRampFlight",
  "IfcFooting",
]);

/**
 * Section: everything except volumes of spaces and zones, openings and furniture. A vertical section also draws
 * window frames, railings and cladding thick (structures only worsen section A from 8/13 to 13/114 mm).
 */
const NOT_IN_SECTION = new Set(["IfcSpace", "IfcSpatialZone", "IfcZone", "IfcOpeningElement", "IfcFurniture", "IfcFurnishingElement", "IfcVirtualElement", "IfcAnnotation", "IfcSite"]);

/** Mesh points in the IFC world (x, y, z). */
export function ifcPositions(e: MeshElement): Float64Array {
  const off = e.worldOffset ?? [0, 0, 0];
  const out = new Float64Array(e.positions.length);
  for (let i = 0; i < e.positions.length; i += 3) {
    const p = toIfc([e.positions[i], e.positions[i + 1], e.positions[i + 2]]);
    out[i] = p[0] + off[0];
    out[i + 1] = p[1] + off[1];
    out[i + 2] = p[2] + off[2];
  }
  return out;
}

/** Model cut by the view plane, segments in (u, v); `kind` determines the classes (floor plan or section). */
export function modelCut(elements: Iterable<MeshElement>, plane: Plane, kind: "plan" | "section"): Seg[] {
  const out: Seg[] = [];
  for (const e of elements) {
    if (kind === "plan" ? !PLAN_TYPES.has(e.ifcType) : NOT_IN_SECTION.has(e.ifcType)) continue;
    sliceTriangles(ifcPositions(e), e.indices, plane, out);
  }
  return out;
}

/** Floor plan plane at height `z` (u = X, v = Y). */
export function planPlane(z: number): Plane {
  return { origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0] };
}

/**
 * Vertical section plane through the point `at` (IFC X, Y) in the direction `dir` (plan direction of the section line):
 * u = line direction, v = Z up.
 */
export function sectionPlane(at: P2, dir: P2): Plane {
  const L = Math.hypot(dir[0], dir[1]);
  if (!(L > 0)) throw new Error("smer rezu je nulový");
  return { origin: [at[0], at[1], 0], u: [dir[0] / L, dir[1] / L, 0], v: [0, 0, 1] };
}

/** IfcSpace cut by the height `z`: Name (room number) and the plan centroid. */
export function spacesAt(elements: Iterable<MeshElement>, z: number): { name: string; centroid: P2 }[] {
  const out: { name: string; centroid: P2 }[] = [];
  for (const e of elements) {
    if (e.ifcType !== "IfcSpace" || !e.name) continue;
    const pos = ifcPositions(e);
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 2; i < pos.length; i += 3) {
      z0 = Math.min(z0, pos[i]);
      z1 = Math.max(z1, pos[i]);
    }
    if (z < z0 || z > z1) continue;
    const c = footprintCentroid(pos, e.indices);
    if (c) out.push({ name: e.name, centroid: c });
  }
  return out;
}
