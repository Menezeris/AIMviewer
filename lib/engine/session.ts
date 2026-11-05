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
 * A single call of an `@ifc-lite/mcp` tool (D-084) - stateless.
 *
 * Every call builds its own bundle server over fresh backends
 * of the shared stores: edits (overlay) hang on the backend and the bundle cannot
 * delete them, so a shared model would "inherit" foreign changes between requests.
 * The call goes via `server.handleMessage` (not directly via the handler), so that
 * input validation, scope checking and conversion of errors to a tool result stay.
 * The scope is read only and the tool list is intentionally narrow - write and
 * export tools do not belong here (phase 3, D-086).
 */

/** Upstream tools the engine may call (phase 0/1, read only). */
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
  // Taken over 1:1 (D-087, `passthrough-defs.ts`).
  "materials_list",
  "geometry_area",
  "geometry_volume",
  "model_audit",
  "schema_describe",
  // IDS documents (D-162): only via `lib/ids/`, the carrier is XML; `ids_apply_ops` returns Studio JSON.
  "ids_read",
  "ids_apply_ops",
  "ids_write",
  "ids_audit",
  "ids_lint",
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
 * Session over fresh backends of the given models - several calls in one
 * request (e.g. `ifc_get` per element) share one bundle server.
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

/** Input schema of an upstream tool (D-162: the vocabulary of `ids_apply_ops` operations for the LLM). */
export function upstreamInputSchema(name: EngineUpstreamTool): Record<string, unknown> {
  return (tools().get(name)?.inputSchema ?? {}) as Record<string, unknown>;
}

/** A single tool call in a new session. */
export async function callEngineTool(
  models: EngineModel[],
  name: EngineUpstreamTool,
  args: Record<string, unknown>,
): Promise<EngineToolResult> {
  return (await openEngineSession(models)).call(name, args);
}
