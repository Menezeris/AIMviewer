import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { callAction, rejectedCallRow, writeCallLog, type McpCallLogRow } from "./call-log";

const row: McpCallLogRow = {
  tool: "style_in_3d",
  action: "isolate",
  ms: 812,
  ok: true,
  cold: false,
  phases: { exec: 120, broadcast: 90, lens: 600 },
  region: "arn1",
};

describe("mcp_call_log (D-100)", () => {
  it("action berie len reťazec args.action", () => {
    expect(callAction({ action: "isolate" })).toBe("isolate");
    expect(callAction({ action: 3 })).toBeNull();
    expect(callAction({})).toBeNull();
  });

  it("zlúčené tooly (D-115): rozlišovač action, mode alebo source", () => {
    expect(callAction({ mode: "count" })).toBe("count");
    expect(callAction({ source: "ifc" })).toBe("ifc");
    expect(callAction({ action: "info", mode: "x" })).toBe("info");
    expect(callAction({ route: "escape", a: "1.01" })).toBe("escape");
  });

  it("odmietnuté volanie (neznámy parameter, D-126) je riadok s ok=false a menami parametrov", () => {
    expect(rejectedCallRow("query_view", ["ifc_type", "offset"], "arn1")).toEqual({
      tool: "query_view",
      action: "unknown_param:ifc_type,offset",
      ms: 0,
      ok: false,
      cold: false,
      phases: {},
      region: "arn1",
    });
    expect(rejectedCallRow("x", ["a".repeat(60)], null).action).toHaveLength(40);
  });

  it("zapíše riadok", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await writeCallLog(row, insert);
    expect(insert).toHaveBeenCalledWith(row);
  });

  it("chyba zápisu (chýbajúca tabuľka, výpadok) tool nezhodí", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(writeCallLog(row, async () => ({ error: { message: "relation does not exist" } }))).resolves.toBeUndefined();
    await expect(
      writeCallLog(row, async () => {
        throw new Error("network");
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
