import { describe, expect, it } from "vitest";

import { SYSTEM_PROMPT, UI_SECTION_MARKER, mcpInstructions } from "./system-prompt";

describe("inštrukcie MCP (D-102)", () => {
  const mcp = mcpInstructions("https://aim.test", true);

  it("odseky o UI akciách z chatu nahradí krátkymi pravidlami MCP, zvyšok promptu ostáva", () => {
    expect(SYSTEM_PROMPT).toContain(UI_SECTION_MARKER);
    expect(mcp).not.toContain(UI_SECTION_MARKER);
    expect(mcp).toContain(SYSTEM_PROMPT.slice(0, SYSTEM_PROMPT.indexOf(UI_SECTION_MARKER)).trimEnd());
    expect(mcp).not.toContain("čistý text bez markdown");
    expect(mcp.length).toBeLessThan(15_000);
  });

  it("nesie pravidlá z merania kola 3: kód ako cieľ, show vs select, výšky, podhľad podlažia", () => {
    for (const rule of ["daj PRIAMO ako cieľ", "= show_in_3d", "select_in_3d(clear=true)", "FinishFloorHeight neodčítaj", "relative_to=ceiling"]) {
      expect(mcp).toContain(rule);
    }
  });
});
