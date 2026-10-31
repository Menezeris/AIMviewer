import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import { clearClashRuns, detect, groupRun, parseSpec, type ClashRun } from "./clash";
import { DEFAULT_TESTS, STRUCTURAL_TYPES } from "./clash-tests";
import type { AimRef } from "./join";
import type { MeshElement } from "./measure";
import type { EngineModel } from "./session";
import { ENGINE_TOOL_NAMES } from "./tool-defs";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch;

const AIM: Record<string, AimRef> = {
  [guid("W1")]: { object_id: "44444444-4444-4444-4444-444444444444", object_ref: "SN.01", name: "W1", object_type: "asset" },
};

const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async () => new Map(),
  systems: async (guids) => new Map(guids.filter((g) => g === guid("W1") || g === guid("SL1")).map((g) => [g, "VZT-01"])),
  fetchImpl,
};

const call = async (input: Record<string, unknown>, d: EngineDeps = deps) => {
  const res = await execEngineTool("clash", input, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

/** Kocka s hranou `s` (Y-up), posunutá o `at`. */
function cube(model: string, id: string, ifcType: string, at: [number, number, number], s = 1, expressId = 1): MeshElement {
  const v = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((x, i) => x * s + at[i % 3]);
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  const positions = new Float32Array(v);
  return {
    globalId: guid(id),
    expressId,
    model,
    ifcType,
    name: id,
    positions,
    indices: new Uint32Array(f),
    parts: [0],
    bounds: { min: [at[0], at[1], at[2]], max: [at[0] + s, at[1] + s, at[2] + s] },
  };
}

const fake = (id: string): EngineModel => ({ id, name: `${id}.ifc`, store: {} as EngineModel["store"] });

function sets(...els: MeshElement[]) {
  const by = new Map<string, { model: EngineModel; meshes: Map<string, MeshElement> }>();
  for (const e of els) {
    const h = by.get(e.model) ?? { model: fake(e.model), meshes: new Map() };
    h.meshes.set(e.globalId, e);
    by.set(e.model, h);
  }
  return by;
}

describe("clash (D-164) - jadro", () => {
  it("hard: prienik dvoch modelov, dotyk a vzdialený prvok nie", async () => {
    const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0], 1, 1);
    const wall = cube("ASR", "W1", "IfcWall", [0.5, 0.5, 0.5], 1, 2);
    const far = cube("ASR", "W9", "IfcWall", [10, 0, 0], 1, 3);
    const spec = parseSpec({ a: "IfcDuct*", a_model: "VZT", b: "IfcWall", b_model: "ASR" });
    const { result, sets: n } = await detect({ spec, elements: sets(duct, wall, far) });
    expect(n).toEqual({ a: 1, b: 2 });
    expect(result.clashes).toHaveLength(1);
    expect(result.clashes[0]).toMatchObject({ status: "hard", a: { key: `VZT:${guid("D1")}` }, b: { key: `ASR:${guid("W1")}` } });
  });

  it("clearance: odstup pod limitom je kolízia, nad ním nie", async () => {
    const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0]);
    const wall = cube("ASR", "W1", "IfcWall", [1.04, 0, 0], 1, 2);
    const near = parseSpec({ a: "IfcDuct*", b: "IfcWall", mode: "clearance", clearance_mm: 50 });
    const far = parseSpec({ a: "IfcDuct*", b: "IfcWall", mode: "clearance", clearance_mm: 30 });
    const els = sets(duct, wall);
    const hit = (await detect({ spec: near, elements: els })).result.clashes;
    expect(hit).toHaveLength(1);
    expect(hit[0].status).toBe("clearance");
    expect(hit[0].distance).toBeCloseTo(0.04, 3);
    expect((await detect({ spec: far, elements: els })).result.clashes).toHaveLength(0);
  });

  it("IfcSpace sa v kolíziách neberie, kým ho selektor nepomenuje", async () => {
    const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0]);
    const space = cube("ASR", "S1", "IfcSpace", [0, 0, 0], 3, 2);
    expect((await detect({ spec: parseSpec({ a: "IfcDuct*", b: "*" }), elements: sets(duct, space) })).result.clashes).toHaveLength(0);
    const named = await detect({ spec: parseSpec({ a: "IfcDuct*", b: "IfcSpace" }), elements: sets(duct, space) });
    expect(named.result.clashes).toHaveLength(1);
  });

  it("prázdna strana je chyba s opisom filtra, nie prázdny výsledok", async () => {
    const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0]);
    await expect(detect({ spec: parseSpec({ a: "IfcDuct*", b: "IfcWall", b_model: "ASR" }), elements: sets(duct) })).rejects.toThrow(/Strana b.*IfcWall.*model ASR/);
  });

  it("bez b sa sada a testuje sama so sebou", async () => {
    const d1 = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0], 1, 1);
    const d2 = cube("VZT", "D2", "IfcDuctSegment", [0.5, 0, 0], 1, 2);
    const { result, sets: n } = await detect({ spec: parseSpec({ a: "IfcDuct*" }), elements: sets(d1, d2) });
    expect(n.b).toBeNull();
    expect(result.clashes).toHaveLength(1);
  });

  it("zoskupenie podľa dvojice tried, prvku a pravidla je súhrn úplný", async () => {
    const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0], 3, 1);
    const w1 = cube("ASR", "W1", "IfcWall", [1, 1, 1], 1, 2);
    const w2 = cube("ASR", "W2", "IfcWall", [2, 1, 1], 1, 3);
    const s1 = cube("ASR", "SL1", "IfcSlab", [1, 1, 2], 0.5, 4);
    const spec = parseSpec({ a: "IfcDuct*", b: "IfcWall|IfcSlab" });
    const { result, info } = await detect({ spec, elements: sets(duct, w1, w2, s1) });
    const run = { result, info } as unknown as ClashRun;
    expect(result.clashes).toHaveLength(3);
    const byPair = groupRun({ run }, "type_pair");
    expect(byPair.map((g) => [g.key, g.members.length])).toEqual([
      ["IfcDuctSegment x IfcWall", 2],
      ["IfcDuctSegment x IfcSlab", 1],
    ]);
    const byElement = groupRun({ run }, "element");
    expect(byElement[0].members).toHaveLength(3);
    expect(byElement[0].title).toContain("D1");
    expect(groupRun({ run }, "rule")).toHaveLength(1);
    // Bez podlažia (prvky bez priestorovej väzby) ide všetko do jednej skupiny.
    expect(groupRun({ run }, "storey").map((g) => g.key)).toEqual(["bez podlažia"]);
  });
});

describe("clash (D-164 dodatok, #292) - filter LoadBearing", () => {
  const duct = cube("VZT", "D1", "IfcDuctSegment", [0, 0, 0], 4, 1);
  const wallTrue = cube("ASR", "WT", "IfcWall", [1, 1, 1], 1, 2);
  const wallFalse = cube("ASR", "WF", "IfcWall", [1.5, 1.5, 1.5], 1, 3);
  const wallNone = cube("ASR", "WN", "IfcWall", [2, 2, 2], 1, 4);
  const lb = new Map<string, boolean | null>([[wallTrue.globalId, true], [wallFalse.globalId, false]]);
  const loadBearing = (e: MeshElement) => lb.get(e.globalId) ?? null;
  const run = (b_load_bearing?: string) =>
    detect({ spec: parseSpec({ a: "IfcDuct*", b: "IfcWall", ...(b_load_bearing ? { b_load_bearing } : {}) }), elements: sets(duct, wallTrue, wallFalse, wallNone), loadBearing });

  it("bez filtra ostanú všetky steny, true/false/unknown ich rozdelia", async () => {
    expect((await run()).sets.b).toBe(3);
    expect((await run("true")).sets.b).toBe(1);
    expect((await run("false")).sets.b).toBe(1);
    expect((await run("unknown")).sets.b).toBe(1);
    const only = await run("true");
    expect(only.result.clashes).toHaveLength(1);
    expect(only.info.get(only.result.clashes[0].b.key)?.guid).toBe(wallTrue.globalId);
  });

  it("VZT-NOSNE berie len nosné triedy s LoadBearing true", async () => {
    const spec = parseSpec({ test: "VZT-NOSNE" });
    expect(spec.b?.load_bearing).toBe("true");
    const member = cube("ASR", "M1", "IfcMember", [1.2, 1.2, 1.2], 1, 5);
    const d = await detect({ spec, elements: sets(duct, wallTrue, wallFalse, wallNone, member), loadBearing });
    expect(d.sets.b).toBe(1);
  });

  it("strana bez prvkov po filtri nosnosti povie, aký filter bol", async () => {
    await expect(run("unknown").then(() => detect({ spec: parseSpec({ a: "IfcDuct*", b: "IfcWall", b_load_bearing: "true" }), elements: sets(duct, wallFalse), loadBearing }))).rejects.toThrow(/LoadBearing true/);
  });
});

describe("clash (D-164) - vstup", () => {
  it("predvolené testy: VZT x nosné hard, VZT x ASR odstup 50 mm", () => {
    expect(DEFAULT_TESTS.map((t) => t.name)).toEqual(["VZT x nosné konštrukcie", "VZT x ASR"]);
    expect(parseSpec({ test: "VZT x nosné konštrukcie" })).toMatchObject({ mode: "hard", code: "VZT-NOSNE", a: { model: "VZT" }, b: { model: "ASR", type: STRUCTURAL_TYPES } });
    expect(parseSpec({ test: "vzt-asr" })).toMatchObject({ mode: "clearance", clearance: 0.05, b: { type: "!IfcSpace" } });
  });

  it("parametre prepíšu test, chybný vstup je InputError", () => {
    expect(parseSpec({ test: "VZT-ASR", clearance_mm: 100 }).clearance).toBeCloseTo(0.1, 6);
    // Zúženie na podlažie ponechá triedy a model testu (nenahradí stranu celú).
    const narrowed = parseSpec({ test: "VZT-NOSNE", a_storey: "2NP", b_storey: "2NP" });
    expect(narrowed.a).toEqual({ type: "*", model: "VZT", storey: "2NP" });
    expect(narrowed.b).toEqual({ type: STRUCTURAL_TYPES, model: "ASR", storey: "2NP", load_bearing: "true" });
    // Zúženie triedy ponechá filter nosnosti testu, b_load_bearing ho prepíše.
    expect(parseSpec({ test: "VZT-NOSNE", b: "IfcSlab" }).b).toEqual({ type: "IfcSlab", model: "ASR", load_bearing: "true" });
    expect(parseSpec({ test: "VZT-NOSNE", b_load_bearing: "unknown" }).b).toMatchObject({ load_bearing: "unknown" });
    expect(() => parseSpec({ a: "IfcWall", b_load_bearing: "možno" })).toThrow(/b_load_bearing/);
    expect(parseSpec({ a: "IfcWall", a_model: "ASR" }).a).toEqual({ type: "IfcWall", model: "ASR" });
    expect(parseSpec({ a: "IfcWall", b_storey: "1NP" }).b).toEqual({ type: "*", storey: "1NP" });
    expect(() => parseSpec({})).toThrow(/Zadaj test/);
    expect(() => parseSpec({ test: "nie je" })).toThrow(/Predvolené/);
    expect(() => parseSpec({ a: "IfcWall", mode: "clearance" })).toThrow(/clearance_mm/);
    expect(() => parseSpec({ a: "IfcWall", mode: "blízko" })).toThrow(/hard alebo clearance/);
    expect(() => parseSpec({ a: "IfcWall", tolerance_mm: -1 })).toThrow(/tolerance_mm/);
  });
});

describe("clash tool (D-164)", () => {
  afterEach(() => {
    clearEngineCache();
    clearClashRuns();
  });

  it("je medzi tools motora", () => {
    expect(ENGINE_TOOL_NAMES.has("clash")).toBe(true);
  });

  it("list vráti dva predvolené testy", async () => {
    const r = await call({ action: "list" });
    expect(r.json.tests.map((t: { code: string }) => t.code)).toEqual(["VZT-NOSNE", "VZT-ASR"]);
  });

  it("run -> results: podlažie z IFC, dvojice tried, prvky a show_in_3d", async () => {
    const run = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect(run.isError).toBe(false);
    expect(run.json).toMatchObject({ run_id: "run-1", total: 2, cached: false, by_status: { clearance: 2 }, by_storey: { "1NP": 2 }, sets: { a: 2, b: 1 } });
    expect(run.json.models.MINI).toBeDefined();

    const byStorey = await call({ action: "results", group_by: "storey" });
    expect(byStorey.json.groups).toHaveLength(1);
    expect(byStorey.json.groups[0]).toMatchObject({ key: "1NP", count: 2, index: 1 });
    expect(byStorey.json.groups[0].sample[0].gap_mm).toBeCloseTo(300, 0);
    expect(byStorey.json.groups[0].sample.some((s: { a: { object_ref: string | null } }) => s.a.object_ref === "SN.01")).toBe(true);

    const byElement = await call({ action: "results", group_by: "element", limit: 5 });
    expect(byElement.json.groups_total).toBe(3);
    expect(byElement.json.groups[0]).toMatchObject({ count: 2 });
    expect(byElement.json.groups[0].title).toContain("SL1");

    const expanded = await call({ action: "results", group_by: "type_pair", group: "1" });
    expect(expanded.json.group).toMatchObject({ count: 2, key: "IfcWall x IfcSlab" });
    expect(expanded.json.show_in_3d.a_global_ids.sort()).toEqual([guid("W1"), guid("W2")]);
    expect(expanded.json.show_in_3d.b_global_ids).toEqual([guid("SL1")]);
  });

  it("results s iným group_by nepočíta znova (beh z pamäte) a rovnaký run je cached", async () => {
    const first = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    const again = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect(again.json).toMatchObject({ run_id: first.json.run_id, cached: true });
    const other = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 100 });
    expect(other.json).toMatchObject({ run_id: "run-2", total: 0 });
    // results bez run_id berie posledný beh, s run_id konkrétny.
    expect((await call({ action: "results" })).json.run_id).toBe("run-2");
    expect((await call({ action: "results", run_id: "run-1", group_by: "rule" })).json.groups[0]).toMatchObject({ count: 2 });
  });

  it("group_by=system joinuje systém z grafu AIM, prvok bez systému je zvlášť", async () => {
    await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    const r = await call({ action: "results", group_by: "system" });
    expect(r.json.groups.map((g: { key: string; count: number }) => [g.key, g.count])).toEqual([["VZT-01", 2]]);
    const noDb = await call({ action: "results", group_by: "system" }, { ...deps, systems: undefined });
    expect(noDb.isError).toBe(true);
    expect(noDb.content).toMatch(/graf AIM/);
  });

  it("bcf: návrh témy za skupinu bez zápisu, model predvolene VZT len ak je v behu", async () => {
    await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    const r = await call({ action: "bcf", group_by: "storey", group: "1NP" });
    expect(r.isError).toBe(false);
    expect(r.json.proposal).toMatchObject({ type: "Clash", model: "MINI", priority: expect.any(String) });
    expect(r.json.proposal.title).toContain("1NP");
    expect(r.json.proposal.global_ids.sort()).toEqual([guid("SL1"), guid("W1"), guid("W2")].sort());
    expect(r.json.write).toMatch(/Len návrh, nič sa nezapísalo/);
    expect((await call({ action: "bcf", group_by: "storey", group: "1NP", model: "VZT" })).json.proposal.model).toBe("VZT");
    expect((await call({ action: "bcf", group_by: "storey" })).content).toMatch(/Zadaj group/);
    expect((await call({ action: "bcf", group_by: "storey", group: "9NP" })).content).toMatch(/neexistuje/);
  });

  it("filter podlažia zúži sadu; neznáme podlažie dá chybu o prázdnej strane", async () => {
    const ok = await call({ action: "run", a: "IfcWall", a_storey: "1.NP", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect(ok.json.total).toBe(2);
    const none = await call({ action: "run", a: "IfcWall", a_storey: "5NP", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect(none.isError).toBe(true);
    expect(none.content).toMatch(/Strana a.*podlažie 5NP/);
  });

  it("pri prekročení stropu dvojíc ponúkne podlažia a zúženie, pri rozpočte tiež", async () => {
    const capped = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 }, { ...deps, clashLimits: { maxPairs: 1 } });
    expect(capped.isError).toBe(false);
    expect(capped.json.truncated.note).toMatch(/Zúž test: podlažie \(a_storey, b_storey\), napr\. 1NP, 2NP/);
    clearClashRuns();
    const slow = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 }, { ...deps, clashLimits: { budgetMs: 0 } });
    expect(slow.isError).toBe(true);
    expect(slow.content).toMatch(/Beh presiahol 0 s\. Zúž test.*1NP, 2NP.*a_storey='2NP'/);
    clearClashRuns();
    const scoped = await call({ action: "run", a: "IfcWall", a_storey: "1NP", b: "IfcSlab", mode: "clearance", clearance_mm: 500 }, { ...deps, clashLimits: { budgetMs: 0 } });
    expect(scoped.content).toMatch(/podlažie už je zadané/);
    expect(scoped.content).not.toMatch(/1NP, 2NP/);
  });

  it("open a from_viewer bez živého viewera povedia, že viewer nie je nastavený; chyby vstupu nie sú výnimka", async () => {
    for (const action of ["open", "from_viewer"]) {
      const r = await call({ action });
      expect(r.isError).toBe(true);
      expect(r.content).toMatch(/živý viewer nie je nastavený/);
    }
    expect((await call({ action: "results" })).content).toMatch(/najprv action=run/);
    expect((await call({ action: "run" })).content).toMatch(/Zadaj test/);
    expect((await call({ action: "nic" })).content).toMatch(/action je/);
    expect((await call({ action: "results", run_id: "run-99" })).content).toMatch(/nie je v pamäti/);
    expect((await call({ action: "results", run_id: "nie-uuid" })).content).toMatch(/nie je beh z pamäte \(run-N\) ani uložený beh/);
    await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect((await call({ action: "results", group_by: "farba" })).content).toMatch(/group_by je/);
  });
});
