import type { ToolDefinition } from "../llm/provider";
import { mcpInstructions } from "../llm/system-prompt";

import type { ToolGroup } from "./tool-list";

/**
 * Načítanie toolov konektora v klientovi (D-153, #237). Claude (aplikácie aj
 * Claude Code) tooly vzdialeného MCP servera často odkladá: na začiatku vidí len
 * mená a inštrukcie, tooly si načíta cez tool_search a v dlhej session (hlas,
 * zhutnenie histórie) ich môže stratiť. Jediná zdokumentovaná oprava je na strane
 * používateľa (Tool access "Always available"); server pomôže tým, čo ide:
 * krátky blok na začiatku inštrukcií a `anthropic/alwaysLoad` na jadrových tooloch.
 */

/** Tooly, ktoré sa majú načítať hneď (Claude Code `_meta["anthropic/alwaysLoad"]`, D-153): malé a najčastejšie. */
export const ALWAYS_LOAD_TOOLS = ["get_object", "search_objects", "show_in_3d", "get_viewer_state", "set_view_mode"] as const;

/** Claude Code orezáva serverové inštrukcie na 4096 znakov; blok musí byť celý pred orezom. */
export const INSTRUCTIONS_CUT = 4096;
/** Strop bloku o načítaní, aby nevytlačil doménové pravidlá z prvých 4096 znakov. */
export const LOADING_BLOCK_MAX = 1000;

const ALWAYS_LOAD_META = { "anthropic/alwaysLoad": true } as const;

export function withAlwaysLoad(tool: ToolDefinition): ToolDefinition {
  return (ALWAYS_LOAD_TOOLS as readonly string[]).includes(tool.name)
    ? { ...tool, meta: { ...tool.meta, ...ALWAYS_LOAD_META } }
    : tool;
}

export function isAlwaysLoaded(tool: ToolDefinition): boolean {
  return tool.meta?.["anthropic/alwaysLoad"] === true;
}

/** Blok na začiatok inštrukcií: pokyn načítať celú sadu naraz a mená toolov po skupinách. */
export function toolLoadingBlock(groups: ToolGroup[]): string {
  const names = groups.map((g) => `${g.group}: ${g.tools.map((t) => t.name).join(", ")}`).join("; ");
  return `Načítanie toolov AIM: ak ich klient sprístupňuje cez tool_search, na začiatku session načítaj celú sadu naraz (všetky mená nižšie, aj viac vyhľadaní za sebou). Keď niektorý tool chýba, znova načítaj celú sadu, nie po jednom; používateľovi to nehlás. Tooly - ${names}.`;
}

/** Celé serverové inštrukcie konektora: blok o načítaní toolov + doménové pravidlá (`mcpInstructions`). */
export function mcpServerInstructions(siteUrl: string, engine: boolean, groups: ToolGroup[]): string {
  return `${toolLoadingBlock(groups)}\n\n${mcpInstructions(siteUrl, engine)}`;
}
