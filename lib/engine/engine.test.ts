import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  InMemoryModelRegistry,
  NOOP_PROGRESS,
  SILENT_LOGGER,
  buildDefaultToolRegistry,
  fullScope,
} from "@ifc-lite/mcp";

import { MINI_BUILDING_BYTES, guid } from "./__fixtures__/mini-building";
import { clearEngineCache, getStore, setArchiveResolver } from "./cache";
import { modelFromStore, parseIfcBytes } from "./loader";
import { ENGINE_UPSTREAM_TOOLS, callEngineTool } from "./session";

const SRC = { id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" };

/** Falošné úložisko: `etags[n]` je verzia súboru po n stiahnutiach (HEAD hlási nasledujúcu). */
function fakeFetch(etags: string[]) {
  let gets = 0;
  let heads = 0;
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const etag = etags[Math.min(gets, etags.length - 1)];
    if (init?.method === "HEAD") {
      heads++;
      return new Response(null, { status: 200, headers: { etag } });
    }
    gets++;
    return new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag } });
  });
  return { impl: impl as unknown as typeof fetch, counts: () => ({ gets, heads }) };
}

describe("IFC motor - cache (D-084)", () => {
  afterEach(() => clearEngineCache());

  it("súbežné požiadavky čakajú na jedno načítanie a teplé volanie nesťahuje", async () => {
    const f = fakeFetch(['"v1"']);
    const [a, b] = await Promise.all([getStore(SRC, { fetchImpl: f.impl }), getStore(SRC, { fetchImpl: f.impl })]);
    expect(a.entry).toBe(b.entry);
    expect(f.counts().gets).toBe(1);
    const warm = await getStore(SRC, { fetchImpl: f.impl });
    expect(warm.cold).toBe(false);
    expect(f.counts()).toEqual({ gets: 1, heads: 0 });
  });

  it("po okne revalidácie overí ETag a pri zmene model načíta znova", async () => {
    let t = 1_000;
    const now = () => t;
    const f = fakeFetch(['"v1"', '"v2"']);
    const first = await getStore(SRC, { fetchImpl: f.impl, now });
    t += 61_000;
    const second = await getStore(SRC, { fetchImpl: f.impl, now });
    expect(f.counts().heads).toBe(1);
    expect(second.cold).toBe(true);
    expect(second.entry).not.toBe(first.entry);
    expect(second.entry.etag).toBe('"v2"');
  });

  it("nezmenený ETag po revalidácii ponechá model v cache", async () => {
    let t = 1_000;
    const f = fakeFetch(['"v1"']);
    const first = await getStore(SRC, { fetchImpl: f.impl, now: () => t });
    t += 61_000;
    const again = await getStore(SRC, { fetchImpl: f.impl, now: () => t });
    expect(again.cold).toBe(false);
    expect(again.entry).toBe(first.entry);
    expect(f.counts().gets).toBe(1);
  });
});

describe("IFC motor - archív revízie (D-135)", () => {
  afterEach(() => {
    clearEngineCache();
    setArchiveResolver(null);
  });
  const ARCHIVE = "https://example.test/archive/mini/v007.ifc.gz";

  /** Úložisko s gzip archívom a pôvodným súborom; zaznamená, čo sa sťahovalo. */
  function storage(opts: { archiveStatus?: number } = {}) {
    const calls: string[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { etag: '"cur"' } });
      if (u === ARCHIVE) {
        if (opts.archiveStatus) return new Response("x", { status: opts.archiveStatus });
        return new Response(gzipSync(MINI_BUILDING_BYTES), { status: 200, headers: { etag: '"gz"' } });
      }
      return new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"cur"' } });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it("stiahne a rozbalí archív, ETag berie z HEAD pôvodnej URL, celý súbor nesťahuje", async () => {
    const s = storage();
    const res = await getStore(SRC, { fetchImpl: s.impl, archive: async () => ARCHIVE });
    expect(s.calls).toEqual([`HEAD ${SRC.url}`, `GET ${ARCHIVE}`]);
    expect(res.entry.etag).toBe('"cur"');
    expect(res.entry.size).toBe(MINI_BUILDING_BYTES.byteLength);
    expect(res.entry.store.entities.getExpressIdByGlobalId(guid("WALA"))).toBeGreaterThan(0);
  });

  it("ETag číta pred revíziou z DB (publikácia medzi nimi nenechá nový ETag pri starej revízii)", async () => {
    const order: string[] = [];
    const s = storage();
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      order.push(init?.method === "HEAD" ? "head" : "get");
      return s.impl(url, init);
    }) as typeof fetch;
    await getStore(SRC, { fetchImpl: impl, archive: async () => { order.push("revision"); return ARCHIVE; } });
    expect(order).toEqual(["head", "revision", "get"]);
  });

  it("zaregistrovaný resolver platí bez deps; bez revízie ide pôvodná URL", async () => {
    setArchiveResolver(async () => null);
    const s = storage();
    await getStore(SRC, { fetchImpl: s.impl });
    expect(s.calls).toEqual([`HEAD ${SRC.url}`, `GET ${SRC.url}`]);
  });

  it("chybný archív alebo resolver = pôvodná URL", async () => {
    const s = storage({ archiveStatus: 404 });
    await getStore(SRC, { fetchImpl: s.impl, archive: async () => ARCHIVE });
    expect(s.calls.at(-1)).toBe(`GET ${SRC.url}`);
    clearEngineCache();
    const t = storage();
    await getStore(SRC, { fetchImpl: t.impl, archive: async () => { throw new Error("db"); } });
    expect(t.calls).toEqual([`HEAD ${SRC.url}`, `GET ${SRC.url}`]);
  });
});

describe("IFC motor - volanie toolov (D-084)", () => {
  it("číselný filter cez upstream query_entities", async () => {
    const store = await parseIfcBytes(MINI_BUILDING_BYTES, "mini.ifc");
    const res = await callEngineTool([{ id: "MINI", name: "mini.ifc", store }], "query_entities", {
      model_id: "MINI",
      type: "IfcSpace",
      selector: "Qto_SpaceBaseQuantities.NetFloorArea>20",
    });
    const sc = res.structuredContent as { count: number; entities: Array<{ globalId: string }> };
    expect(res.isError).not.toBe(true);
    expect(sc.count).toBe(2);
    expect(sc.entities.map((e) => e.globalId).sort()).toEqual([guid("SPA"), guid("SPC")].sort());
  });

  it("úprava na jednom backende sa neprejaví v ďalšom volaní nad tým istým storeom", async () => {
    const store = await parseIfcBytes(MINI_BUILDING_BYTES, "mini.ifc");
    const reg = new InMemoryModelRegistry();
    reg.add(modelFromStore(store, "mini.ifc", "MINI"));
    const ctx = {
      registry: reg,
      scope: fullScope(),
      progress: NOOP_PROGRESS,
      log: SILENT_LOGGER,
      signal: new AbortController().signal,
      config: DEFAULT_CONFIG,
    };
    const set = await buildDefaultToolRegistry()
      .get("entity_set_property")!
      .handler({ model_id: "MINI", global_id: guid("WALA"), pset: "AIM_Test", name: "Marker", value: "A" }, ctx as never);
    expect((set as { isError?: boolean }).isError).not.toBe(true);

    const fresh = await callEngineTool([{ id: "MINI", name: "mini.ifc", store }], "get_entity", {
      model_id: "MINI",
      global_id: guid("WALA"),
      include: ["properties"],
    });
    expect(JSON.stringify(fresh.structuredContent)).not.toContain("AIM_Test");
  });

  it("motor ponúka len tools na čítanie (zápis patrí do fázy 3, D-086)", async () => {
    const all = buildDefaultToolRegistry();
    for (const name of ENGINE_UPSTREAM_TOOLS) {
      expect(["read", "validate"]).toContain(all.get(name)?.scope);
    }
  });
});
