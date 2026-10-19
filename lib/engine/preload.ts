import "server-only";

import { getIfcModels } from "../data/ifc-models";

import { getStore } from "./cache";
import { nameIndex } from "./search";
import { openEngineSession, type EngineModel } from "./session";
import { guidIndex } from "./tools";

/**
 * Predčítanie modelov federácie do cache motora (D-100). MCP route ho spúšťa
 * po `initialize` / `tools/list` (cez `after()`), teda keď sa Claude pripája,
 * aby prvé `ifc_*` volanie nečakalo sekundy na stiahnutie a parsovanie.
 * Teplá cache stojí len HEAD request raz za minútu; chyba sa ignoruje -
 * tool si model načíta sám.
 *
 * D-102: postaví aj indexy GUID a mien (mená stoja na indexe `ifc_search`).
 * Bez nich prvé `ifc_get` / `ifc_search` / hľadanie podľa kódu na čerstvej
 * inštancii čakalo 2 až 4 s navyše; indexy sa držia so store ako model.
 */
export async function preloadEngineModels(): Promise<void> {
  const loaded = await Promise.all(
    getIfcModels().map(async (src): Promise<EngineModel | null> => {
      const res = await getStore(src).catch(() => null);
      return res ? { id: src.id, name: `${src.id}.ifc`, store: res.entry.store } : null;
    }),
  );
  const models = loaded.filter((m): m is EngineModel => m !== null);
  if (models.length === 0) return;
  const session = await openEngineSession(models);
  await Promise.all(models.flatMap((m) => [guidIndex(session, m), nameIndex(session, m)].map((p) => p.catch(() => null))));
}
