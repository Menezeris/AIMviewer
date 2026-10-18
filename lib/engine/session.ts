import {
  InMemoryModelRegistry,
  PromptRegistry,
  ResourceRegistry,
  SILENT_LOGGER,
  ToolRegistry,
  buildDefaultToolRegistry,
  createMCPServer,
  readOnlyScope,
  type JsonRpcResponse,
} from "@ifc-lite/mcp";
import type { IfcDataStore } from "@ifc-lite/parser";

import { modelFromStore } from "./loader";

/**
 * Jedno volanie toolu `@ifc-lite/mcp` (D-084) - bezstavovo.
 *
 * Každé volanie postaví vlastný server balíka nad čerstvými backendmi
 * zdieľaných storeov: úpravy (overlay) visia na backende a balík ich nevie
 * zmazať, takže zdieľaný model by medzi requestmi "zdedil" cudzie zmeny.
 * Volanie ide cez `server.handleMessage` (nie priamo cez handler), aby
 * ostala validácia vstupu, kontrola rozsahu a prevod chýb na výsledok toolu.
 * Rozsah je len na čítanie a zoznam tools je zámerne úzky - zápisové a
 * exportné tools sem nepatria (fáza 3, D-086).
 */

/** Upstream tools, ktoré motor smie volať (fáza 0/1, len čítanie). */
export const ENGINE_UPSTREAM_TOOLS = [
  "model_info",
  "query_entities",
  "count_entities",
  "get_entity",
  "get_entities_bulk",
  "properties_unique",
  "spatial_hierarchy",
  "relationships",
  "classifications_list",
  "ids_validate",
  "clash_check",
  // Prevzaté 1:1 (D-087, `passthrough-defs.ts`).
  "materials_list",
  "geometry_area",
  "geometry_volume",
  "model_audit",
  "schema_describe",
] as const;
export type EngineUpstreamTool = (typeof ENGINE_UPSTREAM_TOOLS)[number];

let toolRegistry: ToolRegistry | null = null;
function tools(): ToolRegistry {
  if (toolRegistry) return toolRegistry;
  const all = buildDefaultToolRegistry();
  const subset = new ToolRegistry();
  for (const name of ENGINE_UPSTREAM_TOOLS) {
    const t = all.get(name);
    if (!t) throw new Error(`@ifc-lite/mcp nemá tool ${name} - zmenila sa verzia balíka?`);
    subset.register(t);
  }
  toolRegistry = subset;
  return subset;
}

export interface EngineModel {
  id: string;
  name: string;
  store: IfcDataStore;
}

export interface EngineToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface EngineSession {
  call(name: EngineUpstreamTool, args: Record<string, unknown>): Promise<EngineToolResult>;
}

/**
 * Relácia nad čerstvými backendmi zadaných modelov - viac volaní v jednom
 * requeste (napr. `ifc_get` po prvkoch) zdieľa jeden server balíka.
 */
export async function openEngineSession(models: EngineModel[]): Promise<EngineSession> {
  const registry = new InMemoryModelRegistry();
  for (const m of models) registry.add(modelFromStore(m.store, m.name, m.id));

  const server = createMCPServer({
    name: "aim-ifc-engine",
    registry,
    scope: readOnlyScope(),
    tools: tools(),
    resources: new ResourceRegistry(),
    prompts: new PromptRegistry(),
    logger: SILENT_LOGGER,
    config: { readOnly: true },
  });
  await server.handleMessage({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "aim-viewer", version: "1" },
    },
  });

  let nextId = 1;
  return {
    async call(name, args) {
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      })) as JsonRpcResponse | null;
      if (!res) throw new Error(`@ifc-lite/mcp nevrátil odpoveď na ${name}`);
      if ("error" in res && res.error) throw new Error(`@ifc-lite/mcp ${name}: ${res.error.message}`);
      return (res as { result: EngineToolResult }).result;
    },
  };
}

/** Jedno volanie toolu v novej relácii. */
export async function callEngineTool(
  models: EngineModel[],
  name: EngineUpstreamTool,
  args: Record<string, unknown>,
): Promise<EngineToolResult> {
  return (await openEngineSession(models)).call(name, args);
}
