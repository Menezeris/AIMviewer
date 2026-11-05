import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { memoryViewStore, wireView } from "@/lib/views/testing";

const store = memoryViewStore();
vi.mock("@/lib/views/store", () => ({
  supabaseSavedViewStore: () => store,
  currentModelRevisions: async () => ({ ASR: 7 }),
}));

const ID = "5b5a6f0e-2b7b-4a53-8d3e-7a1f6c2d9e01";
const url = "https://aim.test/api/saved-views";
const json = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", host: "aim.test", ...headers }, body: JSON.stringify(body) });

async function load(enabled: boolean) {
  vi.resetModules();
  if (enabled) vi.stubEnv("VIEWS_WRITE_ENABLED", "true");
  else vi.unstubAllEnvs();
  return import("./route");
}

describe("/api/saved-views (D-161)", () => {
  beforeEach(() => {
    store.rows.splice(0);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("zápis je predvolene vypnutý (403), čítanie ide", async () => {
    const route = await load(false);
    expect((await route.POST(json("POST", { view: wireView() }))).status).toBe(403);
    expect((await route.PATCH(json("PATCH", { id: ID, name: "X" }))).status).toBe(403);
    expect((await route.DELETE(json("DELETE", { id: ID }))).status).toBe(403);
    expect(store.rows).toHaveLength(0);
    const get = await route.GET();
    expect(get.status).toBe(200);
    expect((await get.json()).views).toEqual([]);
  });

  it("cudzí origin je zablokovaný", async () => {
    const route = await load(true);
    const res = await route.POST(json("POST", { view: wireView() }, { origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(store.rows).toHaveLength(0);
  });

  it("POST uloží pohľad a vráti úplný zoznam; kolízia mena dostane príponu", async () => {
    const route = await load(true);
    const first = await route.POST(json("POST", { view: wireView({ name: "A" }) }, { origin: "https://aim.test" }));
    expect(first.status).toBe(200);
    expect((await first.json()).views.map((v: { name: string }) => v.name)).toEqual(["A"]);
    const second = await route.POST(json("POST", { view: wireView({ id: "7c1d2e3f-0000-4000-8000-00000000abcd", name: "a", order: 1 }) }));
    const body = await second.json();
    expect(body).toMatchObject({ ok: true, name: "a 2", renamed: true });
    expect(body.views.map((v: { name: string }) => v.name)).toEqual(["A", "a 2"]);
    expect(store.rows.every((r) => r.author === "viewer")).toBe(true);
  });

  it("PATCH premenuje, DELETE zmaže", async () => {
    const route = await load(true);
    await route.POST(json("POST", { view: wireView({ id: ID, name: "A" }) }));
    const renamed = await (await route.PATCH(json("PATCH", { id: ID, name: "B" }))).json();
    expect(renamed.views[0].name).toBe("B");
    const deleted = await (await route.DELETE(json("DELETE", { id: ID }))).json();
    expect(deleted.views).toEqual([]);
  });

  it("neplatné telá sú 400", async () => {
    const route = await load(true);
    expect((await route.POST(json("POST", { view: { id: ID } }))).status).toBe(400);
    expect((await route.POST(json("POST", { view: wireView({ id: "nie-uuid" }) }))).status).toBe(400);
    expect((await route.PATCH(json("PATCH", { id: ID, name: "" }))).status).toBe(400);
    expect((await route.DELETE(json("DELETE", { id: "x" }))).status).toBe(400);
    const bad = new Request(url, { method: "POST", headers: { host: "aim.test" }, body: "{nie json" });
    expect((await route.POST(bad)).status).toBe(400);
  });
});
