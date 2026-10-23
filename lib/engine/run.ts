import "server-only";

import { fetchModelRevisions } from "../data/model-revisions";
import { supabaseIdsStore } from "../ids/store";
import { AskToolRuntime } from "../llm/tools";

import { lookupGuids, resolveTargetsToGuids } from "./aim-lookup";
import { installArchiveSource } from "./archive-source";
import { fetchRelatedMembers } from "./related-members";
import { execSearchAll } from "./search-all";
import { execEngineTool, ifcSearchResult, type EngineExecution } from "./tools";

// D-135: modely motora z nemenného archívu revízie (cca 5-krát menej egressu).
installArchiveSource();

/** `ifc_*` tool s reálnym prepojením na DB AIM (D-084); importuje sa lenivo z MCP route. */
export function runEngineTool(name: string, args: Record<string, unknown>): Promise<EngineExecution> {
  return execEngineTool(name, args, { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids, revisions: fetchModelRevisions, ids: supabaseIdsStore() });
}

/** Kombinované `search_all` (D-095): IFC súbor + graf AIM, badge pri každom výsledku. */
export function runSearchAll(args: Record<string, unknown>): Promise<EngineExecution> {
  const deps = { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids };
  const runtime = new AskToolRuntime();
  return execSearchAll(args, {
    ifc: (input) => ifcSearchResult(input, deps),
    aim: (input) => runtime.searchEverything(input),
    related: fetchRelatedMembers,
  });
}
