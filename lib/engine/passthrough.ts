import { getIfcModels } from "../data/ifc-models";

import { engineRevision, getStore } from "./cache";
import type { GuidLookup } from "./join";
import { PASSTHROUGH_TOOLS, passthroughName, type PassthroughTool } from "./passthrough-defs";
import { openEngineSession, type EngineModel, type EngineUpstreamTool } from "./session";
import type { EngineDeps, EngineExecution } from "./tools";

/**
 * Vykonanie prevzatých tools (D-087): vstup ide do balíka bez úprav (len
 * kľúče z jeho schémy), výsledok sa vráti tak, ako ho balík dal, a GUIDy v
 * ňom sa doplnia o object_ref z AIM v samostatnom poli `aim`.
 */

const MAX_RESULT_CHARS = 20_000;
const MAX_AIM_GUIDS = 500;
const GUID_KEYS = new Set(["globalId", "global_id", "GlobalId"]);

const byName = new Map(PASSTHROUGH_TOOLS.map((t) => [passthroughName(t.upstream), t]));
export const isPassthroughTool = (name: string) => byName.has(name);

/** Všetky IFC GUIDy vo výsledku (podľa mena kľúča), bez opakovania. */
export function collectGuids(value: unknown, out = new Set<string>()): Set<string> {
  if (out.size >= MAX_AIM_GUIDS || value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) collectGuids(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (GUID_KEYS.has(k) && typeof v === "string" && v.length === 22) out.add(v);
    else collectGuids(v, out);
    if (out.size >= MAX_AIM_GUIDS) break;
  }
  return out;
}

async function aimRefs(result: unknown, lookup: GuidLookup) {
  const guids = [...collectGuids(result)];
  if (guids.length === 0) return {};
  const refs = await lookup(guids);
  if (refs.size === 0) return {};
  return { aim: Object.fromEntries([...refs].map(([g, a]) => [g, { object_ref: a.object_ref, name: a.name }])) };
}

function pick(input: Record<string, unknown>, tool: PassthroughTool): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([k]) => k in tool.properties));
}

export async function execPassthroughTool(
  name: string,
  input: Record<string, unknown>,
  deps: EngineDeps,
): Promise<EngineExecution> {
  const tool = byName.get(name);
  if (!tool) return { content: `Neznámy tool motora: ${name}`, isError: true };
  const args = pick(input, tool);
  const models: EngineModel[] = [];
  let revision: Record<string, unknown> | undefined;
  if (tool.needsModel) {
    const id = typeof args.model_id === "string" ? args.model_id.trim() : "";
    const src = (deps.sources ?? getIfcModels)().find((m) => m.id === id);
    if (!src) return { content: "Zadaj model_id modelu federácie (napr. ASR alebo VZT).", isError: true };
    const { entry } = await getStore(src, { fetchImpl: deps.fetchImpl });
    models.push({ id: src.id, name: `${src.id}.ifc`, store: entry.store });
    revision = engineRevision(entry);
  }
  const session = await openEngineSession(models);
  const res = await session.call(tool.upstream as EngineUpstreamTool, args);
  const text = res.content.map((c) => c.text ?? "").join("\n").trim();
  if (res.isError) return { content: `Chyba toolu ${tool.upstream}: ${text || "motor vrátil chybu"}`, isError: true };
  const result = res.structuredContent ?? text;
  const body = JSON.stringify({
    tool: tool.upstream,
    ...(revision ? { model: args.model_id, revision } : {}),
    result,
    ...(await aimRefs(result, deps.lookup)),
  });
  const content =
    body.length <= MAX_RESULT_CHARS
      ? body
      : body.slice(0, MAX_RESULT_CHARS) + `... [orezané, ${body.length} znakov - zúž dotaz]`;
  return { content, isError: false };
}
