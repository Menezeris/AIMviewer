import "server-only";

import type { IfcModel } from "../data/ifc-models";

import { installArchiveSource } from "./archive-source";
import { getStore } from "./cache";
import { nameIndex } from "./search";
import { openEngineSession, type EngineModel } from "./session";
import { guidIndex } from "./tools";

// D-135: engine models from the immutable revision archive (about 5 times less egress).
installArchiveSource();

/**
 * Preloading federation models into the engine cache (D-100). The MCP route starts it
 * after `initialize` / `tools/list` (via `after()`), i.e. when Claude connects,
 * so that the first `ifc_*` call does not wait seconds for download and parsing.
 * A warm cache costs only a HEAD request once a minute; an error is ignored -
 * the tool loads the model itself.
 *
 * D-102: it also builds the GUID and name indexes (names stand on the `ifc_search` index).
 * Without them the first `ifc_get` / `ifc_search` / lookup by code on a fresh
 * instance waited 2 to 4 s extra; indexes are kept with the store as the model.
 * D-189: `sources` = models of the request project (the caller captures them before `after()`).
 */
export async function preloadEngineModels(sources: IfcModel[]): Promise<void> {
  const loaded = await Promise.all(
    sources.map(async (src): Promise<EngineModel | null> => {
      const res = await getStore(src).catch(() => null);
      return res ? { id: src.id, name: `${src.id}.ifc`, store: res.entry.store } : null;
    }),
  );
  const models = loaded.filter((m): m is EngineModel => m !== null);
  if (models.length === 0) return;
  const session = await openEngineSession(models);
  await Promise.all(models.flatMap((m) => [guidIndex(session, m), nameIndex(session, m)].map((p) => p.catch(() => null))));
}
