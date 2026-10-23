import "server-only";

import type { ClashBcfPort } from "../clash/types";
import { supabaseBcfStore } from "../bcf/store";
import { notifyBcfChanged } from "../bcf/runtime";
import { supabaseClashStore } from "../clash/store";
import { fetchModelRevisions } from "../data/model-revisions";
import { supabaseIdsStore } from "../ids/store";
import { AskToolRuntime } from "../llm/tools";

import { lookupGuids, resolveTargetsToGuids } from "./aim-lookup";
import { systemsOfGuids } from "./clash-systems";
import { installArchiveSource } from "./archive-source";
import { fetchRelatedMembers } from "./related-members";
import { execSearchAll } from "./search-all";
import { execEngineTool, ifcSearchResult, type EngineExecution } from "./tools";

// D-135: modely motora z nemenného archívu revízie (cca 5-krát menej egressu).
installArchiveSource();

/** BCF vrstva pre `clash bcf create=true`: ten istý store ako `bcf_topic create` (D-099), s oznámením viewerom. */
function clashBcfPort(): ClashBcfPort {
  return {
    create: async (row) => {
      const t = await supabaseBcfStore().create(row);
      return { id: t.id, number: t.number };
    },
    notify: notifyBcfChanged,
  };
}

/** `ifc_*` tool s reálnym prepojením na DB AIM (D-084); importuje sa lenivo z MCP route. */
export function runEngineTool(name: string, args: Record<string, unknown>): Promise<EngineExecution> {
  return execEngineTool(name, args, { lookup: lookupGuids, resolveTargets: resolveTargetsToGuids, revisions: fetchModelRevisions, ids: supabaseIdsStore(), systems: systemsOfGuids, clash: supabaseClashStore(), bcf: clashBcfPort() });
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
