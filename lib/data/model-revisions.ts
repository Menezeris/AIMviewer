import "server-only";

import type { ModelRevisionRow } from "@/lib/engine/revisions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Revízie modelov z `model_revisions` (D-086) pre `ifc_models` (D-109): aktuálna
 * revízia každého modelu a posledných `perModel` revízií, najnovšie prvé.
 */
export async function fetchModelRevisions(models: string[], perModel: number): Promise<ModelRevisionRow[]> {
  if (models.length === 0) return [];
  const columns = "model, revision, parent_revision, is_current, sha256, size_bytes, recipe_ref, summary, author, guard, created_at";
  const supabase = getSupabaseAdmin();
  const out: ModelRevisionRow[] = [];
  for (const model of models) {
    const { data, error } = await supabase
      .from("model_revisions")
      .select(columns)
      .eq("model", model)
      .order("revision", { ascending: false })
      .limit(Math.max(1, perModel));
    if (error) throw new Error(`model_revisions: ${error.message}`);
    out.push(...((data ?? []) as ModelRevisionRow[]));
  }
  // Aktuálna nemusí byť najnovšia (návrat cez `model_publish revert`): dočítať ju zvlášť.
  const missing = models.filter((m) => !out.some((r) => r.model === m && r.is_current));
  if (missing.length > 0) {
    const { data, error } = await supabase.from("model_revisions").select(columns).in("model", missing).eq("is_current", true);
    if (error) throw new Error(`model_revisions: ${error.message}`);
    out.push(...((data ?? []) as ModelRevisionRow[]));
  }
  return out;
}
