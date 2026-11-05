import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemoryIdsStore, MemoryLibraryStore } from "@/lib/ids/testing";

let store: MemoryIdsStore;
let lib: MemoryLibraryStore;
vi.mock("@/lib/ids/store", () => ({ supabaseIdsStore: () => store }));
vi.mock("@/lib/ids/library-store", () => ({ supabaseIdsLibraryStore: () => lib }));
vi.mock("@/lib/engine/aim-lookup", () => ({ lookupGuids: async () => new Map() }));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", host: "aim.test", origin: "https://aim.test", ...headers }, body: JSON.stringify(body) });

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const testing = await import("@/lib/ids/testing");
  store = testing.memoryIdsStore();
  lib = testing.memoryIdsLibraryStore(store);
  return {
    library: await import("./route"),
    models: await import("../models/route"),
    runs: await import("../runs/route"),
  };
}

describe("/api/ids/library, /models, /runs (D-182)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("GET: katalóg z DB bez tokenu a bez GitHubu, projekt", async () => {
    const { library } = await load({});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await library.GET(projectId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(json.library).toMatchObject({ configured: true, items: [], note: expect.stringContaining("origin = library") });
    expect(json.project).toMatchObject({ items: [], containers: [{ model: "ASR" }, { model: "VZT" }], current_revisions: { ASR: 79, VZT: 11 } });
  });

  it("zápisy sú za IDS_WRITE_ENABLED a origin guardom", async () => {
    const { library, models, runs } = await load({});
    expect((await library.POST(post("https://aim.test/api/ids/library", { path: "ids/A.ids", commit: "1".repeat(40), sha256: "x", author: "S" }))).status).toBe(403);
    expect((await models.POST(post("https://aim.test/api/ids/models", { code: "A", model: "ASR", bound: true, author: "S" }))).status).toBe(403);
    expect((await runs.POST(post("https://aim.test/api/ids/runs", {}))).status).toBe(403);

    const on = await load({ IDS_WRITE_ENABLED: "true" });
    expect((await on.models.POST(post("https://aim.test/api/ids/models", { code: "A", model: "ASR", bound: true, author: "S" }, { origin: "https://evil.test" }))).status).toBe(403);
    expect(lib.bindings).toHaveLength(0);
  });

  it("priradenie neznámeho IDS 400, chýbajúce polia 400; väzba na neznáme IDS 400; beh bez polí 400", async () => {
    const { library, models, runs } = await load({ IDS_WRITE_ENABLED: "true" });
    expect((await library.POST(post("https://aim.test/api/ids/library", { path: "ids/A.ids" }))).status).toBe(400);
    const unknown = await library.POST(post("https://aim.test/api/ids/library", { path: "ids/A.ids", commit: "2026.11.1@x", sha256: "x", author: "S" }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("nie je medzi IDS");
    const m = await models.POST(post("https://aim.test/api/ids/models", { code: "NIE", model: "ASR", bound: true, author: "S" }));
    expect(m.status).toBe(400);
    expect((await m.json()).error).toContain("neexistuje");
    expect((await runs.POST(post("https://aim.test/api/ids/runs", { code: "A" }))).status).toBe(400);
  });
});
