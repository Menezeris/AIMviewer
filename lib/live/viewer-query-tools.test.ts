import { afterEach, describe, expect, it, vi } from "vitest";

// Modul je server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import type { queryLiveViewer } from "./query";
import { VIEWER_QUERY_TOOL_DEFINITIONS, execViewerQueryTool, viewerQueryOf } from "./viewer-query-tools";

describe("get_viewer_state s obálkami (D-115)", () => {
  it("bounds alebo cieľ = obálky; inak stav", () => {
    expect(viewerQueryOf({})).toBe("view_state");
    expect(viewerQueryOf({ items_limit: 10 })).toBe("view_state");
    expect(viewerQueryOf({ bounds: true })).toBe("bounds");
    expect(viewerQueryOf({ target_ids_or_refs: ["DD01.02.0004"] })).toBe("bounds");
    expect(viewerQueryOf({ global_ids: ["0EUvFRlAzBAutkeDMKNCHH"] })).toBe("bounds");
  });

  it("v zozname je len get_viewer_state", () => {
    expect(VIEWER_QUERY_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["get_viewer_state"]);
  });
});

describe("get_viewer_state nesie AIM chat lens (#97)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const STATE = { mode: "3d", section: null, hidden_count: 0, isolated_count: null };
  const LENS = { active: false, rules: [], legend: [], matched: 0, isolation: { rules: [{ name: "dokument D.1.3.04", count: 782 }], isolated: 782, xray: true } };

  function fakeQuery(lens: "ok" | "timeout") {
    const asked: string[] = [];
    const fn = (async (_ch: string, query: string) => {
      asked.push(query);
      if (query === "lens_state") {
        return lens === "ok" ? { ok: true, reply: { id: "l", ok: true, result: LENS } } : { ok: false, reason: "timeout" };
      }
      return { ok: true, reply: { id: "s", ok: true, result: query === "bounds" ? { model: {} } : STATE } };
    }) as unknown as typeof queryLiveViewer;
    return { fn, asked };
  }

  it("stav dostane lens: izolácia alebo X-ray z chatu s počtom, bez GUID", async () => {
    vi.stubEnv("LIVE_CHANNEL", "test-channel");
    const { fn, asked } = fakeQuery("ok");
    const res = await execViewerQueryTool("get_viewer_state", {}, "https://x.test", fn);
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toEqual({ ...STATE, lens: LENS });
    expect(asked.sort()).toEqual(["lens_state", "view_state"]);
  });

  it("lens bez odpovede stav nezhodí, kľúč chýba; obálky sa na lens nepýtajú", async () => {
    vi.stubEnv("LIVE_CHANNEL", "test-channel");
    const slow = fakeQuery("timeout");
    expect(JSON.parse((await execViewerQueryTool("get_viewer_state", {}, "https://x.test", slow.fn)).text)).toEqual(STATE);
    const bounds = fakeQuery("ok");
    await execViewerQueryTool("get_viewer_state", { bounds: true }, "https://x.test", bounds.fn);
    expect(bounds.asked).toEqual(["bounds"]);
  });
});
