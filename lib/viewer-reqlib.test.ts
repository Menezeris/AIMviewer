import { describe, expect, it } from "vitest";

import type { IfcModel } from "./data/ifc-models";
import { parseReqlibRequest, resolveRunModel, runReqlibRequest } from "./viewer-reqlib";

const MODELS: IfcModel[] = [
  { id: "asr", label: "ASR", url: "https://x.test/storage/v1/object/public/ifc/archive/ASR/v079.ifc.gz", revision: 79 },
  { id: "vzt", label: "VZT", url: "https://x.test/storage/v1/object/public/ifc/VZT.ifc?rev=11", revision: 11 },
];

function harness(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const posted: Array<Record<string, unknown>> = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const key = Object.keys(responses).find((k) => url.startsWith(k.split(" ")[1]) && (init?.method ?? "GET") === k.split(" ")[0]);
    const r = key ? responses[key] : { status: 404, body: { error: "nie" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { calls, posted, deps: { fetch: fake, models: MODELS, post: (m: Record<string, unknown>) => posted.push(m) } };
}

describe("most knižnice požiadaviek (D-182)", () => {
  it("žiadosť z viewera: len známe akcie", () => {
    expect(parseReqlibRequest({ type: "REQLIB_REQUEST", id: "r1", action: "catalog" })).toEqual({ id: "r1", action: "catalog", payload: {} });
    expect(parseReqlibRequest({ type: "REQLIB_REQUEST", id: "r1", action: "drop" })).toBeNull();
    expect(parseReqlibRequest({ type: "REQLIB_REQUEST", id: "", action: "catalog" })).toBeNull();
  });

  it("model behu: súbor z URL (aj archív), kľúč a revízia, ktorú viewer načítal; nejasné nič", () => {
    expect(resolveRunModel(MODELS, { model_name: "v079.ifc.gz" })).toEqual({ model: "ASR", revision: 79 });
    expect(resolveRunModel(MODELS, { model_name: "VZT.ifc" })).toEqual({ model: "VZT", revision: 11 });
    expect(resolveRunModel(MODELS, { model_id: "x", model_name: "ASR" })).toEqual({ model: "ASR", revision: 79 });
    expect(resolveRunModel(MODELS, { model_name: "iny.ifc" })).toBeNull();
    const twins: IfcModel[] = [MODELS[0], { ...MODELS[0], id: "b", label: "B", url: "https://x.test/ifc/archive/B/v079.ifc.gz" }];
    expect(resolveRunModel(twins, { model_name: "v079.ifc.gz" })).toBeNull();
    // D-190: a model from the DB is named by its code even when the file is named by the container uuid
    const uuidModel: IfcModel = { id: "ARCH", label: "ARCH", url: "https://x.test/ifc/archive/c-1/v003.ifc.gz", revision: 3, containerId: "c-1" };
    expect(resolveRunModel([uuidModel], { model_name: "v003.ifc.gz" })).toEqual({ model: "ARCH", revision: 3 });
  });

  it("save_run: jeden POST na model s revíziou z hosta; neznámy model nič neuloží", async () => {
    const h = harness({ "POST /api/ids/runs": { body: { ok: true, run_id: "run-1" } } });
    const payload = {
      code: "ER-0101_ARCH", version: 2, ids_sha256: "h", engine_version: "@ifc-lite/ids 3.4.2", author: "Samuel",
      runs: [{ model_id: "m1", model_name: "v079.ifc.gz", specs: [{ specification: { name: "S" }, status: "pass", entityResults: [] }] }],
    };
    await runReqlibRequest({ id: "r1", action: "save_run", payload }, h.deps);
    expect(h.calls).toEqual([{ url: "/api/ids/runs", method: "POST", body: expect.objectContaining({ model: "ASR", revision: 79, code: "ER-0101_ARCH", version: 2, author: "Samuel" }) }]);
    expect(h.posted).toEqual([{ type: "REQLIB_RESULT", id: "r1", ok: true, data: { saved: [{ model: "ASR", revision: 79, run_id: "run-1" }] } }]);

    const bad = harness({});
    await runReqlibRequest({ id: "r2", action: "save_run", payload: { ...payload, runs: [{ model_name: "cudzi.ifc", specs: [] }] } }, bad.deps);
    expect(bad.calls).toHaveLength(0);
    expect(bad.posted[0]).toMatchObject({ type: "REQLIB_RESULT", id: "r2", ok: false, error: expect.stringContaining("cudzi.ifc") });
  });

  it("open pošle IDS_LOAD s pôvodom; chyba route sa vráti karte", async () => {
    const h = harness({ "GET /api/ids?code=": { body: { code: "ER-0101_ARCH", version: 1, title: "T", xml: "<ids/>", origin: "library", library_commit: "c1" } } });
    await runReqlibRequest({ id: "r3", action: "open", payload: { code: "ER-0101_ARCH", version: 1, target: "studio" } }, h.deps);
    expect(h.posted[0]).toEqual({ type: "IDS_LOAD", code: "ER-0101_ARCH", version: 1, title: "T", xml: "<ids/>", target: "studio", origin: "library", library_commit: "c1" });
    expect(h.posted[1]).toMatchObject({ type: "REQLIB_RESULT", id: "r3", ok: true });

    const e = harness({ "POST /api/ids/library": { status: 403, body: { error: "ukladanie IDS z viewera je vypnuté (IDS_WRITE_ENABLED)" } } });
    await runReqlibRequest({ id: "r4", action: "assign", payload: { path: "ids/A.ids" } }, e.deps);
    expect(e.posted).toEqual([{ type: "REQLIB_RESULT", id: "r4", ok: false, error: "ukladanie IDS z viewera je vypnuté (IDS_WRITE_ENABLED)" }]);
  });
});
