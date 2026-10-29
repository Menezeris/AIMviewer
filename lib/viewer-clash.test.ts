import { describe, expect, it } from "vitest";

import { parseOps } from "./viewer-ops";
import { clashLoadMessage, clashOpenOp, clashSavedMessage, MAX_SAVE_RESULTS, parseClashOp, parseClashSave, parseClashTest } from "./viewer-clash";

const A = { model: "VZT", guid: "0aaaaaaaaaaaaaaaaaaaaa", type: "IfcDuctSegment" };
const B = { model: "ASR", guid: "0bbbbbbbbbbbbbbbbbbbbb", name: "Stena" };
const TEST = { name: "VZT x ASR", a: { type: "*", model: "VZT" }, b: { type: "!IfcSpace", model: "ASR" }, mode: "clearance", clearance_mm: 50 };
const row = { kind: "hard", severity: "major", distance: -0.02, a: A, b: B, storey: "2NP", center: [1, 2, 3] };

const opArg = (op: string) => op.slice("clash_open::".length);

describe("clash_open (D-164)", () => {
  it("op prejde tam a späť, run je UUID alebo latest", () => {
    expect(parseClashOp(opArg(clashOpenOp({ test: "VZT-ASR" })))).toEqual({ op: "clash_open", test: "VZT-ASR" });
    expect(parseClashOp(opArg(clashOpenOp({ test: "VZT-ASR", run: "latest" })))).toMatchObject({ run: "latest" });
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(parseClashOp(opArg(clashOpenOp({ test: "X", run: uuid })))).toMatchObject({ run: uuid });
  });

  it("op sa vráti z URL parametra ops", () => {
    expect(parseOps(clashOpenOp({ test: "VZT-ASR", run: "latest" }))).toEqual([{ op: "clash_open", test: "VZT-ASR", run: "latest" }]);
    expect(parseOps("clash_open::***")).toEqual([]);
  });

  it("neplatný op sa preskočí", () => {
    expect(parseClashOp("")).toBeNull();
    expect(parseClashOp("%%%")).toBeNull();
    expect(parseClashOp(opArg(clashOpenOp({ test: "" })))).toBeNull();
    expect(parseClashOp(opArg(clashOpenOp({ test: "X", run: "run-3" })))).toBeNull();
  });
});

describe("CLASH_SAVE (D-164)", () => {
  it("test: clearance chce odstup, strana chce selektor", () => {
    expect(parseClashTest(TEST)).toMatchObject({ mode: "clearance", clearance_mm: 50 });
    expect(parseClashTest({ ...TEST, clearance_mm: undefined })).toBeNull();
    expect(parseClashTest({ ...TEST, a: { model: "VZT" } })).toBeNull();
    expect(parseClashTest({ ...TEST, mode: "touch" })).toBeNull();
    expect(parseClashTest({ ...TEST, tolerance_mm: -1 })).toBeNull();
  });

  it("prijme test, beh a stavy; ignoruje cudzie polia", () => {
    const save = parseClashSave({ test: { ...TEST, code: "MOJ", extra: 1 }, run: { results: [row], models: { VZT: "v3" } }, reviews: [{ a: A, b: B, status: "resolved", comment: "hotovo" }], evil: true });
    expect(save?.test).toEqual({ code: "MOJ", name: "VZT x ASR", a: { type: "*", model: "VZT" }, b: { type: "!IfcSpace", model: "ASR" }, mode: "clearance", clearance_mm: 50 });
    expect(save?.run?.results).toHaveLength(1);
    expect(save?.reviews?.[0]).toMatchObject({ status: "resolved", comment: "hotovo" });
    expect(save).not.toHaveProperty("evil");
  });

  it("zlý riadok, veľký beh alebo prázdna správa = neplatné", () => {
    expect(parseClashSave({})).toBeNull();
    expect(parseClashSave(null)).toBeNull();
    expect(parseClashSave({ run: { results: [{ ...row, kind: "touch" }] }, test_code: "MOJ" })).toBeNull();
    expect(parseClashSave({ run: { results: [row, { ...row, a: { model: "VZT" } }] }, test_code: "MOJ" })).toBeNull();
    expect(parseClashSave({ test_code: "MOJ", run: { results: new Array(MAX_SAVE_RESULTS + 1).fill(row) } })).toBeNull();
    expect(parseClashSave({ test_code: "MOJ", reviews: [{ a: A, b: B, status: "hotovo" }] })).toBeNull();
  });
});

describe("správy do viewera", () => {
  it("CLASH_SAVED a CLASH_LOAD", () => {
    expect(clashSavedMessage({ ok: true, test_code: "MOJ", run_id: "r1", results: 2 })).toEqual({ type: "CLASH_SAVED", ok: true, test_code: "MOJ", run_id: "r1", results: 2 });
    expect(clashSavedMessage({ ok: false, error: "x".repeat(5000) }).error).toHaveLength(2000);
    const msg = clashLoadMessage({ test: { ...(parseClashTest(TEST) as object), code: "MOJ", origin: "chat" } as never, results: [], results_total: 5, results_truncated: true });
    expect(msg).toMatchObject({ type: "CLASH_LOAD", results: [], results_total: 5, results_truncated: true });
    expect(clashLoadMessage({ test: { code: "MOJ" } as never })).not.toHaveProperty("results");
  });
});
