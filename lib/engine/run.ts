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

// D-135: modely motora z nemenného archívu revízie (cca 5-krát menej egressu).
installArchiveSource();

/** BCF vrstva pre `clash bcf create=true`: ten istý store ako `bcf_topic create` (D-099), s oznámením viewerom. */
function clashBcfPort(): ClashBcfPort {
  return {
    create: async (row) => {
      const t = await supabaseBcfStore(currentProjectId()).create(row);
      return { id: t.id, number: t.number };
    },
    notify: notifyBcfChanged,
  };
}

/** Závislosti motora s reálnym prepojením na DB AIM (D-084); aj pre host routes overenia výmer (D-185 UI). */
export function engineDeps(): EngineDeps {
  return { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids, revisions: (models, perModel) => fetchModelRevisions(currentProjectId(), models, perModel), ids: supabaseIdsStore(currentProjectId()), systems: systemsOfGuids, spatialLinks: spatialLinksOfGuid, clash: supabaseClashStore(currentProjectId()), bcf: clashBcfPort(), clashViewer, verification: supabaseVerificationStore(currentProjectId()) };
}

/** `ifc_*` tool s reálnym prepojením na DB AIM (D-084); importuje sa lenivo z MCP route. */
export function runEngineTool(name: string, args: Record<string, unknown>): Promise<EngineExecution> {
  return execEngineTool(name, args, engineDeps());
}

/** Kombinované `search_all` (D-095): IFC súbor + graf AIM, badge pri každom výsledku. */
export function runSearchAll(args: Record<string, unknown>): Promise<EngineExecution> {
  const deps = { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids };
  const runtime = new AskToolRuntime(currentProjectId());
  return execSearchAll(args, {
    ifc: (input) => ifcSearchResult(input, deps),
    aim: (input) => runtime.searchEverything(input),
    related: fetchRelatedMembers,
  });
}
