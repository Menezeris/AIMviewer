import { describe, expect, it, vi } from "vitest";

import {
  handleMcpPayload,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  payloadMethods,
  type McpServerDeps,
} from "./server";

function deps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  return {
    serverInfo: { name: "aim-viewer", version: "1.0.0" },
    instructions: "Pokyny",
    tools: [
      {
        name: "count_objects",
        description: "Počet objektov",
        inputSchema: { type: "object", properties: { ifc_type: { type: "string" } } },
      },
    ],
    callTool: vi.fn(async () => ({ text: ['{"count":97}'], isError: false })),
    ...overrides,
  };
}

describe("MCP server (D-079)", () => {
  it("initialize vráti verziu klienta, ak ju pozná, a inštrukcie", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      deps(),
    );
    expect(res).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aim-viewer" },
        instructions: "Pokyny",
      },
    });
  });

  it("neznáma verzia protokolu dostane našu predvolenú", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      deps(),
    );
    expect(res).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("notifikácia nedostane odpoveď", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      deps(),
    );
    expect(res).toBeNull();
  });

  it("tools/list vystaví tools so schémou a read-only anotáciou", async () => {
    const res = await handleMcpPayload({ jsonrpc: "2.0", id: "a", method: "tools/list" }, deps());
    expect(res).toMatchObject({
      id: "a",
      result: {
        tools: [
          {
            name: "count_objects",
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true },
          },
        ],
      },
    });
  });

  it("tools/list prevezme vlastné anotácie toolu (zápis, D-084)", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: "w", method: "tools/list" },
      deps({
        tools: [
          {
            name: "ifc_commit_changes",
            description: "zápis",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
        ],
      }),
    );
    expect(res).toMatchObject({
      result: { tools: [{ annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }] },
    });
  });

  it("tools/call vykoná tool a vráti textové bloky", async () => {
    const d = deps();
    const res = await handleMcpPayload(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "count_objects", arguments: { ifc_type: "IfcDoor" } },
      },
      d,
    );
    expect(d.callTool).toHaveBeenCalledWith("count_objects", { ifc_type: "IfcDoor" });
    expect(res).toMatchObject({
      id: 2,
      result: { content: [{ type: "text", text: '{"count":97}' }], isError: false },
    });
  });

  it("neznámy tool je chyba parametrov, nie pád", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "drop_table" } },
      deps(),
    );
    expect(res).toMatchObject({ id: 3, error: { code: INVALID_PARAMS } });
  });

  it("výnimka toolu je výsledok s isError", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "count_objects" } },
      deps({ callTool: async () => { throw new Error("DB nedostupná"); } }),
    );
    expect(res).toMatchObject({ result: { isError: true } });
  });

  it("neznáma metóda vráti method not found", async () => {
    const res = await handleMcpPayload(
      { jsonrpc: "2.0", id: 5, method: "resources/list" },
      deps(),
    );
    expect(res).toMatchObject({ id: 5, error: { code: METHOD_NOT_FOUND } });
  });

  it("dávka vráti odpovede len na požiadavky", async () => {
    const res = await handleMcpPayload(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 6, method: "ping" },
      ],
      deps(),
    );
    expect(res).toEqual([{ jsonrpc: "2.0", id: 6, result: {} }]);
  });

  it("payloadMethods: metódy zo správy aj z dávky (D-100)", () => {
    expect(payloadMethods({ jsonrpc: "2.0", id: 1, method: "initialize" })).toEqual(["initialize"]);
    expect(payloadMethods([{ method: "tools/list" }, { id: 2 }, { method: "ping" }])).toEqual(["tools/list", "ping"]);
    expect(payloadMethods("x")).toEqual([]);
  });

  it("staré meno zlúčeného toolu sa vykoná, ale v tools/list nie je (D-115)", async () => {
    const d = deps({ legacyTools: new Set(["ifc_count"]) });
    const list = await handleMcpPayload({ jsonrpc: "2.0", id: 1, method: "tools/list" }, d);
    expect(JSON.stringify(list)).not.toContain("ifc_count");
    const call = await handleMcpPayload(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ifc_count", arguments: {} } },
      d,
    );
    expect(JSON.stringify(call)).toContain("97");
    expect(d.callTool).toHaveBeenCalledWith("ifc_count", {});
  });
});
