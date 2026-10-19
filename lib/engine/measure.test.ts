import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { boxGap, ifcBox, meshMetrics, toIfc } from "./measure";
import { ENGINE_TOOL_NAMES } from "./tool-defs";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch;

const AIM: Record<string, AimRef> = {
  [guid("W1")]: { object_id: "44444444-4444-4444-4444-444444444444", object_ref: "SN.01", name: "W1", object_type: "asset" },
};

const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async (targets) => new Map(targets.filter((t) => t === "SN.01").map((t) => [t, guid("W1")])),
  fetchImpl,
};

const run = async (input: Record<string, unknown>) => {
  const res = await execEngineTool("ifc_measure", input, deps);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

/** Jednotková kocka (Y-up), 12 trojuholníkov s normálami von. */
function cube(): { positions: Float32Array; indices: Uint32Array } {
  const v = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  return { positions: new Float32Array(v), indices: new Uint32Array(f) };
}

describe("ifc_measure (D-112)", () => {
  afterEach(() => clearEngineCache());

  it("je registrovaný medzi tools motora", () => {
    expect(ENGINE_TOOL_NAMES.has("ifc_measure")).toBe(true);
  });

  it("výmery uzavretého meshu: povrch, pôdorys, objem", () => {
    const { positions, indices } = cube();
    const m = meshMetrics(positions, indices);
    expect(m).toMatchObject({ area: 6, footprint: 1, closed: true });
    expect(m.volume).toBeCloseTo(1, 9);
    // Bez jednej steny už nie je uzavretý.
    expect(meshMetrics(positions, indices.slice(0, 30)).closed).toBe(false);
  });

  it("osi IFC z Y-up meshu a medzera obálok", () => {
    expect(toIfc([1, 2, 3])).toEqual([1, -3, 2]);
    expect(ifcBox({ min: [0, 0, -2], max: [1, 3, 0] })).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(boxGap({ min: [0, 0, 0], max: [1, 1, 1] }, { min: [2, 0.5, 3], max: [3, 2, 4] })).toEqual([1, 0, 2]);
  });

  it("vzdialenosť dvoch stien z geometrie, cez object_ref", async () => {
    const r = await run({ a: "SN.01", b: guid("W2") });
    expect(r.isError).toBe(false);
    expect(r.json.a).toMatchObject({ global_id: guid("W1"), ifc_type: "IfcWall", object_ref: "SN.01", model: "MINI" });
    expect(r.json.a.aim_url).toBeUndefined();
    expect(r.json.distance.status).toBe("gap");
    expect(r.json.distance.distance_kind).toBe("mesh");
    expect(r.json.distance.clear_distance_m).toBeCloseTo(1, 3);
    expect(r.json.distance.center_distance_m).toBeCloseTo(2, 3);
    expect(r.json.distance.bbox_gap_m).toMatchObject({ x: 1, y: 0, z: 0, horizontal: 1 });
    expect(r.json.a.size.bbox_m).toEqual({ x: 1, y: 0.2, z: 3 });
    expect(r.json.show_in_3d).toEqual({ ids_or_refs: [AIM[guid("W1")].object_id], global_ids: [guid("W2")] });
  });

  it("výška nad doskou: a_above_b_m a zvislá medzera", async () => {
    const r = await run({ a: guid("W1"), b: guid("SL1") });
    expect(r.json.distance.a_above_b_m).toBeCloseTo(0.3, 3);
    expect(r.json.distance.clear_distance_m).toBeCloseTo(0.3, 3);
    expect(r.json.distance.bbox_gap_m.z).toBeCloseTo(0.3, 3);
  });

  it("výmery z meshu vedľa Qto, nezhoda a súčet", async () => {
    const r = await run({ items: [guid("W1"), guid("W2")] });
    const [w1, w2] = r.json.items;
    expect(w1.size).toMatchObject({ volume_m3: 0.6, footprint_m2: 0.2, surface_m2: 7.6 });
    expect(w1.size.vs_qto.volume).toEqual({ qto: "Qto_WallBaseQuantities.NetVolume", qto_value: 0.6, mesh_value: 0.6, mismatch: false });
    expect(w2.size.vs_qto.volume).toMatchObject({ qto_value: 1, mesh_value: 0.6, mismatch: true });
    expect(r.json.total).toEqual({ volume_m3: 1.2, surface_m2: 15.2, footprint_m2: 0.4, open_meshes: 0 });
  });

  it("chybný vstup sa vráti ako výsledok, nie výnimka", async () => {
    expect((await run({})).content).toMatch(/Zadaj a/);
    expect((await run({ b: guid("W2") })).content).toMatch(/b bez a/);
    expect((await run({ a: "neznamy" })).content).toMatch(/Bez IFC GUID/);
    expect((await run({ a: guid("XX") })).content).toMatch(/Nie je v MINI/);
    expect((await run({ a: guid("ST1") })).content).toMatch(/nemá v MINI geometriu/);
  });
});
