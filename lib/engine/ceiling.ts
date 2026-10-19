import { getIfcModels } from "../data/ifc-models";

import type { EngineModelSource } from "./cache";
import { openEngineSession } from "./session";
import { modelsFor, storeyGuid, structured } from "./tools";

const QSET = "Qto_SpaceBaseQuantities";
const QNAME = "FinishCeilingHeight";

/** Výška podhľadu miestností podlažia v metroch (D-102). */
export interface StoreyCeiling {
  /** Medián FinishCeilingHeight miestností podlažia vážený ich plochou (m, od hotovej podlahy, IFC). */
  height_m: number;
  min_m: number;
  max_m: number;
  spaces: number;
  model: string;
}

/** Vážený medián: výška, pod ktorou je aspoň polovica plochy podlažia (bez plochy váha 1). */
export function weightedMedian(items: Array<{ value: number; weight: number }>): number {
  const v = [...items].sort((a, b) => a.value - b.value);
  const total = v.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of v) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return v[v.length - 1].value;
}

/**
 * "Pod podhľadom na 3NP" = podhľad miestností 3NP, nie IfcCovering priradené k
 * podlažiu (v modeli visia pod doskou podlažia a patria miestnostiam pod ním).
 * FinishCeilingHeight je podľa IFC od hotovej podlahy; jednotka podľa modelu.
 */
export async function storeyCeiling(
  label: string,
  opts: { sources?: () => EngineModelSource[]; fetchImpl?: typeof fetch } = {},
): Promise<StoreyCeiling | null> {
  const sources = opts.sources ?? getIfcModels;
  const deps = { sources, fetchImpl: opts.fetchImpl, lookup: async () => new Map(), resolveTargets: async () => new Map() };
  const { models } = await modelsFor(sources().map((m) => m.id), deps);
  const session = await openEngineSession(models);
  for (const m of models) {
    const gid = await storeyGuid(session, m.id, label).catch(() => null);
    if (!gid) continue;
    const page = structured<{ entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { model_id: m.id, types: ["IfcSpace"], in_storey: gid, limit: 1000, fields: ["globalId"] }),
    );
    const ids = (page.entities ?? []).map((e) => e.expressId);
    if (ids.length === 0) continue;
    const info = structured<{ lengthUnitScale?: number; result?: { lengthUnitScale?: number } }>(
      await session.call("model_info", { model_id: m.id }),
    );
    const raw = info.lengthUnitScale ?? info.result?.lengthUnitScale;
    const scale = typeof raw === "number" && raw > 0 ? raw : 1;
    const bulk = structured<{ entities?: Record<string, { quantities?: Array<{ name: string; quantities: Array<{ name: string; value: number }> }> }> }>(
      await session.call("get_entities_bulk", { model_id: m.id, express_ids: ids, include: ["quantities"] }),
    );
    const items: Array<{ value: number; weight: number }> = [];
    for (const e of Object.values(bulk.entities ?? {})) {
      const set = e.quantities?.find((s) => s.name === QSET)?.quantities;
      const q = set?.find((x) => x.name === QNAME);
      const area = set?.find((x) => x.name === "NetFloorArea")?.value;
      if (typeof q?.value === "number" && q.value > 0) {
        items.push({ value: q.value * scale, weight: typeof area === "number" && area > 0 ? area : 1 });
      }
    }
    if (items.length === 0) continue;
    const values = items.map((i) => i.value);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return { height_m: r(weightedMedian(items)), min_m: r(Math.min(...values)), max_m: r(Math.max(...values)), spaces: items.length, model: m.id };
  }
  return null;
}
