import { beforeEach, describe, expect, it } from "vitest";

import { execEngineTool, type EngineDeps } from "../engine/tools";
import type { ClashOpenReq } from "../viewer-clash";

import { memoryClashStore, type MemoryClashStore } from "./testing";
import { saveFromViewer } from "./viewer";
import type { ClashOpenOutcome } from "./viewer-tool";

let store: MemoryClashStore;
let opened: ClashOpenReq[];
let state: unknown;
let outcome: ClashOpenOutcome;
let deps: EngineDeps;

const call = async (input: Record<string, unknown>) => {
  const res = await execEngineTool("clash", input, deps);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

const A = { model: "VZT", guid: "0aaaaaaaaaaaaaaaaaaaaa" };
const B = { model: "ASR", guid: "0bbbbbbbbbbbbbbbbbbbbb" };
const TEST = { code: "MOJ", name: "Potrubie x steny", a: { type: "IfcDuct*", model: "VZT" }, b: { type: "IfcWall*" }, mode: "hard" };

beforeEach(() => {
  store = memoryClashStore();
  opened = [];
  state = { clash_local: { test: TEST, from_aim: false, dirty: true } };
  outcome = { ok: true, issues: [] };
  deps = {
    lookup: async () => new Map(),
    resolveTargets: async () => new Map(),
    clash: store,
    clashViewer: {
      open: async (req) => {
        opened.push(req);
        return outcome;
      },
      viewState: async () => state,
    },
  };
});

describe("clash action=open (D-164)", () => {
  it("otvorí test s behom a povie, čo viewer dostal", async () => {
    await saveFromViewer(store, { test: TEST as never, run: { results: [{ kind: "hard", severity: "major", distance: -0.01, a: A, b: B }] } });
    const r = await call({ action: "open", test: "MOJ", run_id: "latest" });
    expect(r.json).toMatchObject({ opened: true, test: { code: "MOJ" }, run: { total: 1, trigger: "viewer" }, results_in_viewer: 1 });
    expect(opened).toEqual([{ test: "MOJ", run: "latest" }]);
  });

  it("bez behu otvorí len test; predvolený test funguje aj bez riadku v DB", async () => {
    const r = await call({ action: "open", test: "VZT-ASR" });
    expect(r.json).toMatchObject({ opened: true, test: { code: "VZT-ASR", mode: "clearance" } });
    expect(r.json).not.toHaveProperty("run");
    expect(opened).toEqual([{ test: "VZT-ASR" }]);
  });

  it("chyby: bez testu, neznámy test, beh z pamäte, viewer neotvoril", async () => {
    expect((await call({ action: "open" })).content).toMatch(/Zadaj test/);
    expect((await call({ action: "open", test: "NIC" })).content).toMatch(/nie je/);
    expect((await call({ action: "open", test: "VZT-ASR", run_id: "run-1" })).content).toMatch(/UUID/);
    outcome = { ok: false, reason: "viewer neodpovedal (nie je otvorený s ?live=)" };
    const r = await call({ action: "open", test: "VZT-ASR" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/viewer neodpovedal/);
  });
});

describe("clash action=from_viewer (D-164)", () => {
  it("uloží test a zmenené stavy z clash_local", async () => {
    state = { clash_local: { test: TEST, from_aim: false, dirty: true, reviews: [{ a: A, b: B, status: "resolved", comment: "hotovo" }] } };
    const r = await call({ action: "from_viewer" });
    expect(r.json).toMatchObject({ saved: true, test_code: "MOJ", reviews: 1 });
    expect(store.tests[0]).toMatchObject({ code: "MOJ", origin: "viewer" });
    expect(store.reviewRows[0]).toMatchObject({ status: "resolved", comment: "hotovo", updated_by: expect.stringContaining("Viewer") });
  });

  it("test z AIM bez zmeny sa neukladá; iný kód uloží ako to", async () => {
    state = { clash_local: { test: TEST, from_aim: true, dirty: false } };
    expect((await call({ action: "from_viewer" })).json).toMatchObject({ saved: false });
    expect(store.tests).toHaveLength(0);
    const r = await call({ action: "from_viewer", test: "KOPIA" });
    expect(r.json).toMatchObject({ saved: true, test_code: "KOPIA" });
  });

  it("chyby: panel nehlási stav, nie je čo uložiť, neplatný tvar, stav viewera sa nedá prečítať", async () => {
    state = {};
    expect((await call({ action: "from_viewer" })).content).toMatch(/clash_local/);
    state = { clash_local: { from_aim: false, dirty: true } };
    expect((await call({ action: "from_viewer" })).content).toMatch(/nie je čo uložiť/);
    state = { clash_local: { test: { name: "x" }, dirty: true } };
    expect((await call({ action: "from_viewer" })).content).toMatch(/neplatný tvar/);
    state = "viewer neodpovedal";
    expect((await call({ action: "from_viewer" })).content).toMatch(/nedal prečítať/);
  });
});
