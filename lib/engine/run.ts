import "server-only";

import type { ClashBcfPort } from "../clash/types";
import { supabaseBcfStore } from "../bcf/store";
import { notifyBcfChanged } from "../bcf/runtime";
import { clashViewer } from "../clash/runtime";
import { supabaseClashStore } from "../clash/store";
import { supabaseVerificationStore } from "../verify/store";
import { fetchModelRevisions } from "../data/model-revisions";
import { supabaseIdsStore } from "../ids/store";
import { AskToolRuntime } from "../llm/tools";

import { lookupGuids, resolveTargetsToGuids } from "./aim-lookup";
import { systemsOfGuids } from "./clash-systems";
import { spatialLinksOfGuid } from "./spatial-links";
import { installArchiveSource } from "./archive-source";
import { fetchRelatedMembers } from "./related-members";
import { execSearchAll } from "./search-all";
import { execEngineTool, ifcSearchResult, type EngineDeps, type EngineExecution } from "./tools";
import { currentProjectId } from "../project/context";

// D-135: engine models from the immutable revision archive (about 5 times less egress).
installArchiveSource();

/** BCF layer for `clash bcf create=true`: the same store as `bcf_topic create` (D-099), with a notification by the viewer. */
function clashBcfPort(): ClashBcfPort {
  return {
    create: async (row) => {
      const t = await supabaseBcfStore(currentProjectId()).create(row);
      return { id: t.id, number: t.number };
    },
    notify: notifyBcfChanged,
  };
}

/** Engine dependencies with a real link to the AIM DB (D-084); also for host routes of quantity verification (D-185 UI). */
export function engineDeps(): EngineDeps {
  return { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids, revisions: (models, perModel) => fetchModelRevisions(currentProjectId(), models, perModel), ids: supabaseIdsStore(currentProjectId()), systems: systemsOfGuids, spatialLinks: spatialLinksOfGuid, clash: supabaseClashStore(currentProjectId()), bcf: clashBcfPort(), clashViewer, verification: supabaseVerificationStore(currentProjectId()) };
}

/** `ifc_*` tool with a real link to the AIM DB (D-084); imported lazily from the MCP route. */
export function runEngineTool(name: string, args: Record<string, unknown>): Promise<EngineExecution> {
  return execEngineTool(name, args, engineDeps());
}

/** Combined `search_all` (D-095): IFC file + AIM graph, a badge on every result. */
export function runSearchAll(args: Record<string, unknown>): Promise<EngineExecution> {
  const deps = { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids };
  const runtime = new AskToolRuntime(currentProjectId());
  return execSearchAll(args, {
    ifc: (input) => ifcSearchResult(input, deps),
    aim: (input) => runtime.searchEverything(input),
    related: fetchRelatedMembers,
  });
}
