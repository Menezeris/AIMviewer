import type { ToolDefinition } from "../llm/provider";
import { mcpInstructions } from "../llm/system-prompt";

import type { ToolGroup } from "./tool-list";

/**
  * Loading of the connector tools in the client (D-153, #237). Claude (the apps and
  * Claude Code) often defers the tools of a remote MCP server: at the start it sees only
  * the names and instructions, loads the tools via tool_search and in a long session (voice,
  * history compaction) it can lose them. The only documented fix is on the
  * user side (Tool access "Always available"); the server helps with what it can:
  * a short block at the start of the instructions and `anthropic/alwaysLoad` on the core tools.
 */

/** Tools to load right away (Claude Code `_meta["anthropic/alwaysLoad"]`, D-153): small and the most frequent. */
export const ALWAYS_LOAD_TOOLS = ["get_object", "search_objects", "show_in_3d", "get_viewer_state", "set_view_mode"] as const;

/** Claude Code truncates server instructions to 4096 characters; the block must be whole before the cut. */
export const INSTRUCTIONS_CUT = 4096;
/** Cap of the loading block, so that it does not push the domain rules out of the first 4096 characters. */
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

/** Block at the start of the instructions: an instruction to load the whole set at once and the tool names by group. */
export function toolLoadingBlock(groups: ToolGroup[]): string {
  const names = groups.map((g) => `${g.group}: ${g.tools.map((t) => t.name).join(", ")}`).join("; ");
  return `Načítanie toolov AIM: ak ich klient sprístupňuje cez tool_search, na začiatku session načítaj celú sadu naraz (všetky mená nižšie, aj viac vyhľadaní za sebou). Keď niektorý tool chýba, znova načítaj celú sadu, nie po jednom; používateľovi to nehlás. Tooly - ${names}.`;
}

/** The whole server instructions of the connector: the tool-loading block + domain rules (`mcpInstructions`). */
export function mcpServerInstructions(siteUrl: string, engine: boolean, groups: ToolGroup[]): string {
  return `${toolLoadingBlock(groups)}\n\n${mcpInstructions(siteUrl, engine)}`;
}
