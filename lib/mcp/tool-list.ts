import { BCF_TOOL_DEFINITIONS } from "../bcf/tools";
import { PROBE_TOOL } from "../engine/probe-def";
import { SEARCH_ALL_TOOL } from "../engine/search-all";
import { CALIBRATE_UNDERLAY_TOOL } from "../engine/underlay-tool-def";
import { engineToolDefinitions } from "../engine/tool-defs";
import { FEEDBACK_TOOL_DEFINITIONS } from "../feedback/tools";
import { IDS_TOOL_DEFINITIONS } from "../ids/tool-defs";
import { VIEWER_QUERY_TOOL_DEFINITIONS } from "../live/viewer-query-tools";
import type { ToolDefinition } from "../llm/provider";
import { withSearchAll } from "../llm/system-prompt";
import { TOOL_DEFINITIONS } from "../llm/tools";
import { SAVED_VIEW_TOOL_DEFINITIONS } from "../views/tools";

import { withAlwaysLoad } from "./tool-loading";

/**
 * Zoznam toolov MCP konektora na jednom mieste (D-114): číta ho route, register
 * toolov (`tool-registry.test.ts`) aj generovaný inventár `MCP-TOOLS.md`, v ktorom
 * session hľadá, či schopnosť už niektorý tool nemá, skôr ako navrhne nový.
 */

export interface ToolGroup {
  /** Skupina v inventári. */
  group: string;
  /** Odkiaľ tool berie dáta alebo kam pôsobí. */
  source: string;
  /** Kde sú definície (pre session, ktorá tool rozširuje). */
  file: string;
  /** Len v MCP konektore, nie v `/api/ask`. */
  mcpOnly: boolean;
  tools: ToolDefinition[];
}

export interface ToolListOptions {
  /** `ENGINE_ENABLED=1`: `search_all` a `ifc_*` tools IFC motora (D-084). */
  engine: boolean;
  /** `ENGINE_SPIKE=1`: diagnostika motora (D-084 fáza 0), mimo registra. */
  spike?: boolean;
}

export function mcpToolGroups({ engine }: ToolListOptions): ToolGroup[] {
  const groups: ToolGroup[] = [
    {
      group: "AIM graf, pohľad a navigácia",
      source: "DB (AIM graf) -> živý viewer",
      file: "lib/llm/tools.ts, lib/llm/view-tools.ts, lib/llm/list-tool.ts",
      mcpOnly: false,
      // D-115: s motorom search_all nahrádza search_everything (hľadá v grafe AIM aj v IFC súbore).
      tools: engine
        ? TOOL_DEFINITIONS.filter((t) => t.name !== "search_everything").map((t) => ({ ...t, description: withSearchAll(t.description) }))
        : TOOL_DEFINITIONS,
    },
    {
      group: "Dotazy na stav viewera",
      source: "živý viewer (spätný kanál)",
      file: "lib/live/viewer-query-tools.ts",
      mcpOnly: true,
      tools: VIEWER_QUERY_TOOL_DEFINITIONS,
    },
    {
      group: "Uložené pohľady",
      source: "DB (saved_views) + živý viewer",
      file: "lib/views/tools.ts (zoznam v get_viewer_state, obnova v set_view_mode)",
      mcpOnly: true,
      tools: SAVED_VIEW_TOOL_DEFINITIONS,
    },
    {
      group: "BCF témy nad modelmi",
      source: "DB (model_tasks) + session",
      file: "lib/bcf/tools.ts",
      mcpOnly: true,
      tools: BCF_TOOL_DEFINITIONS,
    },
    {
      group: "Pripomienky a požiadavky",
      source: "GitHub issues + session",
      file: "lib/feedback/tools.ts",
      mcpOnly: true,
      tools: FEEDBACK_TOOL_DEFINITIONS,
    },
    {
      group: "IDS dokumenty",
      source: "DB (ids_documents, verzie s XML) + @ifc-lite/mcp (ids_*)",
      file: "lib/ids/tool-defs.ts, lib/ids/tools.ts",
      mcpOnly: true,
      tools: IDS_TOOL_DEFINITIONS,
    },
  ];
  if (engine) {
    groups.push({
      group: "IFC motor",
      source: "IFC súbory federácie (@ifc-lite/mcp); clash ukladá testy, behy a stav kolízií do DB (clash_*)",
      file: "lib/engine/search-all.ts, lib/engine/tool-defs.ts, lib/engine/passthrough-defs.ts, lib/engine/underlay-tool.ts",
      mcpOnly: true,
      tools: [SEARCH_ALL_TOOL, ...engineToolDefinitions(), CALIBRATE_UNDERLAY_TOOL],
    });
  }
  // D-153: jadrové tooly s `anthropic/alwaysLoad`, aby ich klient nemusel hľadať cez tool_search.
  return groups.map((g) => ({ ...g, tools: g.tools.map(withAlwaysLoad) }));
}

export function mcpToolDefinitions(opts: ToolListOptions): ToolDefinition[] {
  return [...mcpToolGroups(opts).flatMap((g) => g.tools), ...(opts.spike ? [PROBE_TOOL] : [])];
}

