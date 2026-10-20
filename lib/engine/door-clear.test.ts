import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import { clearOpening, convexHull, gapAround, planAxes } from "./door-clear";
import { execEngineTool, type EngineDeps } from "./tools";

type Box = [number, number, number, number, number, number];

/**
 * Telesá dverí v osiach IFC (x šírka, y hĺbka, z hore, metre) -> mesh ako z mesheru:
 * Y-up (x, z, -y), otočený v pôdoryse o `angle`, posunutý o `at`; každé teleso = časť.
 */
function door(bodies: Box[][], angle = 0, at: [number, number] = [0, 0]) {
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
        const wx = at[0] + x * c - y * s;
        const wy = at[1] + x * s + y * c;
        pos.push(wx, z, -wy);
      }
      for (const f of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]) idx.push(base + f);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), parts };
}

/** Zárubňa 0,9 x 2,1 m: stojky 60 mm a nadpražie, hĺbka 0,12 m. */
const FRAME: Box[] = [
  [-0.51, -0.45, 0, 0.12, 0, 2.1],
  [0.45, 0.51, 0, 0.12, 0, 2.1],
  [-0.51, 0.51, 0, 0.12, 2.1, 2.16],
];
const LEAF: Box[] = [[-0.45, 0.45, 0.07, 0.11, 0, 2.1]];
const HANDLE: Box[] = [[0.3, 0.42, 0.11, 0.17, 1.0, 1.05]];
const SILL: Box[] = [[-0.45, 0.45, 0.02, 0.06, 0, 0.004]];

describe("svetlý otvor dverí z geometrie (dodatok D-118)", () => {
  it("osi z pôdorysu: dlhšia strana obdĺžnika je šírka", () => {
    expect(convexHull([[0, 0], [1, 0], [0.5, 0.2], [1, 1], [0, 1]])).toHaveLength(4);
    const { u, center } = planAxes([[0, 0], [2, 0], [2, 0.2], [0, 0.2]]);
    expect(Math.abs(u[0])).toBeCloseTo(1, 9);
    expect(center[0]).toBeCloseTo(1, 9);
    expect(center[1]).toBeCloseTo(0.1, 9);
  });

  it("medzera okolo bodu: vnútri telesa a otvorená strana = null, podlaha zdola", () => {
    expect(gapAround([0, 1, 3, 4], 2)).toBe(2);
    expect(gapAround([0, 1, 3, 4], 0.5)).toBeNull();
    expect(gapAround([3], 2)).toBeNull();
    expect(gapAround([3], 2, 0)).toBe(3);
  });

  it("jednokrídlové dvere otočené v pôdoryse: zárubňa ostane, krídlo a kľučka nie, prah zníži výšku", () => {
    const d = door([FRAME, LEAF, HANDLE, SILL], Math.PI / 6, [12.3, -4.5]);
    const c = clearOpening(d.positions, d.indices, d.parts);
    expect(typeof c).toBe("object");
    if (typeof c === "string") return;
    expect(c.width_m).toBeCloseTo(0.9, 3);
    expect(c.height_m).toBeCloseTo(2.096, 3);
    expect(c.width_min_m).toBeNull();
    expect(c.overall_width_m).toBeCloseTo(1.02, 3);
    expect(c.bodies).toEqual({ total: 4, fill: 2 });
  });

  it("výkladové dvere: rám krídla so sklom v rovine zárubne sa neráta ako zárubňa", () => {
    const frame: Box[] = [
      [-0.475, -0.425, 0, 0.04, 0, 2.275],
      [0.425, 0.475, 0, 0.04, 0, 2.275],
      [-0.475, 0.475, 0, 0.04, 2.275, 2.325],
    ];
    // Rám krídla okolo skla: profily 0,13 m, sklo 0,59 m v strede.
    const leafFrame: Box[] = [
      [-0.425, -0.295, 0, 0.04, 0, 2.275],
      [0.295, 0.425, 0, 0.04, 0, 2.275],
      [-0.295, 0.295, 0, 0.04, 0, 0.26],
      [-0.295, 0.295, 0, 0.04, 2.145, 2.275],
    ];
    const glass: Box[] = [[-0.295, 0.295, 0.018, 0.022, 0.26, 2.145]];
    const d = door([frame, leafFrame, glass]);
    const c = clearOpening(d.positions, d.indices, d.parts);
    if (typeof c === "string") throw new Error(c);
    expect(c.width_m).toBeCloseTo(0.85, 3);
    expect(c.height_m).toBeCloseTo(2.275, 3);
  });

  it("karuselové dvere a dvere bez zárubne sa nemerajú, s dôvodom", () => {
    const drum = door([[[-1, 1, -1, 1, 0, 2.4]]]);
    expect(clearOpening(drum.positions, drum.indices, drum.parts)).toMatch(/karuselové/);
    const leafOnly = door([LEAF]);
    expect(clearOpening(leafOnly.positions, leafOnly.indices, leafOnly.parts)).toMatch(/zárubňu/);
  });
});

describe("ifc_measure clear_opening", () => {
  afterEach(() => clearEngineCache());

  const deps: EngineDeps = {
    sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
    lookup: async () => new Map(),
    resolveTargets: async () => new Map(),
    fetchImpl: (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch,
  };

  it("prvok, ktorý nie sú dvere, je unknown s dôvodom; pass/fail súhrn pre style_in_3d", async () => {
    const r = await execEngineTool("ifc_measure", { items: [guid("W1")], clear_opening: true, min_width_m: 0.8 }, deps);
    expect(r.isError).toBe(false);
    const j = JSON.parse(r.content);
    expect(j.items[0]).toMatchObject({ global_id: guid("W1"), clear_opening: null, result: "unknown" });
    expect(j.items[0].reason).toMatch(/IfcDoor/);
    expect(j.check).toMatchObject({ limits: { min_width_m: 0.8 }, pass: 0, fail: 0, unknown: 1 });
    expect(j.check.style_fail).toEqual({ ids_or_refs: [], global_ids: [] });
  });

  it("limit v metroch a bez b", async () => {
    const mm = await execEngineTool("ifc_measure", { items: [guid("W1")], clear_opening: true, min_width_m: 900 }, deps);
    expect(mm.isError).toBe(true);
    expect(mm.content).toMatch(/v metroch/);
    const pair = await execEngineTool("ifc_measure", { a: guid("W1"), b: guid("W2"), clear_opening: true }, deps);
    expect(pair.isError).toBe(true);
  });
});
