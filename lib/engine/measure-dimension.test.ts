import { afterEach, describe, expect, it } from "vitest";

import { parseOps, opToBridgeMessage } from "../viewer-ops";
import { MAX_MEASURE_SEGMENTS, decodeMeasureWire, encodeMeasureWire } from "../viewer-measure";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import type { MeshElement } from "./measure";
import { closestOnMesh, closestOnTriangle, dimensionAction, pairDimension, sizeDimensions, toWorld } from "./measure-dimension";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch;
const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
  lookup: async () => new Map(),
  resolveTargets: async () => new Map(),
  fetchImpl,
};

/** Kocka (Y-up) s rohom v `o` a hranou `s`. */
function cube(o: [number, number, number], s = 1, worldOffset?: [number, number, number]): MeshElement {
  const v = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((c, i) => c * s + o[i % 3]);
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  return {
    globalId: "g",
    expressId: 1,
    model: "M",
    ifcType: "IfcWall",
    name: null,
    positions: new Float32Array(v),
    indices: new Uint32Array(f),
    parts: [0],
    bounds: { min: o, max: [o[0] + s, o[1] + s, o[2] + s] },
    ...(worldOffset ? { worldOffset } : {}),
  };
}

describe("kóta k ifc_measure (D-124)", () => {
  afterEach(() => clearEngineCache());

  it("najbližší bod trojuholníka: vnútro, hrana a vrchol", () => {
    const [a, b, c] = [[0, 0, 0], [2, 0, 0], [0, 2, 0]] as [number, number, number][];
    expect(closestOnTriangle([0.5, 0.5, 3], a, b, c)).toEqual([0.5, 0.5, 0]);
    expect(closestOnTriangle([1, -1, 0], a, b, c)).toEqual([1, 0, 0]);
    expect(closestOnTriangle([-1, -1, 0], a, b, c)).toEqual([0, 0, 0]);
    expect(closestOnTriangle([2, 2, 0], a, b, c)).toEqual([1, 1, 0]);
  });

  it("konce svetlej vzdialenosti dvoch kociek zo stredu úsečky, v IFC osiach s posunom rámca", () => {
    const a = cube([0, 0, 0], 1, [100, 200, 10]);
    const b = cube([3, 0, 0], 1, [100, 200, 10]);
    expect(closestOnMesh(a, [2, 0.5, 0.5])).toEqual([1, 0.5, 0.5]);
    const seg = pairDimension(a, b, [2, 0.5, 0.5], 2)!;
    // Y-up mesh -> IFC: x = x, y = -z, z = y; potom posun rámca.
    expect(seg).toEqual({ a: { x: 101, y: 199.5, z: 10.5 }, b: { x: 103, y: 199.5, z: 10.5 } });
    expect(pairDimension(a, b, [1, 0.5, 0.5], 0)).toBeNull();
    expect(toWorld(cube([0, 0, 0]), [1, 2, 3])).toEqual([1, -3, 2]);
  });

  it("rozmery prvku: tri hrany obálky z rohu s najmenšími súradnicami", () => {
    const dims = sizeDimensions(cube([0, 0, 0], 2));
    expect(dims).toEqual([
      { a: { x: 0, y: -2, z: 0 }, b: { x: 2, y: -2, z: 0 } },
      { a: { x: 0, y: -2, z: 0 }, b: { x: 0, y: 0, z: 0 } },
      { a: { x: 0, y: -2, z: 0 }, b: { x: 0, y: -2, z: 2 } },
    ]);
  });

  it("wire v ops: tam a späť, chybný alebo príliš dlhý sa zahodí", () => {
    const seg = { a: { x: 1.23456, y: -2, z: 0 }, b: { x: 4, y: 5, z: 6 } };
    expect(decodeMeasureWire(encodeMeasureWire([seg]))).toEqual([{ a: { x: 1.235, y: -2, z: 0 }, b: { x: 4, y: 5, z: 6 } }]);
    expect(decodeMeasureWire("1,2,3,4,5")).toBeNull();
    expect(decodeMeasureWire("1,2,x,4,5,6")).toBeNull();
    expect(decodeMeasureWire(Array(MAX_MEASURE_SEGMENTS + 1).fill("0,0,0,1,1,1").join("|"))).toBeNull();
    const action = dimensionAction([seg]);
    const ops = parseOps(new URLSearchParams(action.url.split("?")[1]).get("ops")!);
    expect(ops).toHaveLength(1);
    expect(opToBridgeMessage(ops[0])).toEqual({ type: "MEASURE_SHOW", segments: [{ a: { x: 1.235, y: -2, z: 0 }, b: { x: 4, y: 5, z: 6 } }] });
    expect(parseOps("measure:keep:0,0,0,1,0,0").map(opToBridgeMessage)).toEqual([
      { type: "MEASURE_SHOW", segments: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }], keep: true },
    ]);
  });

  it("ifc_measure: a + b vráti closest_points, show=true aj príkaz do viewera; bez show nič neposiela", async () => {
    const plain = await execEngineTool("ifc_measure", { a: guid("W1"), b: guid("W2") }, deps);
    const pts = JSON.parse(plain.content).distance.closest_points;
    expect(Math.hypot(pts.b.x - pts.a.x, pts.b.y - pts.a.y, pts.b.z - pts.a.z)).toBeCloseTo(1, 3);
    expect(plain.actions).toBeUndefined();

    const shown = await execEngineTool("ifc_measure", { a: guid("W1"), b: guid("W2"), show: true }, deps);
    expect(JSON.parse(shown.content).view).toBe("kóty vo vieweri: 1");
    expect(shown.actions).toHaveLength(1);
    expect(shown.actions![0].url).toMatch(/^\/ifc\?ops=measure/);

    const size = await execEngineTool("ifc_measure", { a: guid("W1"), show: true }, deps);
    expect(JSON.parse(size.content).view).toBe("kóty vo vieweri: 3");
  });
});
