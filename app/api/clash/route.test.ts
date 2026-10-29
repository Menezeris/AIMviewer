import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemoryClashStore } from "@/lib/clash/testing";

let store: MemoryClashStore;
vi.mock("@/lib/clash/store", () => ({ supabaseClashStore: () => store }));

const A = { model: "VZT", guid: "0aaaaaaaaaaaaaaaaaaaaa", type: "IfcDuctSegment" };
const B = { model: "ASR", guid: "0bbbbbbbbbbbbbbbbbbbbb", type: "IfcWall" };
const TEST = { name: "Potrubie x steny", a: { type: "IfcDuct*", model: "VZT" }, b: { type: "IfcWall*", model: "ASR" }, mode: "hard" };
const RUN = { results: [{ kind: "hard", severity: "major", distance: -0.02, a: A, b: B, storey: "2NP", center: [1, 2, 3] }] };

const base = "https://aim.test/api/clash";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(base, { method: "POST", headers: { "content-type": "application/json", host: "aim.test", origin: "https://aim.test", ...headers }, body: JSON.stringify(body) });

/** Nový modul route (brána sa číta pri načítaní) a nové úložisko z tej istej sady modulov. */
async function load(enabled: boolean) {
  vi.resetModules();
  if (enabled) vi.stubEnv("CLASH_WRITE_ENABLED", "true");
  else vi.unstubAllEnvs();
  store = (await import("@/lib/clash/testing")).memoryClashStore();
  return import("./route");
}

describe("/api/clash (D-164)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("zápis je predvolene vypnutý (403), čítanie ide", async () => {
    const route = await load(false);
    const res = await route.POST(post({ test: TEST }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("CLASH_WRITE_ENABLED");
    expect(store.tests).toHaveLength(0);
    const list = await route.GET(new Request(base));
    expect(list.status).toBe(200);
    expect((await list.json()).items.map((i: { code: string }) => i.code)).toEqual(["VZT-NOSNE", "VZT-ASR"]);
  });

  it("cudzí origin je zablokovaný", async () => {
    const route = await load(true);
    expect((await route.POST(post({ test: TEST }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(store.tests).toHaveLength(0);
  });

  it("neplatný JSON a tvar = 400, príliš veľké telo = 413", async () => {
    const route = await load(true);
    expect((await route.POST(new Request(base, { method: "POST", headers: { host: "aim.test", origin: "https://aim.test" }, body: "{" }))).status).toBe(400);
    expect((await route.POST(post({ run: { results: [{ kind: "touch" }] }, test_code: "X" }))).status).toBe(400);
    expect((await route.POST(post({ test: TEST, pad: "x".repeat(4_100_000) }))).status).toBe(413);
  });

  it("uloží test a beh, GET ich vráti s kolíziami; beh pre neznámy test je 400", async () => {
    const route = await load(true);
    const saved = await route.POST(post({ test: TEST, run: RUN }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, test_code: "POTRUBIE-X-STENY", results: 1 });
    expect(store.runRows[0].trigger).toBe("viewer");

    const got = await route.GET(new Request(`${base}?test=POTRUBIE-X-STENY&run=latest`));
    const body = await got.json();
    expect(body).toMatchObject({ test: { code: "POTRUBIE-X-STENY", origin: "viewer" }, run: { total: 1 }, results_total: 1 });
    expect(body.results[0]).toMatchObject({ review: "open", a: { guid: A.guid } });

    const bad = await route.POST(post({ test_code: "NIC", run: RUN }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("v AIM nie je");
  });

  it("GET: neznámy test 404, zlé id behu 400", async () => {
    const route = await load(false);
    expect((await route.GET(new Request(`${base}?test=NIC`))).status).toBe(404);
    expect((await route.GET(new Request(`${base}?test=VZT-ASR&run=run-1`))).status).toBe(400);
  });
});
