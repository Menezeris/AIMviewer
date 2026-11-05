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
  /** Podlažie zo súboru (aj cez celok, napr. rameno -> schodisko -> podlažie); null = nenašlo sa. */
  storey?: { name: string | null; global_id: string } | null;
}

interface Edge {
  relationshipType: string;
  direction: "forward" | "inverse";
  entity: { id: number; name?: string; type: string };
}

/** Vzťahy, ktorými prvok patrí do celku alebo priestoru (D-115, eval D7). */
const UP = new Set(["relaggregates", "relcontainedinspatialstructure", "relnests"]);
const MAX_UP = 4;

/** Podlažie prvku: nahor cez agregáciu a umiestnenie, kým nepríde IfcBuildingStorey. */
async function storeyOf(
  session: Awaited<ReturnType<typeof openEngineSession>>,
  model: { id: string; store: { entities: { getGlobalId(id: number): string } } },
  expressId: number,
): Promise<{ name: string | null; global_id: string } | null> {
  let current = expressId;
  for (let depth = 0; depth < MAX_UP; depth++) {
    const res = await session.call("relationships", { model_id: model.id, express_id: current });
    const edges = ((res.structuredContent as { relations?: Edge[] } | undefined)?.relations ?? []).filter(
      (e) => e.direction === "inverse" && UP.has(e.relationshipType.toLowerCase().replace(/^ifc/, "")),
    );
    const storey = edges.find((e) => e.entity.type.toLowerCase() === "ifcbuildingstorey");
    if (storey) return { name: storey.entity.name ?? null, global_id: model.store.entities.getGlobalId(storey.entity.id) };
    if (edges.length === 0) return null;
    current = edges[0].entity.id;
  }
  return null;
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
      out.set(
        n,
        await Promise.all(
          hits.map(async (e) => {
            const model = models.find((m) => m.id === e.model);
            // Podlažie len pre jednoznačný kód: pri viacerých kandidátoch by to boli zbytočné dotazy.
            const storey = model && hits.length === 1 ? await storeyOf(session, model, e.express_id).catch(() => null) : undefined;
            return { global_id: e.global_id, ifc_type: e.ifc_type, model: e.model, name: e.name, ...(storey !== undefined ? { storey } : {}) };
          }),
        ),
      );
    }
  }
  return out;
}
