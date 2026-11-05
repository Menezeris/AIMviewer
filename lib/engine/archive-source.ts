import "server-only";

import { archiveUrl, modelKey } from "../data/ifc-models";
import { fetchCurrentRevision } from "../data/model-revisions";

import { setArchiveResolver, type EngineModelSource } from "./cache";

/** Archív aktuálnej revízie modelu podľa `model_revisions` (D-135); null = pôvodná URL. */
export async function currentArchiveUrl(src: EngineModelSource): Promise<string | null> {
  const key = modelKey(src.url);
  if (key === null) return null;
  const revision = await fetchCurrentRevision(key);
  return revision === null ? null : archiveUrl(src.url, revision);
}

/** Motor na serveri sťahuje archív revízie namiesto celého IFC (D-135); volá sa pri importe vstupov motora. */
export function installArchiveSource(): void {
  setArchiveResolver(currentArchiveUrl);
}
