import "server-only";

import { archiveUrl, modelKey } from "../data/ifc-models";
import { fetchCurrentRevision } from "../data/model-revisions";

import { maybeCurrentProject } from "../project/context";

import { setArchiveResolver, type EngineModelSource } from "./cache";

/**
 * Archive of the current model revision (D-135); null = original URL. The project's model list already
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

/** The engine on the server downloads the revision archive instead of the whole IFC (D-135); called when importing engine inputs. */
export function installArchiveSource(): void {
  setArchiveResolver(currentArchiveUrl);
}
