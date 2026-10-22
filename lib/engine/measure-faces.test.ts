import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import { clearOpening } from "./door-clear";
import type { MeshElement } from "./measure";
import { axisDimension, elementAxes, faceDistance, parseFace } from "./measure-faces";
import { execEngineTool, type EngineDeps } from "./tools";

type Box = [number, number, number, number, number, number];

const fetchImpl = (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch;
const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
  lookup: async () => new Map(),
  resolveTargets: async () => new Map(),
  fetchImpl,
};

/**
 * Prvok z kvádrov v osiach IFC (x, y, z hore, m) -> mesh ako z mesheru: Y-up (x, z, -y),
 * otočený v pôdoryse o `angle`, posunutý o `at`; každé teleso = časť.
 */
function element(bodies: Box[][], ifcType = "IfcWall", angle = 0, at: [number, number] = [0, 0]): MeshElement {
  const pos: number[] = [];
  const idx: number[] = [];
  const parts: number[] = [];
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  for (const body of bodies) {
    parts.push(idx.length);
    for (const [x0, x1, y0, y1, z0, z1] of body) {
      const base = pos.length / 3;
      for (const [x, y, z] of [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
      ]) {
        pos.push(at[0] + x * c - y * s, z, -(at[1] + x * s + y * c));
      }
      for (const f of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]) idx.push(base + f);
    }
  }
  const positions = new Float32Array(pos);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return { globalId: "g", expressId: 1, model: "M", ifcType, name: null, positions, indices: new Uint32Array(idx), parts, bounds: { min, max } };
}

/** Zárubňa 0,9 x 2,1 m (stojky 60 mm, nadpražie), krídlo s kľučkou. */
const FRAME: Box[] = [
  [-0.51, -0.45, 0, 0.12, 0, 2.1],
  [0.45, 0.51, 0, 0.12, 0, 2.1],
  [-0.51, 0.51, 0, 0.12, 2.1, 2.16],
];
const LEAF: Box[] = [[-0.44, 0.44, 0.07, 0.11, 0, 2.1]];
const HANDLE: Box[] = [[0.3, 0.42, 0.11, 0.17, 1.0, 1.05]];
const len = (s: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }) =>
  Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z);

describe("ifc_measure axis a plochy (D-155)", () => {
  afterEach(() => clearEngineCache());

  it("osi prvku: x pozdĺž dlhšej strany, otočené k +X, y o 90° doľava", () => {
    const wall = element([[[0, 4, 0, 0.3, 0, 3]]], "IfcWall", Math.PI / 2 + Math.PI / 6);
    const ax = elementAxes(wall);
    // Stena otočená o 120°: dlhšia strana mieri do (-0,5; 0,87), otočí sa k +X.
    expect(ax.x[0]).toBeCloseTo(0.5, 5);
    expect(ax.x[1]).toBeCloseTo(-Math.sqrt(3) / 2, 5);
    expect(ax.y[0]).toBeCloseTo(Math.sqrt(3) / 2, 5);
    expect(ax.y[1]).toBeCloseTo(0.5, 5);
  });

  it("jedna os: width/depth/height v osiach prvku, x/y/z v osiach sveta", () => {
    const wall = element([[[0, 4, 0, 0.3, 0, 3]]], "IfcWall", Math.PI / 4, [10, 5]);
    expect(axisDimension(wall, "width").length_m).toBeCloseTo(4, 3);
    expect(axisDimension(wall, "depth").length_m).toBeCloseTo(0.3, 3);
    const h = axisDimension(wall, "height");
    expect(h.length_m).toBeCloseTo(3, 3);
    expect(len(h.segment)).toBeCloseTo(3, 3);
    // Obálka sveta otočenej steny je širšia ako stena.
    expect(axisDimension(wall, "x").length_m).toBeCloseTo((4 + 0.3) * Math.SQRT1_2, 3);
    // Konce kóty sú zaokrúhlené na mm, šikmá kóta sa preto líši do 1 mm.
    expect(len(axisDimension(wall, "width").segment)).toBeCloseTo(4, 2);
  });

  it("hrúbka steny: odvrátené plochy +y a -y", () => {
    const wall = element([[[0, 4, 0, 0.3, 0, 3]]], "IfcWall", 0.4, [3, 2]);
    const r = faceDistance(wall, wall, parseFace("+y", "face_a"), parseFace("-y", "face_b"));
    expect(r.distance_m).toBeCloseTo(0.3, 3);
    expect(r.relation).toBe("away");
    expect(len(r.segment)).toBeCloseTo(0.3, 3);
  });

  it("vnútorné líca zárubne v oboch poradiach, krídlo a kľučka sa nerátajú", () => {
    const door = element([FRAME, LEAF, HANDLE], "IfcDoor", 1.1, [5, -3]);
    const ab = faceDistance(door, door, parseFace("+x", "face_a"), parseFace("-x", "face_b"));
    const ba = faceDistance(door, door, parseFace("-x", "face_a"), parseFace("+x", "face_b"));
    expect(ab.distance_m).toBeCloseTo(0.9, 3);
    expect(ba.distance_m).toBeCloseTo(0.9, 3);
    expect(ab.relation).toBe("facing");
    // Svetlá výška: vrch prahu (+z) oproti spodku nadpražia (-z).
    const sill = element([FRAME, LEAF, [[-0.45, 0.45, 0.02, 0.06, 0, 0.004]]], "IfcDoor", 1.1, [5, -3]);
    expect(faceDistance(sill, sill, parseFace("+z", "face_a"), parseFace("-z", "face_b")).distance_m).toBeCloseTo(2.096, 3);
  });

  it("dva prvky: plochy oproti sebe aj chyby vstupu", () => {
    const a = element([[[0, 1, 0, 0.2, 0, 3]]]);
    const b = element([[[2.5, 3.5, 0, 0.2, 0, 3]]]);
    const r = faceDistance(a, b, parseFace("+x", "face_a"), parseFace("-x", "face_b"));
    expect(r.distance_m).toBeCloseTo(1.5, 3);
    expect(r.relation).toBe("facing");
    expect(() => faceDistance(a, b, parseFace("+x", "face_a"), parseFace("-y", "face_b"))).toThrow(/rovnobežné/);
    expect(() => parseFace("x", "face_a")).toThrow(/\+x/);
  });

  it("svetlý otvor vráti konce kót šírky a výšky", () => {
    const m = element([FRAME, LEAF], "IfcDoor", 0.7, [2, 1]);
    const c = clearOpening(m.positions, m.indices, m.parts);
    if (typeof c === "string") throw new Error(c);
    const [w0, w1] = c.segments!.width!;
    const [h0, h1] = c.segments!.height!;
    expect(Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2])).toBeCloseTo(0.9, 3);
    expect(Math.hypot(h1[0] - h0[0], h1[1] - h0[1], h1[2] - h0[2])).toBeCloseTo(2.1, 3);
  });

  it("ifc_measure: axis a plochy cez motor, show=true jedna kóta", async () => {
    const w = await execEngineTool("ifc_measure", { a: guid("W1"), axis: "height", show: true }, deps);
    const wj = JSON.parse(w.content);
    expect(wj.axis).toMatchObject({ axis: "height", length_m: 3 });
    expect(wj.view).toBe("kóty vo vieweri: 1");

    const t = await execEngineTool("ifc_measure", { a: guid("W1"), face_a: "+y", face_b: "-y", show: true }, deps);
    expect(JSON.parse(t.content).faces).toMatchObject({ distance_m: 0.2, relation: "away" });
    expect(t.actions).toHaveLength(1);

    const pair = await execEngineTool("ifc_measure", { a: guid("W1"), b: guid("W2"), face_a: "+x", face_b: "-x" }, deps);
    expect(JSON.parse(pair.content).faces).toMatchObject({ distance_m: 1, relation: "facing" });

    const bad = await execEngineTool("ifc_measure", { a: guid("W1"), axis: "width", items: [guid("W2")] }, deps);
    expect(bad.isError).toBe(true);
    const half = await execEngineTool("ifc_measure", { a: guid("W1"), face_a: "+x" }, deps);
    expect(half.content).toMatch(/face_b/);
  });
});
