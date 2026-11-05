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
  const { data: revs, error } = await sb
    .from("model_revisions")
    .select("id, container_id, model, revision")
    .eq("project_id", projectId)
    .eq("is_current", true);
  if (error) throw new Error(`model_revisions: ${error.message}`);
  const rows = (revs ?? []) as { id: string; container_id: string | null; model: string; revision: number }[];
  if (rows.length === 0) return [];
  const { data: locs, error: lErr } = await sb
    .from("container_revisions")
    .select("model_revision_id, location")
    .in("model_revision_id", rows.map((r) => r.id));
  if (lErr) throw new Error(`container_revisions: ${lErr.message}`);
  const loc = new Map(((locs ?? []) as { model_revision_id: string; location: string | null }[]).map((l) => [l.model_revision_id, l.location]));
  const out: ProjectModelRow[] = rows
    .filter((r) => r.container_id)
    .map((r) => ({ container_id: r.container_id as string, model: r.model, revision: r.revision, location: loc.get(r.id) ?? null }));
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
