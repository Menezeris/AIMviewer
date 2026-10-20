import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Moduly toolov sú server-only (D-026) - mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { mcpInstructions } from "../llm/system-prompt";

import { definitionChars, firstSentence, inventoryMarkdown } from "./tool-inventory";
import { mcpLegacyToolNames, mcpToolDefinitions, mcpToolGroups } from "./tool-list";
import { BCF_TOOL_NAMES } from "../bcf/tools";
import { ENGINE_TOOL_NAMES } from "../engine/tool-defs";
import { FEEDBACK_TOOL_NAMES } from "../feedback/tools";
import { VIEWER_QUERY_TOOL_NAMES } from "../live/viewer-query-tools";
import { LEGACY_ASK_TOOL_NAMES } from "../llm/tools";
import registry from "./tool-registry.json";

/**
 * Register toolov (D-114): každý tool konektora má v `tool-registry.json`
 * rozhodnutie, ktoré ho zaviedlo. Nový tool bez riadku v registri neprejde,
 * takže pridanie je v review vidieť a odkazuje na záznam s odôvodnením, prečo
 * nestačilo rozšíriť existujúci tool. Pevný strop počtu nie je.
 */

const REGISTRY = registry as Record<string, string>;
const groups = mcpToolGroups({ engine: true });
const tools = mcpToolDefinitions({ engine: true });

describe("register toolov MCP (D-114)", () => {
  it("každý tool konektora je v registri a register nemá navyše nič", () => {
    const listed = tools.map((t) => t.name).sort();
    const missing = listed.filter((n) => !(n in REGISTRY));
    const extra = Object.keys(REGISTRY).filter((n) => !listed.includes(n));
    expect(
      { missing, extra },
      "Nový tool: najprv skús rozšíriť existujúci (MCP-TOOLS.md, AGENTS.md D-114); " +
        "ak naozaj treba nový, pridaj ho do lib/mcp/tool-registry.json s číslom rozhodnutia.",
    ).toEqual({ missing: [], extra: [] });
  });

  it("staré mená zlúčených toolov (D-115) sa nevypisujú, ale motor ich vykoná", () => {
    const legacy = [...mcpLegacyToolNames({ engine: true })];
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.filter((n) => tools.some((t) => t.name === n) || n in REGISTRY)).toEqual([]);
    // Mená DB tools vykoná AskToolRuntime (route na ne padne ako posledná možnosť).
    const executable = new Set([
      ...ENGINE_TOOL_NAMES,
      ...BCF_TOOL_NAMES,
      ...FEEDBACK_TOOL_NAMES,
      ...VIEWER_QUERY_TOOL_NAMES,
      ...LEGACY_ASK_TOOL_NAMES,
      "search_everything",
    ]);
    expect(legacy.filter((n) => !executable.has(n))).toEqual([]);
    expect([...mcpLegacyToolNames({ engine: false })].some((n) => ENGINE_TOOL_NAMES.has(n))).toBe(false);
  });

  it("s motorom search_all nahrádza search_everything v zozname, opisoch aj inštrukciách (D-115)", () => {
    expect(tools.some((t) => t.name === "search_everything")).toBe(false);
    expect(tools.filter((t) => t.description.includes("search_everything")).map((t) => t.name)).toEqual([]);
    expect(mcpInstructions("https://example.test", true)).not.toContain("search_everything");
    expect(mcpToolDefinitions({ engine: false }).some((t) => t.name === "search_everything")).toBe(true);
  });

  it("mená sú jedinečné", () => {
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  it("každé rozhodnutie v registri existuje v DECISIONS.md", () => {
    const decisions = readFileSync(join(process.cwd(), "DECISIONS.md"), "utf8");
    const unknown = [...new Set(Object.values(REGISTRY))].filter(
      (d) => !new RegExp(`^### ${d}\\b`, "m").test(decisions),
    );
    expect(unknown).toEqual([]);
  });

  it("bez motora ostanú len tooly mimo skupiny IFC motor, diagnostika len so spike", () => {
    const base = mcpToolDefinitions({ engine: false }).map((t) => t.name);
    expect(base.some((n) => n.startsWith("ifc_") || n === "search_all")).toBe(false);
    expect(mcpToolDefinitions({ engine: true, spike: true }).at(-1)?.name).toBe("ifc_engine_probe");
  });

  it("MCP-TOOLS.md zodpovedá definíciám toolov", async () => {
    const chars = definitionChars(tools);
    const instructions = mcpInstructions("https://example.test", true).length;
    // Informatívne (D-114): koľko klient načíta pred prvou otázkou; nepadá, len sa vypíše.
    console.info(`MCP: ${tools.length} toolov, definície ${chars} znakov, inštrukcie ${instructions} znakov`);
    await expect(inventoryMarkdown(groups, REGISTRY)).toMatchFileSnapshot("../../MCP-TOOLS.md");
  });
});

describe("inventár", () => {
  it("prvá veta končí bodkou pred veľkým písmenom, nie pri kóde ani skratke", () => {
    const text = "Nájde prvok SD04.0001 podľa kódu (napr. Dvere), napr. VZT jednotku na podlaží. Druhá veta.";
    expect(firstSentence(text)).toBe("Nájde prvok SD04.0001 podľa kódu (napr. Dvere), napr. VZT jednotku na podlaží.");
    expect(firstSentence("ZDROJ: graf AIM. Fulltext nad psetmi. Tretia.")).toBe("ZDROJ: graf AIM. Fulltext nad psetmi. Tretia.");
    expect(firstSentence("Bez bodky")).toBe("Bez bodky");
  });
});
