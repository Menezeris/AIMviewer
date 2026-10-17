import "server-only";

import { lookupGuids, resolveTargetsToGuids } from "./aim-lookup";
import { execEngineTool, type EngineExecution } from "./tools";

/** `ifc_*` tool s reálnym prepojením na DB AIM (D-084); importuje sa lenivo z MCP route. */
export function runEngineTool(name: string, args: Record<string, unknown>): Promise<EngineExecution> {
  return execEngineTool(name, args, { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids });
}
