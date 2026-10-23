import { clashReviewKey } from "@ifc-lite/clash";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryBcf, memoryClashStore, type MemoryBcf, type MemoryClashStore } from "../clash/testing";
import type { ClashResultRow, ClashRunRow } from "../clash/types";

import { guid } from "./__fixtures__/mini-building";
import { MINI_GEOMETRY_BYTES } from "./__fixtures__/mini-geometry";
import { clearEngineCache } from "./cache";
import { BCF_DEFAULT_MODEL, clearClashRuns, groupRun } from "./clash";
import { RESULT_CAP, runFromRows } from "./clash-saved";
import type { AimRef } from "./join";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_GEOMETRY_BYTES, { status: 200, headers: { etag: '"geo"' } })) as unknown as typeof fetch;

const AIM: Record<string, AimRef> = {
  [guid("W1")]: { object_id: "44444444-4444-4444-4444-444444444444", object_ref: "SN.01", name: "W1", object_type: "asset" },
};

let store: MemoryClashStore;
let bcf: MemoryBcf;
let deps: EngineDeps;

const call = async (input: Record<string, unknown>, d: EngineDeps = deps) => {
  const res = await execEngineTool("clash", input, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

/** Vlastný test: steny proti doske s odstupom 500 mm (v mini geometrii 2 kolízie, odstup 300 mm). */
const SAVE_MOJ = { action: "save", test: "MOJ", name: "Steny x doska", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 } as const;

beforeEach(() => {
  store = memoryClashStore();
  bcf = memoryBcf(store);
  deps = {
    sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/geo.ifc" }],
    lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
    resolveTargets: async () => new Map(),
    systems: async (guids) => new Map(guids.filter((g) => g === guid("W1") || g === guid("SL1")).map((g) => [g, "VZT-01"])),
    fetchImpl,
    clash: store,
    bcf,
  };
});

afterEach(() => {
  clearEngineCache();
  clearClashRuns();
});

describe("clash save a delete (D-164 PR2)", () => {
  it("vlastný test sa uloží, zobrazí v list a úprava s rovnakým kódom ho zmení, nezdvojí", async () => {
    const saved = await call(SAVE_MOJ);
    expect(saved.json).toMatchObject({ saved: true, created: true, test: { code: "MOJ", origin: "chat", mode: "clearance", clearance_mm: 500, a: { type: "IfcWall" }, b: { type: "IfcSlab" } } });
    const list = await call({ action: "list" });
    expect(list.json.tests.map((t: { code: string }) => t.code)).toEqual(["VZT-NOSNE", "VZT-ASR", "MOJ"]);
    expect(list.json.tests[2]).toMatchObject({ origin: "chat", last_run: null });

    const edited = await call({ action: "save", test: "MOJ", clearance_mm: 800, a_storey: "1NP" });
    expect(edited.json).toMatchObject({ created: false, test: { clearance_mm: 800, a: { type: "IfcWall", storey: "1NP" }, name: "Steny x doska" } });
    expect(store.tests.filter((t) => t.code === "MOJ")).toHaveLength(1);
  });

  it("predvolený kód, neznámy model, zlý kód a duplicitný kód z názvu sú chyby", async () => {
    expect((await call({ ...SAVE_MOJ, test: "VZT-NOSNE" })).content).toMatch(/predvolený test/);
    expect((await call({ ...SAVE_MOJ, a_model: "XYZ" })).content).toMatch(/Model XYZ nie je vo federácii \(MINI\)/);
    expect((await call({ ...SAVE_MOJ, test: "zlý kód" })).content).toMatch(/Kód testu/);
    await call(SAVE_MOJ);
    expect((await call({ action: "save", name: "moj", a: "IfcWall" })).content).toMatch(/Kód MOJ už existuje/);
    expect((await call({ action: "save", name: "Iný názov", a: "IfcWall" })).json.test.code).toBe("INY-NAZOV");
    expect((await call({ action: "save", test: "NOVY" })).content).toMatch(/Zadaj test[\s\S]*sadu a/);
    expect((await call(SAVE_MOJ, { ...deps, clash: undefined })).content).toMatch(/potrebuje DB/);
  });

  it("delete bez potvrdenia len ukáže, čo zmaže; s confirm zmaže test, behy a stav; predvolený nejde", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    await call({ action: "review", test: "MOJ", review_status: "resolved", group_by: "storey", group: "1NP" });
    const dry = await call({ action: "delete", test: "MOJ" });
    expect(dry.json).toMatchObject({ deleted: false, would_delete: { runs: 1, reviews: 2, topics: 0 } });
    expect(store.tests).toHaveLength(1);
    const done = await call({ action: "delete", test: "MOJ", confirm: true });
    expect(done.json).toMatchObject({ deleted: true, removed: { runs: 1, reviews: 2 } });
    expect([store.tests.length, store.runRows.length, store.resultRows.length, store.reviewRows.length]).toEqual([0, 0, 0, 0]);
    expect((await call({ action: "delete", test: "VZT-ASR", confirm: true })).content).toMatch(/Predvolený test sa nemaže/);
    expect((await call({ action: "delete", test: "MOJ", confirm: true })).content).toMatch(/nie je/);
  });
});

describe("clash run save=true a uložený beh (D-164 PR2)", () => {
  it("uloží beh s kolíziami, stabilným kľúčom a overenými prvkami; druhé uloženie ho nezdvojí", async () => {
    await call(SAVE_MOJ);
    const run = await call({ action: "run", test: "MOJ", save: true });
    expect(run.json).toMatchObject({ total: 2, saved: { results: 2, test: "MOJ" } });
    expect(run.json.saved_run_id).toBe(run.json.saved.run_id);
    expect(store.runRows).toHaveLength(1);
    const row = store.runRows[0];
    expect(row).toMatchObject({ test_code: "MOJ", trigger: "chat", engine: expect.stringContaining("@ifc-lite/clash") });
    expect(row.test_id).toBe(store.tests[0].id);
    expect(row.coverage?.a.sort()).toEqual([`MINI:${guid("W1")}`, `MINI:${guid("W2")}`]);
    expect(row.coverage?.b).toEqual([`MINI:${guid("SL1")}`]);
    expect(store.resultRows.map((r) => r.clash_key).sort()).toEqual([`MOJ MINI:${guid("SL1")} MINI:${guid("W1")}`, `MOJ MINI:${guid("SL1")} MINI:${guid("W2")}`]);
    expect(store.resultRows[0]).toMatchObject({ status: "clearance", storey: "1NP", rule: "MOJ", a_model: "MINI" });
    expect(store.resultRows[0].center).toHaveLength(3);

    const again = await call({ action: "run", test: "MOJ", save: true });
    expect(again.json).toMatchObject({ cached: true, saved: { already_saved: true, run_id: run.json.saved_run_id } });
    expect(store.runRows).toHaveLength(1);
    // bez save=true sa nič nezapíše
    clearClashRuns();
    await call({ action: "run", test: "MOJ", clearance_mm: 400 });
    expect(store.runRows).toHaveLength(1);
  });

  it("predvolený test sa pri ukladaní založí v DB s pôvodom default", async () => {
    // mini model nemá VZT, preto test ad hoc zúžený na MINI cez prepísanie strán
    const run = await call({ action: "run", test: "VZT-ASR", a_model: "MINI", b_model: "MINI", a: "IfcWall", b: "IfcSlab", clearance_mm: 500, save: true });
    expect(run.isError).toBe(false);
    expect(store.tests[0]).toMatchObject({ code: "VZT-ASR", origin: "default" });
    expect(store.runRows[0].test_id).toBe(store.tests[0].id);
  });

  it("ad hoc beh sa uloží bez testu s poznámkou", async () => {
    const run = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500, save: true });
    expect(run.json.saved).toMatchObject({ results: 2, note: expect.stringMatching(/nemá test/) });
    expect(store.runRows[0].test_id).toBeNull();
    expect((await call({ action: "review", review_status: "resolved", group: "1NP" })).content).toMatch(/Stav kolízie patrí testu/);
  });

  it("po reštarte (beh mimo pamäte) results, zoskupenie aj show_in_3d čítajú uložený beh z DB", async () => {
    await call(SAVE_MOJ);
    const run = await call({ action: "run", test: "MOJ", save: true });
    const live = await call({ action: "results", group_by: "type_pair", group: "1" });
    clearClashRuns(); // reštart inštancie
    expect((await call({ action: "results" })).content).toMatch(/najprv action=run/);

    const byId = await call({ action: "results", run_id: run.json.saved.run_id, group_by: "type_pair", group: "1" });
    expect(byId.json.group.count).toBe(2);
    expect(byId.json.show_in_3d).toEqual(live.json.show_in_3d);
    expect(byId.json.group.clashes.map((c: { key: string }) => c.key)).toEqual(live.json.group.clashes.map((c: { key: string }) => c.key));
    expect(byId.json.group.clashes[0].gap_mm).toBeCloseTo(300, 0);
    expect(byId.json.group.clashes.some((c: { a: { object_ref: string | null } }) => c.a.object_ref === "SN.01")).toBe(true);

    const byTest = await call({ action: "results", test: "MOJ", group_by: "storey" });
    expect(byTest.json).toMatchObject({ run_id: run.json.saved.run_id, total: 2 });
    expect(byTest.json.groups[0]).toMatchObject({ key: "1NP", count: 2 });
    expect((await call({ action: "results", test: "MOJ", group_by: "system" })).json.groups[0]).toMatchObject({ key: "VZT-01", count: 2 });
    expect((await call({ action: "results", test: "MOJ", group_by: "cluster" })).json.groups_total).toBeGreaterThan(0);
    expect((await call({ action: "results", run_id: "00000000-0000-4000-8000-00000000ffff" })).content).toMatch(/Uložený beh .* nie je/);
    expect((await call({ action: "results", test: "NIE" })).content).toMatch(/nemá žiadny beh/);
  });

  it("list s test ukáže uložené behy a počty stavov", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    await call({ action: "review", test: "MOJ", review_status: "accepted", group: "1NP" });
    const r = await call({ action: "list", test: "MOJ" });
    expect(r.json.runs).toHaveLength(1);
    expect(r.json.runs[0]).toMatchObject({ total: 2, trigger: "chat" });
    expect(r.json.reviews).toEqual({ accepted: 2 });
    expect((await call({ action: "list" })).json.tests[2].last_run).toMatchObject({ total: 2 });
  });

  it("strop uloženia kolízií odmietne beh so radou zúžiť", async () => {
    expect(RESULT_CAP).toBe(100_000);
    // krátky dôkaz cez beh nad stropom nejde bez veľkého modelu: kontrola, že hláška nesie strop a radu
    const { persistRun } = await import("./clash-saved");
    const fake = { saved: undefined, spec: { code: null }, result: { clashes: new Array(RESULT_CAP + 1).fill({ status: "hard" }) } } as never;
    await expect(persistRun(fake, deps)).rejects.toThrow(/nad stropom 100000[\s\S]*a_storey/);
  });

  it("obnovený beh má rovnaké kľúče, skupiny a pokrytie ako pôvodný", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const original = await call({ action: "results", test: "MOJ", group_by: "element", limit: 10 });
    const row = store.runRows[0];
    const rebuilt = runFromRows(row, await store.results(row.id));
    expect(rebuilt.result.clashes.map((c) => clashReviewKey(c)).sort()).toEqual(store.resultRows.map((r) => r.clash_key).sort());
    expect(groupRun({ run: rebuilt }, "element").map((g) => [g.title, g.members.length])).toEqual(original.json.groups.map((g: { title: string; count: number }) => [g.title, g.count]));
    expect(rebuilt.result.ruleCoverage?.[0]).toMatchObject({ rule: "MOJ", matchedA: 2, matchedB: 1 });
    expect(runFromRows({ ...row, coverage: null }, []).result.ruleCoverage?.[0].matchedKeysA).toBeUndefined();
  });
});

describe("clash review - stav kolízie sa prenáša medzi behmi (D-164 PR2)", () => {
  it("stav nastavený na skupinu platí v ďalšom behu toho istého testu, filter review a súčty", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const set = await call({ action: "review", test: "MOJ", review_status: "accepted", comment: "prechod je zámerný", group_by: "storey", group: "1NP" });
    expect(set.json).toMatchObject({ updated: 2, review_status: "accepted", test: "MOJ" });
    expect(store.reviewRows.map((r) => r.status)).toEqual(["accepted", "accepted"]);

    // nový beh (iná tolerancia = iný odtlačok), stav ostáva
    const next = await call({ action: "run", test: "MOJ", tolerance_mm: 3, save: true });
    expect(next.json.cached).toBe(false);
    const res = await call({ action: "results", run_id: next.json.saved_run_id, group_by: "storey", group: "1NP" });
    expect(res.json.by_review).toEqual({ accepted: 2 });
    expect(res.json.group.clashes.map((c: { review: { status: string; comment: string } }) => c.review)).toEqual([
      { status: "accepted", comment: "prechod je zámerný" },
      { status: "accepted", comment: "prechod je zámerný" },
    ]);
    const open = await call({ action: "results", run_id: next.json.saved_run_id, review: "open" });
    expect(open.json).toMatchObject({ total: 0, total_run: 2 });
    const accepted = await call({ action: "results", run_id: next.json.saved_run_id, review: "accepted", status: "clearance", severity: "info" });
    expect(accepted.json.total === 0 || accepted.json.total === 2).toBe(true);
    expect((await call({ action: "results", review: "hotovo" })).content).toMatch(/review je jedno z/);
  });

  it("zmena stavu bez comment poznámku zachová, prázdny comment ju zmaže; kľúče z results", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const rows = await call({ action: "results", group: "1NP" });
    const keys = rows.json.group.clashes.map((c: { key: string }) => c.key);
    await call({ action: "review", keys: [keys[0]], review_status: "resolved", comment: "opravené v revízii 5" });
    await call({ action: "review", keys: [keys[0]], review_status: "open" });
    expect(store.reviewRows).toHaveLength(1);
    expect(store.reviewRows[0]).toMatchObject({ clash_key: keys[0], status: "open", comment: "opravené v revízii 5" });
    await call({ action: "review", keys: [keys[0]], review_status: "open", comment: "" });
    expect(store.reviewRows[0].comment).toBe("");
  });

  it("chybný vstup: bez stavu, bez cieľa, cudzí kľúč", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    expect((await call({ action: "review", group: "1NP" })).content).toMatch(/Zadaj review_status/);
    expect((await call({ action: "review", review_status: "resolved" })).content).toMatch(/Zadaj keys/);
    expect((await call({ action: "review", review_status: "resolved", keys: ["MOJ x y"] })).content).toMatch(/tieto kľúče nemá: MOJ x y/);
    expect(store.reviewRows).toHaveLength(0);
  });
});

describe("clash compare (D-164 PR2)", () => {
  const runSaved = async (extra: Record<string, unknown> = {}) => (await call({ action: "run", test: "MOJ", save: true, ...extra })).json;

  it("nové, vyriešené a pretrvávajúce kolízie; stav pri pretrvávajúcej vyriešenej sa označí", async () => {
    await call(SAVE_MOJ);
    const first = await runSaved();
    // druhý beh s menším odstupom: obe kolízie zmiznú, prvky sa znova overili = vyriešené
    const second = await runSaved({ clearance_mm: 100 });
    expect(second.total).toBe(0);
    const cmp = await call({ action: "compare", run_id: second.saved_run_id });
    expect(cmp.json.summary).toEqual({ added: 0, persistent: 0, resolved: 2, unretested: 0 });
    expect(cmp.json.base.run_id).toBe(first.saved_run_id);
    expect(cmp.json.warnings.join(" ")).toMatch(/iný režim, odstup alebo toleranciu/);
    expect(cmp.json.by_storey.resolved).toEqual({ "1NP": 2 });

    // tretí beh s pôvodným odstupom vráti obe kolízie ako nové proti druhému a pretrvávajúce proti prvému
    const third = await runSaved({ clearance_mm: 500, tolerance_mm: 3 });
    const vsSecond = await call({ action: "compare", run_id: third.saved_run_id });
    expect(vsSecond.json.summary).toEqual({ added: 2, persistent: 0, resolved: 0, unretested: 0 });
    const vsFirst = await call({ action: "compare", run_id: third.saved_run_id, base_run_id: first.saved_run_id, bucket: "persistent" });
    expect(vsFirst.json.summary).toEqual({ added: 0, persistent: 2, resolved: 0, unretested: 0 });
    expect(vsFirst.json.bucket).toMatchObject({ name: "persistent", count: 2 });
    expect(vsFirst.json.show_in_3d.a_global_ids.sort()).toEqual([guid("W1"), guid("W2")]);
    expect(vsFirst.json.rows.persistent[0].a.object_ref === "SN.01" || vsFirst.json.rows.persistent[1].a.object_ref === "SN.01").toBe(true);

    await call({ action: "review", run_id: third.saved_run_id, review_status: "resolved", group: "1NP" });
    const marked = await call({ action: "compare", run_id: third.saved_run_id, base_run_id: first.saved_run_id });
    expect(marked.json.persistent_marked_resolved).toBe(2);
    expect(marked.json.samples.persistent[0].review.status).toBe("resolved");
  });

  it("kolízia, ktorej prvok beh znova neoveril, je nepretestovaná, nie vyriešená", async () => {
    await call(SAVE_MOJ);
    const first = await runSaved();
    const base = store.runRows[0];
    // Nový beh (zúžený rozsah): neoveril stenu W2, a teda ani jej kolíziu; W1 áno a kolízia W1 zmizla.
    const narrowed: ClashRunRow = {
      ...base,
      id: "c0000001-0000-4000-8000-000000000000",
      created_at: "2026-10-24T08:00:00.000Z",
      coverage: { a: [`MINI:${guid("W1")}`], b: base.coverage!.b },
    };
    store.runRows.push(narrowed);
    const cmp = await call({ action: "compare", run_id: narrowed.id, base_run_id: first.saved_run_id });
    expect(cmp.json.summary).toEqual({ added: 0, persistent: 0, resolved: 1, unretested: 1 });
    expect(cmp.json.samples.resolved[0].a.global_id).toBe(guid("W1"));
    expect(cmp.json.samples.unretested[0].a.global_id).toBe(guid("W2"));

    // Beh bez zoznamu overených prvkov nevie nič potvrdiť: všetko nepretestované.
    store.runRows[1] = { ...narrowed, coverage: null };
    const blind = await call({ action: "compare", run_id: narrowed.id, base_run_id: first.saved_run_id });
    expect(blind.json.summary).toEqual({ added: 0, persistent: 0, resolved: 0, unretested: 2 });
    expect(blind.json.warnings.join(" ")).toMatch(/nemá zoznam overených prvkov/);
  });

  it("beh orezaný stropom dvojíc nič nevyhlási za vyriešené", async () => {
    await call(SAVE_MOJ);
    const first = await runSaved();
    const cut = await call({ action: "run", test: "MOJ", tolerance_mm: 4, save: true }, { ...deps, clashLimits: { maxPairs: 1 } });
    expect(cut.json.truncated).toBeDefined();
    const cmp = await call({ action: "compare", run_id: cut.json.saved_run_id, base_run_id: first.saved_run_id });
    expect(cmp.json.summary.resolved).toBe(0);
    expect(cmp.json.summary.persistent + cmp.json.summary.unretested).toBe(2);
    expect(cmp.json.warnings.join(" ")).toMatch(/orezaný stropom dvojíc/);
  });

  it("chyby: bez predošlého behu, ten istý beh, ad hoc beh bez základu", async () => {
    await call(SAVE_MOJ);
    const first = await runSaved();
    expect((await call({ action: "compare", run_id: first.saved_run_id })).content).toMatch(/nemá predošlý uložený beh/);
    expect((await call({ action: "compare", run_id: first.saved_run_id, base_run_id: first.saved_run_id })).content).toMatch(/ten istý beh/);
    clearClashRuns();
    const adhoc = await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    expect((await call({ action: "compare", run_id: adhoc.json.run_id })).content).toMatch(/base_run_id/);
  });

  it("nesprávny kľúč bucket je chyba", async () => {
    await call(SAVE_MOJ);
    const a = await runSaved();
    const b = await runSaved({ clearance_mm: 100 });
    expect((await call({ action: "compare", run_id: b.saved_run_id, base_run_id: a.saved_run_id, bucket: "iné" })).content).toMatch(/bucket je jedno z/);
  });
});

describe("clash bcf create (D-164 PR2)", () => {
  it("založí tému Clash za skupinu s prvkami, pohľadom a odkazom z kolízií; druhý raz tému nezdvojí", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const proposal = await call({ action: "bcf", group_by: "storey", group: "1NP" });
    expect(proposal.json.write).toMatch(/Len návrh/);
    expect(bcf.created).toHaveLength(0);

    const r = await call({ action: "bcf", group_by: "storey", group: "1NP", create: true });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ created: true, topic: { number: 1 }, linked_clashes: 2 });
    expect(bcf.created).toHaveLength(1);
    expect(bcf.created[0]).toMatchObject({ topic_type: "Clash", model: "MINI", author: "Claude (MCP)", labels: ["clash", "MOJ"] });
    expect(bcf.created[0].components.sort()).toEqual([guid("SL1"), guid("W1"), guid("W2")].sort());
    expect(bcf.created[0].title).toContain("1NP");
    const vp = bcf.created[0].viewpoint as { camera: { target: { x: number; y: number; z: number }; position: { z: number } }; source: string };
    expect(vp.source).toBe("clash");
    expect(Object.keys(vp.camera.target)).toEqual(["x", "y", "z"]);
    expect(vp.camera.position.z).toBeGreaterThan(vp.camera.target.z);
    expect(bcf.notified).toBe(1);
    expect(store.reviewRows.map((x) => x.bcf_topic_id)).toEqual([bcf.created[0] ? expect.any(String) : null, expect.any(String)]);

    const again = await call({ action: "bcf", group_by: "storey", group: "1NP", create: true });
    expect(again.json).toMatchObject({ created: false, existing: { linked_clashes: 2, topics: [{ number: 1 }] } });
    expect(bcf.created).toHaveLength(1);

    // stav kolízií ostal otvorený (odkaz na tému ho nemení) a results ukáže odkaz
    expect(store.reviewRows.every((x) => x.status === "open")).toBe(true);
  });

  it("model témy je predvolene VZT, ak ho beh má; inak prvý model behu; bez BCF vrstvy je chyba", async () => {
    expect(BCF_DEFAULT_MODEL).toBe("VZT");
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const base = store.runRows[0];
    const rows: ClashResultRow[] = store.resultRows.map(({ run_id, ...r }) => (void run_id, { ...r, a_model: "VZT", b_model: "ASR" }));
    const id = await store.saveRun({ ...base, models: { ASR: {}, VZT: {} } } as never, rows);
    const r = await call({ action: "bcf", run_id: id, group_by: "storey", group: "1NP", create: true });
    expect(r.isError).toBe(false);
    expect(bcf.created[0].model).toBe("VZT");
    expect((await call({ action: "bcf", run_id: id, group_by: "rule", group: "1", create: true }, { ...deps, bcf: undefined })).content).toMatch(/potrebuje DB \(BCF vrstvu\)/);
  });

  it("ad hoc beh založí tému bez odkazu z kolízií a povie to", async () => {
    await call({ action: "run", a: "IfcWall", b: "IfcSlab", mode: "clearance", clearance_mm: 500 });
    const r = await call({ action: "bcf", group_by: "storey", group: "1NP", create: true });
    expect(r.json).toMatchObject({ created: true, linked_clashes: 0, warning: expect.stringMatching(/bez odkazu/) });
  });

  it("zlyhanie odkazu po založení témy nezhodí výsledok, len ho ohlási", async () => {
    await call(SAVE_MOJ);
    await call({ action: "run", test: "MOJ", save: true });
    const broken = { ...store, linkTopic: async () => { throw new Error("DB padla"); } } as MemoryClashStore;
    Object.setPrototypeOf(broken, store);
    const r = await call({ action: "bcf", group_by: "storey", group: "1NP", create: true }, { ...deps, clash: broken });
    expect(r.json).toMatchObject({ created: true, linked_clashes: 0, warning: expect.stringMatching(/DB padla/) });
  });
});
