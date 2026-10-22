import { describe, expect, it, vi } from "vitest";

// Moduly toolov sú server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { handleMcpPayload } from "./server";
import { ALWAYS_LOAD_TOOLS, INSTRUCTIONS_CUT, LOADING_BLOCK_MAX, isAlwaysLoaded, mcpServerInstructions, toolLoadingBlock } from "./tool-loading";
import { mcpToolDefinitions, mcpToolGroups } from "./tool-list";

/** Načítanie toolov v klientovi (D-153, #237). */
describe("načítanie toolov konektora (D-153)", () => {
  const groups = mcpToolGroups({ engine: true });
  const tools = mcpToolDefinitions({ engine: true });
  const instructions = mcpServerInstructions("https://aim.test", true, groups);

  it("blok o načítaní je krátky, na začiatku inštrukcií a nesie mená všetkých toolov pred orezom 4096 znakov", () => {
    const block = toolLoadingBlock(groups);
    expect(block.length).toBeLessThanOrEqual(LOADING_BLOCK_MAX);
    expect(instructions.startsWith(block)).toBe(true);
    const head = instructions.slice(0, INSTRUCTIONS_CUT);
    expect(head).toContain("tool_search");
    expect(tools.filter((t) => !head.includes(t.name)).map((t) => t.name)).toEqual([]);
  });

  it("bez motora blok nemenuje tooly motora", () => {
    const block = toolLoadingBlock(mcpToolGroups({ engine: false }));
    expect(block).not.toMatch(/\bifc_|search_all/);
    expect(block).toContain("search_everything");
  });

  it("žiadny opis toolu nepresiahne orez 4096 znakov", () => {
    expect(tools.filter((t) => t.description.length > INSTRUCTIONS_CUT).map((t) => t.name)).toEqual([]);
  });

  it("alwaysLoad majú presne jadrové tooly a tools/list ho pošle ako _meta", async () => {
    expect(tools.filter(isAlwaysLoaded).map((t) => t.name).sort()).toEqual([...ALWAYS_LOAD_TOOLS].sort());
    const res = (await handleMcpPayload(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { serverInfo: { name: "t", version: "1" }, instructions, tools, callTool: async () => ({ text: [], isError: false }) },
    )) as { result: { tools: Array<{ name: string; _meta?: Record<string, unknown> }> } };
    const listed = res.result.tools;
    expect(listed.find((t) => t.name === "get_object")?._meta).toEqual({ "anthropic/alwaysLoad": true });
    expect(listed.find((t) => t.name === "style_in_3d")).not.toHaveProperty("_meta");
    expect(listed.filter((t) => t._meta).length).toBe(ALWAYS_LOAD_TOOLS.length);
  });
});
