import "server-only";

import type { ModelRevisionRow } from "@/lib/engine/revisions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Model revisions from `model_revisions` (D-086) for `ifc_models` (D-109): the current
 * revision of each model and the last `perModel` revisions, newest first.
 */
export async function fetchModelRevisions(projectId: string, models: string[], perModel: number): Promise<ModelRevisionRow[]> {
  if (models.length === 0) return [];
  const columns = "model, revision, parent_revision, is_current, sha256, size_bytes, recipe_ref, summary, author, guard, created_at";
  const supabase = getSupabaseAdmin();
  const out: ModelRevisionRow[] = [];
  for (const model of models) {
    const { data, error } = await supabase
      .from("model_revisions")
      .select(columns)
      .eq("project_id", projectId)
      .eq("model", model)
      .order("revision", { ascending: false })
      .limit(Math.max(1, perModel));
    if (error) throw new Error(`model_revisions: ${error.message}`);
    out.push(...((data ?? []) as ModelRevisionRow[]));
  }
  // The current one need not be the newest (a return via `model_publish revert`): read it separately.
  const missing = models.filter((m) => !out.some((r) => r.model === m && r.is_current));
  if (missing.length > 0) {
    const { data, error } = await supabase.from("model_revisions").select(columns).eq("project_id", projectId).in("model", missing).eq("is_current", true);
    if (error) throw new Error(`model_revisions: ${error.message}`);
    out.push(...((data ?? []) as ModelRevisionRow[]));
  }
  return out;
}

/** The last change of an element by a recipe (D-129): a BCF topic with the element selected that published the revision. */
export interface ElementChange {
  model: string;
  /** vNNN. */
  revision: string;
  title: string;
  date: string;
}

/** The newest topic (`model_tasks`) with the element in the selection and a published revision; null = none. */
export async function fetchLastElementChange(projectId: string, guid: string): Promise<ElementChange | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("model_tasks")
    .select("model, title, result_revision, updated_at")
    .eq("project_id", projectId)
    .contains("components", [guid])
    .not("result_revision", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`model_tasks: ${error.message}`);
  const row = (data?.[0] ?? null) as { model: string; title: string; result_revision: number; updated_at: string } | null;
  return row
    ? { model: row.model, revision: `v${String(row.result_revision).padStart(3, "0")}`, title: row.title, date: row.updated_at.slice(0, 10) }
    : null;
}

/** Current revision of a model (`model_revisions.is_current`) or null when the model has no revision. */
export async function fetchCurrentRevision(projectId: string, model: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("model_revisions")
    .select("revision")
    .eq("project_id", projectId)
    .eq("model", model)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(`model_revisions: ${error.message}`);
  return (data as { revision: number } | null)?.revision ?? null;
}
