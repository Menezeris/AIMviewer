import { describe, expect, it } from "vitest";

import { parseVerifyRequest, runVerifyRequest } from "./viewer-verify";

const G = "2V$Space0000000000001a";

function harness(responses: Record<string, { status?: number; body: unknown } | (() => Promise<Response>)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const posted: Array<Record<string, unknown>> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[url.split("?")[0]];
    if (typeof r === "function") return r();
    return new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, posted, deps: { fetch: f, post: (m: Record<string, unknown>) => posted.push(m), runAll: { busy: false } } };
}

describe("most overenia výmer (D-185 UI)", () => {
  it("parse: len VERIFY_REQUEST so známou akciou", () => {
    expect(parseVerifyRequest({ type: "VERIFY_REQUEST", id: "1", action: "latest", payload: { global_id: G } })).toEqual({ id: "1", action: "latest", payload: { global_id: G } });
    expect(parseVerifyRequest({ type: "VERIFY_REQUEST", id: "1", action: "delete", payload: {} })).toBeNull();
    expect(parseVerifyRequest({ type: "REQLIB_REQUEST", id: "1", action: "latest" })).toBeNull();
    expect(parseVerifyRequest({ type: "VERIFY_REQUEST", id: "", action: "latest" })).toBeNull();
  });

  it("latest a run volajú route a odpovedia VERIFY_RESULT s tým istým id", async () => {
    const h = harness({ "/api/verify/latest": { body: { data: null } }, "/api/verify/run": { body: { data: { version: 1, global_id: G } } } });
    await runVerifyRequest({ id: "a", action: "latest", payload: { global_id: G } }, h.deps);
    await runVerifyRequest({ id: "b", action: "run", payload: { global_id: G } }, h.deps);
    expect(h.calls[0].url).toBe(`/api/verify/latest?global_id=${encodeURIComponent(G)}`);
    expect(JSON.parse(String(h.calls[1].init?.body))).toEqual({ global_id: G });
    expect(h.posted).toEqual([
      { type: "VERIFY_RESULT", id: "a", ok: true, data: null },
      { type: "VERIFY_RESULT", id: "b", ok: true, data: { version: 1, global_id: G } },
    ]);
  });

  it("chyba servera aj neplatný GUID = ok:false s textom pre používateľa", async () => {
    const h = harness({ "/api/verify/run": { status: 500, body: { error: "motor zlyhal" } } });
    await runVerifyRequest({ id: "a", action: "run", payload: { global_id: G } }, h.deps);
    await runVerifyRequest({ id: "b", action: "latest", payload: { global_id: "x' or 1=1" } }, h.deps);
    expect(h.posted).toEqual([
      { type: "VERIFY_RESULT", id: "a", ok: false, error: "motor zlyhal" },
      { type: "VERIFY_RESULT", id: "b", ok: false, error: "Prvok nemá platné IFC GlobalId." },
    ]);
    expect(h.calls).toHaveLength(1);
  });

  it("run_all: druhý súbežný beh z tej istej karty sa odmietne bez volania servera", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness({
      "/api/verify/run_all": async () => {
        await gate;
        return new Response(JSON.stringify({ data: { check: "space_quantities", elements: 83, counts: { green: 1, yellow: 0, red: 0, grey: 0 } } }));
      },
    });
    const first = runVerifyRequest({ id: "a", action: "run_all", payload: { check: "space_quantities" } }, h.deps);
    await runVerifyRequest({ id: "b", action: "run_all", payload: { check: "space_quantities" } }, h.deps);
    expect(h.posted).toEqual([{ type: "VERIFY_RESULT", id: "b", ok: false, error: "overenie už beží" }]);
    release();
    await first;
    expect(h.posted[1]).toMatchObject({ id: "a", ok: true, data: { elements: 83 } });
    expect(h.deps.runAll.busy).toBe(false);
    expect(h.calls).toHaveLength(1);
  });
});
