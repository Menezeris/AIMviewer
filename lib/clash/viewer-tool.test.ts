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

describe("clash action=matrix (D-177)", () => {
  const MATRIX = {
    models: ["ASR", "VZT"],
    cells: [{ a: "ASR", b: "VZT", total: 2, by_status: { hard: 1, clearance: 1 }, by_review: { open: 1, resolved: 1 } }],
  };

  it("otvorený beh: vráti clash_local.matrix tak, ako je, so source local", async () => {
    state = { clash_local: { test: TEST, run: { total: 2 }, matrix: MATRIX } };
    const r = await call({ action: "matrix" });
    expect(r.json).toMatchObject({ source: "local", total: 2, matrix: MATRIX });
  });

  it("bez otvoreného behu povie, nech sa najprv spustí test; starší viewer bez matrix nie je prázdna matica", async () => {
    state = {};
    expect((await call({ action: "matrix" })).content).toMatch(/najprv spusti test \(clash open run\)/);
    state = { clash_local: { test: TEST } };
    expect((await call({ action: "matrix" })).content).toMatch(/najprv spusti test/);
    state = { clash_local: { test: TEST, run: { total: 2 } } };
    const old = await call({ action: "matrix" });
    expect(old.isError).toBe(true);
    expect(old.content).toMatch(/Viewer ešte nemá maticu/);
    state = "viewer neodpovedal";
    expect((await call({ action: "matrix" })).content).toMatch(/nedal prečítať/);
  });

  it("uložený beh: neusporiadaná dvojica modelov, druh z kind, stav z review (chýbajúci = open)", async () => {
    const C = { model: "ASR", guid: "0cccccccccccccccccccc1" };
    const D = { model: "VZT", guid: "0ddddddddddddddddddddd" };
    await saveFromViewer(store, {
      test: TEST as never,
      run: {
        results: [
          { kind: "hard", severity: "major", distance: -0.01, a: A, b: B },
          { kind: "clearance", severity: "minor", distance: 0.02, a: D, b: C },
          { kind: "hard", severity: "major", distance: -0.02, a: A, b: C },
          { kind: "hard", severity: "major", distance: -0.03, a: C, b: B },
        ],
      },
    });
    const run = store.runRows[0];
    const keys = store.resultRows.map((r) => r.clash_key);
    await store.setReviews(run.test_id as string, [keys[0]], { status: "resolved" }, "test");
    const r = await call({ action: "matrix", run_id: run.id });
    expect(r.json.source).toBe("saved");
    expect(r.json.total).toBe(4);
    const { matrix } = r.json;
    expect(matrix.models).toEqual(["ASR", "VZT"]);
    // všetky cells a <= b a zoradené, súčet total = počet kolízií
    expect(matrix.cells.map((c: { a: string; b: string }) => [c.a, c.b])).toEqual([["ASR", "ASR"], ["ASR", "VZT"]]);
    expect(matrix.cells.reduce((s: number, c: { total: number }) => s + c.total, 0)).toBe(4);
    const cross = matrix.cells[1];
    expect(cross.total).toBe(3);
    expect(cross.by_status.hard + cross.by_status.clearance).toBe(3);
    expect(cross.by_review.open + cross.by_review.resolved).toBe(3);
    expect(cross.by_review.resolved).toBe(1);
  });

  it("run_id musí byť UUID uloženého behu", async () => {
    expect((await call({ action: "matrix", run_id: "run-1" })).content).toMatch(/UUID/);
  });
});
