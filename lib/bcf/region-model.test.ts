import { describe, expect, it } from "vitest";

import type { GeorefCalibration } from "../data/georef";

import {
  applyAffine,
  elementsInRegion,
  pickCalibration,
  regionDepth,
  regionFrame,
  regionViewpoint,
  type RegionElement,
  type Vec3,
} from "./region-model";

/** Pôdorys 1:100 na A4 naležato: 1 bod = 0,0352778 m, ľavý dolný roh strany = IFC (-5, -3). */
const K = 0.0352778;
const PLAN: GeorefCalibration = {
  page: 2,
  page_size: [842, 595],
  storey_guid: "1NPguid",
  storey_z: 3,
  plane: null,
  affine: [K, 0, -5, 0, K, -3],
  calibration: [
    { pdf_pt: [0, 0], ifc_m: [-5, -3] },
    { pdf_pt: [842, 595], ifc_m: [-5 + 842 * K, -3 + 595 * K] },
  ],
  source: "auto",
};

/** Kvádr ako 12 trojuholníkov. */
function box(globalId: string, ifcType: string, min: Vec3, max: Vec3): RegionElement {
  const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  const faces = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  const indices = faces.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]);
  return { globalId, ifcType, name: globalId, model: "ASR", positions: c.flat(), indices, min, max };
}

describe("oblasť strany v IFC svete (D-158 krok 4)", () => {
  it("affine z _georef: [a, b, tx, c, d, ty]", () => {
    expect(applyAffine([2, 0, 1, 0, 3, -1], [10, 10])).toEqual([21, 29]);
  });

  it("rohy oblasti: % vľavo hore -> body vľavo dole -> metre podlažia", () => {
    // Pravá horná štvrtina strany.
    const f = regionFrame(PLAN, { x: 50, y: 0, width: 50, height: 50 });
    const [tl, tr, br, bl] = f.corners;
    expect(tl[0]).toBeCloseTo(-5 + 421 * K, 6);
    expect(tl[1]).toBeCloseTo(-3 + 595 * K, 6);
    expect(tl[2]).toBe(3);
    expect(tr[0]).toBeCloseTo(-5 + 842 * K, 6);
    expect(br[1]).toBeCloseTo(-3 + 297.5 * K, 6);
    expect(bl[0]).toBeCloseTo(tl[0], 6);
    expect(f.size[0]).toBeCloseTo(421 * K, 6);
    expect(f.right).toEqual([1, 0, 0]);
    expect(f.up).toEqual([0, 1, 0]);
    expect(f.kind).toBe("plan");
    expect(f.storey_guid).toBe("1NPguid");
  });

  it("rez: rovina (origin, u, v) z _georef, normála ku kamere", () => {
    const sec: GeorefCalibration = {
      ...PLAN,
      storey_guid: null,
      storey_z: null,
      plane: { origin: [0, 10, 0], u: [1, 0, 0], v: [0, 0, 1] },
      affine: [K, 0, 0, 0, K, 0],
    };
    const f = regionFrame(sec, null);
    expect(f.kind).toBe("section");
    expect(f.normal).toEqual([0, -1, 0]);
    // Ľavý dolný roh strany = origin roviny.
    expect(f.corners[3]).toEqual([0, 10, 0]);
    expect(f.corners[1][2]).toBeCloseTo(595 * K, 6);
    const vp = regionViewpoint(f);
    const cam = vp.perspective_camera as Record<string, Record<string, number>>;
    expect(cam.camera_direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(cam.camera_view_point.y).toBeLessThan(10);
    expect(vp.clipping_planes).toEqual([{ location: expect.objectContaining({ y: 10 }), direction: { x: 0, y: 1, z: 0 } }]);
  });

  it("výber kalibrácie: strana, výrez výkresu na strane, ručná pred automatickou", () => {
    const left: GeorefCalibration = { ...PLAN, region: [0, 0, 50, 100], storey_guid: "L" };
    const right: GeorefCalibration = { ...PLAN, region: [50, 0, 50, 100], storey_guid: "R" };
    const g = { version: 2, calibrations: [left, right] };
    expect(pickCalibration(g, 2, { x: 60, y: 10, width: 10, height: 10 })?.storey_guid).toBe("R");
    expect(pickCalibration(g, 2, { x: 40, y: 10, width: 20, height: 10 })).toBeNull();
    expect(pickCalibration(g, 1, null)).toBeNull();
    const manual = { ...PLAN, source: "manual" as const, storey_guid: "M" };
    expect(pickCalibration({ version: 2, calibrations: [PLAN, manual] }, 2, null)?.storey_guid).toBe("M");
    // v1 z panela Underlays (D-072) sa prevedie.
    const v1 = { version: 1, storey_guid: "V1", storey_z: 0, page: 2, page_size: [842, 595], affine: PLAN.affine, calibration: PLAN.calibration };
    expect(pickCalibration(v1, 2, { x: 1, y: 1, width: 1, height: 1 })?.storey_guid).toBe("V1");
    expect(pickCalibration(null, 2, null)).toBeNull();
  });
});

describe("návrh prvkov v oblasti", () => {
  // Oblasť: x 0..10 m, y 0..5 m na podlaží z = 3 (horná hrana podlažia 6).
  const cal: GeorefCalibration = { ...PLAN, affine: [10 / 842, 0, 0, 0, 5 / 595, 0] };
  const f = regionFrame(cal, null);
  const depth = regionDepth(f, 6);

  it("pôdorys: prvky v pásme podlažia a v oblasti; dosky hore a dole a prvky vedľa nie", () => {
    const els = [
      box("wallIn", "IfcWall", [1, 1, 3], [4, 1.2, 6]),
      box("wallCross", "IfcWall", [8, 2, 3], [14, 2.2, 6]),
      box("doorOut", "IfcDoor", [11, 1, 3], [12, 1.2, 5]),
      box("slabBelow", "IfcSlab", [0, 0, 2.7], [10, 5, 3]),
      box("slabAbove", "IfcSlab", [0, 0, 6], [10, 5, 6.3]),
      box("upper", "IfcWall", [1, 1, 6.3], [4, 1.2, 9]),
      box("space", "IfcSpace", [0.5, 0.5, 3], [6, 4, 5.8]),
      box("opening", "IfcOpeningElement", [1, 1, 3], [2, 1.2, 5]),
    ];
    const m = elementsInRegion(f, els, depth);
    expect(m.components.map((h) => h.globalId)).toEqual(["wallIn", "wallCross"]);
    expect(m.components[0].inside).toBe(1);
    expect(m.components[1].inside).toBeCloseTo(2 / 6, 3);
    expect(m.spaces.map((h) => h.globalId)).toEqual(["space"]);
  });

  it("šikmá stena mimo oblasti: obálka zasahuje, geometria nie", () => {
    // Tenký diagonálny prvok od (9, 9) po (14, 4): obálka prekryje roh oblasti (10, 5), trojuholníky nie.
    const diag: RegionElement = {
      globalId: "diag",
      ifcType: "IfcWall",
      name: null,
      model: "ASR",
      positions: [9, 9, 3, 14, 4, 3, 14, 4, 6, 9, 9, 6, 9.2, 9.2, 3],
      indices: [0, 1, 2, 0, 2, 3, 0, 4, 1],
      min: [9, 4, 3],
      max: [14.2, 9.2, 6],
    };
    expect(elementsInRegion(f, [diag], depth).components).toEqual([]);
  });

  it("pohľad nad pôdorysom: zhora zo strany dolného okraja výkresu, rez pod hornou hranou podlažia", () => {
    const vp = regionViewpoint(f, { storeyTop: 6, aspect: 1.6 });
    const cam = vp.perspective_camera as Record<string, Record<string, number> | number>;
    const pos = cam.camera_view_point as Record<string, number>;
    expect(pos.y).toBeLessThan(2.5);
    expect(pos.z).toBeGreaterThan(6);
    expect(cam.aspect_ratio).toBe(1.6);
    expect(vp.clipping_planes).toEqual([{ location: { x: 5, y: 2.5, z: 5.9 }, direction: { x: 0, y: 0, z: -1 } }]);
    // Bez hornej hrany podlažia: rez 2 m nad podlahou.
    expect((regionViewpoint(f).clipping_planes as { location: { z: number } }[])[0].location.z).toBe(5);
  });
});
