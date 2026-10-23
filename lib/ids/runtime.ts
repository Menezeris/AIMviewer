import "server-only";

import { supabaseIdsStore } from "./store";
import { execIdsTool, type IdsToolResult } from "./tools";

/** Produkčné závislosti toolu `ids_document` (D-162): DB; import je lenivý z MCP route. */
export function runIdsTool(name: string, args: Record<string, unknown>): Promise<IdsToolResult> {
  return execIdsTool(name, args, { store: supabaseIdsStore() });
}
