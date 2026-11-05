import "server-only";

import { envIfcModels, modelsFromRows, type IfcModel, type ProjectModelRow } from "@/lib/data/ifc-models";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * IFC models of a project from the DB (D-189): containers with a current revision, with the
 * archive location of that revision. No cache: after "new revision" (`router.refresh()`) the page
 * must see it at once (D-086). The env override (`NEXT_PUBLIC_IFC_URLS`) wins for local checks.
 */
export async function fetchProjectModels(projectId: string): Promise<IfcModel[]> {
  const env = envIfcModels();
  if (env) return env;
  const sb = getSupabaseAdmin();
  // D-190: the archive path is stored per revision (OCB `archive/<MODEL>/`, new projects
  // `archive/<container uuid>/`); the code is a label from the DB, never read from the path.
  const { data: revs, error } = await sb
    .from("model_revisions")
    .select("container_id, model, revision, archive_path")
    .eq("project_id", projectId)
    .eq("is_current", true);
  if (error) throw new Error(`model_revisions: ${error.message}`);
  const rows = (revs ?? []) as { container_id: string | null; model: string; revision: number; archive_path: string | null }[];
  const out: ProjectModelRow[] = rows
    .filter((r) => r.container_id)
    .map((r) => ({ container_id: r.container_id as string, model: r.model, revision: r.revision, location: r.archive_path }));
  return modelsFromRows(out);
}

const memo = new Map<string, { at: number; models: Promise<IfcModel[]> }>();
const MEMO_MS = 5_000;

/** Same as `fetchProjectModels`, shared for 5 s per instance (API requests, MCP tool lists). */
export function projectModelsShort(projectId: string, now: () => number = Date.now): Promise<IfcModel[]> {
  const hit = memo.get(projectId);
  if (hit && now() - hit.at < MEMO_MS) return hit.models;
  const models = fetchProjectModels(projectId);
  memo.set(projectId, { at: now(), models });
  models.catch(() => memo.delete(projectId));
  return models;
}

export { requestIfcModels } from "@/lib/project/request-models";
