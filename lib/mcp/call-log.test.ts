import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { callAction, writeCallLog, type McpCallLogRow } from "./call-log";

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
