import "server-only";

import { getIfcModels } from "../data/ifc-models";

import { getStore } from "./cache";

/**
 * Predčítanie modelov federácie do cache motora (D-100). MCP route ho spúšťa
 * po `initialize` / `tools/list` (cez `after()`), teda keď sa Claude pripája,
 * aby prvé `ifc_*` volanie nečakalo sekundy na stiahnutie a parsovanie.
 * Teplá cache stojí len HEAD request raz za minútu; chyba sa ignoruje -
 * tool si model načíta sám.
 */
export async function preloadEngineModels(): Promise<void> {
  await Promise.all(getIfcModels().map((m) => getStore(m).catch(() => null)));
}
