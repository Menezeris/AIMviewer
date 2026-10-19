import { getIfcModels } from "../data/ifc-models";

import type { EngineModelSource } from "./cache";
import { nameIndex, nameKey } from "./search";
import { openEngineSession } from "./session";
import { modelsFor } from "./tools";

/** Prvok IFC nájdený podľa presného mena alebo Tagu (D-102). */
export interface NameMatch {
  global_id: string;
  ifc_type: string;
  model: string;
  name: string | null;
}

/**
 * Kódy prvkov (SD04.0001, VV.03.01.040) -> prvky IFC so zhodným Name alebo Tag
 * naprieč federáciou. Prvok nemusí byť v grafe AIM (rameno schodiska), preto
 * to, čo DB nepozná, dohľadá až motor. Index mien je hotový z predčítania.
 */
export async function findByNames(
  names: string[],
  opts: { sources?: () => EngineModelSource[]; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, NameMatch[]>> {
  const out = new Map<string, NameMatch[]>();
  if (names.length === 0) return out;
  const sources = opts.sources ?? getIfcModels;
  const deps = { sources, fetchImpl: opts.fetchImpl, lookup: async () => new Map(), resolveTargets: async () => new Map() };
  const { models } = await modelsFor(sources().map((m) => m.id), deps);
  const session = await openEngineSession(models);
  const indexes = await Promise.all(models.map((m) => nameIndex(session, m)));
  for (const n of names) {
    const hits = indexes.flatMap((ni) => ni.get(nameKey(n)) ?? []);
    if (hits.length > 0) {
      out.set(n, hits.map((e) => ({ global_id: e.global_id, ifc_type: e.ifc_type, model: e.model, name: e.name })));
    }
  }
  return out;
}
