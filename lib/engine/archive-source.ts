import "server-only";

import { archiveUrl, modelKey } from "../data/ifc-models";
import { fetchCurrentRevision } from "../data/model-revisions";

import { maybeCurrentProject } from "../project/context";

import { setArchiveResolver, type EngineModelSource } from "./cache";

/**
 * Archív aktuálnej revízie modelu (D-135); null = pôvodná URL. The project's model list already
 * carries the current revision (D-189); otherwise it is read within the request project.
 */
export async function currentArchiveUrl(src: EngineModelSource): Promise<string | null> {
  if (src.revision !== undefined) return archiveUrl(src.url, src.revision);
  const key = src.containerId ? src.id : modelKey(src.url);
  const project = maybeCurrentProject();
  if (key === null || !project) return null;
  const revision = await fetchCurrentRevision(project.id, key);
  return revision === null ? null : archiveUrl(src.url, revision);
}

/** Motor na serveri sťahuje archív revízie namiesto celého IFC (D-135); volá sa pri importe vstupov motora. */
export function installArchiveSource(): void {
  setArchiveResolver(currentArchiveUrl);
}
