import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_MATERIALS_BYTES } from "./__fixtures__/mini-materials";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { foldText, matchMaterial } from "./materials";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_MATERIALS_BYTES, { status: 200, headers: { etag: '"mat"' } })) as typeof fetch;

/** AIM pozná len prvú stenu skladby. */
const AIM: Record<string, AimRef> = {
  [guid("MWAL1")]: { object_id: "33333333-3333-3333-3333-333333333333", object_ref: "FS01.10.0001", name: "Stena 1", object_type: "asset" },
};

const deps: EngineDeps = {
  sources: () => [{ id: "MAT", label: "Materiály", url: "https://example.test/mat.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async (targets) => new Map(targets.filter((t) => t === "FS01.10.0001").map((t) => [t, guid("MWAL1")])),
  fetchImpl,
};

const run = async (name: string, input: Record<string, unknown>) => {
  const res = await execEngineTool(name, input, deps);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("matchMaterial (D-108)", () => {
  const set = {
    type: "MaterialLayerSet",
    name: "FS01.10 ETICS",
    layers: [
      { materialName: "Omietka", thickness: 0.01, category: "Finish" },
      { materialName: "EPS 70F", thickness: 0.15, materialCategory: "Tepelná izolácia" },
    ],
  };

  it("nájde vrstvu podľa materiálu aj kategórie, bez diakritiky a veľkosti písmen", () => {
    expect(matchMaterial(set, foldText("eps"))).toEqual([{ position: 2, material: "EPS 70F", category: "Tepelná izolácia", thickness: 0.15 }]);
    expect(matchMaterial(set, foldText("IZOLACIA")).map((m) => m.position)).toEqual([2]);
    expect(matchMaterial(set, foldText("drevo"))).toEqual([]);
  });

  it("zhoda na názve skladby vráti všetky vrstvy; jeden materiál podľa názvu", () => {
    expect(matchMaterial(set, foldText("etics")).map((m) => m.position)).toEqual([1, 2]);
    expect(matchMaterial({ type: "Material", name: "Betón C25/30", category: "Betón" }, foldText("beton"))).toEqual([
      { material: "Betón C25/30", category: "Betón" },
    ]);
    expect(matchMaterial(null, "eps")).toEqual([]);
  });
});

describe("ifc_material_layers a materiály v ifc_get (D-108)", () => {
  afterEach(() => clearEngineCache());

  it("izolácia: vrstva z typu aj zložka dosky, súhrn podľa skladby a show_in_3d", async () => {
    const r = await run("ifc_material_layers", { material: "izol" });
    expect(r.isError).toBe(false);
    expect(r.json.total).toBe(3);
    expect(r.json.sets.map((s: { set: string; count: number }) => [s.set, s.count])).toEqual([
      ["FS01.10 ETICS", 2],
      ["SK02 strecha", 1],
    ]);
    const wall = r.json.items.find((i: { global_id: string }) => i.global_id === guid("MWAL1"));
    expect(wall).toMatchObject({ object_ref: "FS01.10.0001", ifc_type: "IfcWall", set: "FS01.10 ETICS" });
    expect(wall.layers).toEqual([{ position: 2, material: "EPS 70F", name: "Izolant", category: "Insulation", thickness: 0.15 }]);
    expect(r.json.show_in_3d.ids_or_refs).toEqual(["33333333-3333-3333-3333-333333333333"]);
    expect(r.json.show_in_3d.global_ids.sort()).toEqual([guid("MSLB1"), guid("MWAL2")].sort());
  });

  it("ifc_types a limit: len steny, vypísaná jedna, total a show_in_3d za všetky", async () => {
    const r = await run("ifc_material_layers", { material: "betón", ifc_types: ["IfcWall"], limit: 1 });
    expect(r.json.total).toBe(3);
    expect(r.json.items).toHaveLength(1);
    expect(r.json.truncated).toBe(true);
    expect(r.json.show_in_3d.ids_or_refs.length + r.json.show_in_3d.global_ids.length).toBe(3);
  });

  it("krátky dopyt odmietne", async () => {
    // D-115: ifc_query(mode=count, material) = ten istý total bez zoznamu prvkov.
    const full = await run("ifc_material_layers", { material: "izol" });
    const count = await run("ifc_query", { mode: "count", material: "izol" });
    expect(count.json.total).toBe(full.json.total);
    expect(count.json.sets).toEqual(full.json.sets);
    expect(count.json.items).toBeUndefined();
    expect((await run("ifc_query", { mode: "values", material: "izol" })).isError).toBe(true);
    const r = await run("ifc_material_layers", { material: "e" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/aspoň 2 znaky/);
  });

  it("ifc_get vracia vrstvy skladby zdedené z typu", async () => {
    const r = await run("ifc_get", { targets: ["FS01.10.0001"] });
    const mat = r.json.items[0].materials;
    expect(mat.name).toBe("FS01.10 ETICS");
    expect(mat.layers.map((l: { materialName: string; thickness: number }) => [l.materialName, l.thickness])).toEqual([
      ["Omietka silikonova", 0.01],
      ["EPS 70F", 0.15],
      ["Betón C25/30", 0.2],
    ]);
  });
});
