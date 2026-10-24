import { clashReviewKey } from "@ifc-lite/clash";
import { beforeEach, describe, expect, it } from "vitest";

import type { ClashResultWire, ClashSaveWire } from "../viewer-clash";

import { memoryClashStore, type MemoryClashStore } from "./testing";
import { ClashViewerError, clashKey, listForViewer, loadForViewer, saveFromViewer } from "./viewer";

const el = (model: string, guid: string, type = "IfcWall") => ({ model, guid, type });
const row = (n: number, over: Partial<ClashResultWire> = {}): ClashResultWire => ({
  kind: "hard",
  severity: "major",
  distance: -0.01 * n,
  a: el("VZT", `0A${n}`.padEnd(22, "a"), "IfcDuctSegment"),
  b: el("ASR", `0B${n}`.padEnd(22, "b")),
  storey: "2NP",
  center: [1 * n, 2, 3],
  ...over,
});
const TEST = { name: "Potrubie x steny", a: { type: "IfcDuct*", model: "VZT" }, b: { type: "IfcWall*", model: "ASR" }, mode: "hard" as const };

let store: MemoryClashStore;
beforeEach(() => {
  store = memoryClashStore();
});

describe("saveFromViewer (D-164)", () => {
  it("test bez kódu dostane kód z názvu, druhý rovnaký názov `-2`", async () => {
    const one = await saveFromViewer(store, { test: TEST });
    expect(one.test_code).toBe("POTRUBIE-X-STENY");
    const two = await saveFromViewer(store, { test: TEST });
    expect(two.test_code).toBe("POTRUBIE-X-STENY-2");
    expect(store.tests.map((t) => t.origin)).toEqual(["viewer", "viewer"]);
    expect(store.tests[0].rules).toEqual([{ id: "POTRUBIE-X-STENY", a: TEST.a, b: TEST.b }]);
  });

  it("test s kódom prepíše posledným zápisom a zachová pôvod; predvolený sa neprepíše", async () => {
    const mine = await store.upsertTest({ code: "MOJ", name: "Starý", description: null, origin: "chat", created_by: "Claude", rules: [{ id: "MOJ", a: { type: "*" } }], settings: { mode: "hard" } });
    await saveFromViewer(store, { test: { ...TEST, code: "MOJ" } });
    expect(store.tests).toHaveLength(1);
    expect(store.tests[0]).toMatchObject({ id: mine.id, name: "Potrubie x steny", origin: "chat", created_by: "Claude" });
    const def = await saveFromViewer(store, { test: { ...TEST, code: "VZT-NOSNE" } });
    expect(def.notes?.join(" ")).toMatch(/predvolený test/);
    expect(store.tests.some((t) => t.code === "VZT-NOSNE")).toBe(false);
  });

  it("beh: kľúče ako v chate, duplicity preč, trigger viewer, súhrn a bez pokrytia", async () => {
    const dup = row(1);
    const out = await saveFromViewer(store, { test: { ...TEST, code: "MOJ" }, run: { results: [row(1), dup, row(2, { kind: "clearance", severity: "minor", storey: "3NP" })], models: { VZT: "v3" } } });
    expect(out).toMatchObject({ ok: true, test_code: "MOJ", results: 2 });
    expect(out.run_id).toBeTruthy();
    const [run] = store.runRows;
    expect(run).toMatchObject({ trigger: "viewer", test_code: "MOJ", engine: "ifc-lite-viewer", coverage: null, models: { VZT: "v3" } });
    expect(run.completeness).toMatchObject({ coverage_omitted: true });
    expect(run.summary).toMatchObject({ total: 2, by_status: { hard: 1, clearance: 1 }, by_storey: { "2NP": 1, "3NP": 1 } });
    expect((run.rules_snapshot as { spec: { mode: string; tolerance: number } }).spec).toMatchObject({ code: "MOJ", mode: "hard", tolerance: 0.002 });
    const first = store.resultRows.find((r) => r.a_guid === row(1).a.guid)!;
    expect(first.clash_key).toBe(clashReviewKey({ rule: "MOJ", a: { key: `VZT:${row(1).a.guid}` }, b: { key: `ASR:${row(1).b.guid}` } } as never));
    // IFC (x, y, z) -> engine (x, z, -y)
    expect(first.center).toEqual([1, 2, 3]);
    expect(first.point).toEqual([1, 3, -2]);
    expect(out.notes?.join(" ")).toMatch(/nepretestované/);
  });

  it("beh na predvolenom teste založí jeho riadok; ad hoc beh bez testu je chyba", async () => {
    const out = await saveFromViewer(store, { test_code: "VZT-ASR", run: { results: [row(1)] } });
    expect(out.run_id).toBeTruthy();
    expect(store.tests).toMatchObject([{ code: "VZT-ASR", origin: "default" }]);
    await expect(saveFromViewer(store, { run: { results: [row(1)] } })).rejects.toThrow(ClashViewerError);
    await expect(saveFromViewer(store, { test_code: "NIC", run: { results: [row(1)] } })).rejects.toThrow(/v AIM nie je/);
  });

  it("stav kolízie po dvojici prvkov, poznámka sa bez comment nemení", async () => {
    await saveFromViewer(store, { test: { ...TEST, code: "MOJ" } });
    const pair = { a: row(1).a, b: row(1).b };
    const swapped = { a: row(1).b, b: row(1).a };
    const out = await saveFromViewer(store, { test_code: "MOJ", reviews: [{ ...pair, status: "resolved", comment: "hotovo" }, { ...swapped, status: "resolved", comment: "hotovo" }, { a: row(2).a, b: row(2).b, status: "accepted" }] });
    expect(out.reviews).toBe(2);
    expect(store.reviewRows.map((r) => [r.status, r.comment])).toEqual(expect.arrayContaining([["resolved", "hotovo"], ["accepted", null]]));
    await saveFromViewer(store, { test_code: "MOJ", reviews: [{ ...pair, status: "open" }] });
    expect(store.reviewRows.find((r) => r.clash_key === clashKey("MOJ", pair.a, pair.b))).toMatchObject({ status: "open", comment: "hotovo" });
  });

  it("zlý kód testu je chyba", async () => {
    await expect(saveFromViewer(store, { test: { ...TEST, code: "ma ma" } } as ClashSaveWire)).rejects.toThrow(/Kód testu/);
  });
});

describe("loadForViewer (D-164)", () => {
  it("predvolený test bez behu, neznámy test je chyba", async () => {
    const out = await loadForViewer(store, { test: "vzt-asr" });
    expect(out.test).toMatchObject({ code: "VZT-ASR", mode: "clearance", clearance_mm: 50, origin: "default" });
    expect(out.run).toBeUndefined();
    await expect(loadForViewer(store, { test: "NIC" })).rejects.toThrow(/nie je/);
    await expect(loadForViewer(store, { test: "VZT-ASR", run: "latest" })).rejects.toThrow(/nemá uložený beh|ešte nemá/);
  });

  it("beh s kolíziami a stavom z AIM, najzávažnejšie prvé", async () => {
    await saveFromViewer(store, { test: { ...TEST, code: "MOJ" }, run: { results: [row(1, { severity: "minor" }), row(2), row(3, { severity: "critical" })] } });
    await saveFromViewer(store, { test_code: "MOJ", reviews: [{ a: row(2).a, b: row(2).b, status: "resolved", comment: "ok" }] });
    const out = await loadForViewer(store, { test: "MOJ", run: "latest" });
    expect(out.run).toMatchObject({ trigger: "viewer", total: 3 });
    expect(out.results_total).toBe(3);
    expect(out.results?.map((r) => r.severity)).toEqual(["critical", "major", "minor"]);
    expect(out.results?.find((r) => r.a.guid === row(2).a.guid)).toMatchObject({ review: "resolved", comment: "ok" });
    expect(out.results?.find((r) => r.a.guid === row(1).a.guid)).toMatchObject({ review: "open" });
    expect(out.results?.[0].key).toContain("MOJ");
    const byId = await loadForViewer(store, { test: "MOJ", run: store.runRows[0].id });
    expect(byId.results).toHaveLength(3);
  });

  it("cudzí beh nepatrí testu", async () => {
    await saveFromViewer(store, { test: { ...TEST, code: "A1" }, run: { results: [row(1)] } });
    await saveFromViewer(store, { test: { ...TEST, name: "Iný", code: "B1" } });
    await expect(loadForViewer(store, { test: "B1", run: store.runRows[0].id })).rejects.toThrow(/nepatrí/);
  });

  it("zoznam testov s posledným behom", async () => {
    await saveFromViewer(store, { test: { ...TEST, code: "MOJ" }, run: { results: [row(1)] } });
    const items = await listForViewer(store);
    expect(items.map((i) => i.code)).toEqual(["VZT-NOSNE", "VZT-ASR", "MOJ"]);
    expect(items.find((i) => i.code === "MOJ")).toMatchObject({ origin: "viewer", last_run: { total: 1, trigger: "viewer" } });
    expect(items[0].last_run).toBeNull();
  });
});
