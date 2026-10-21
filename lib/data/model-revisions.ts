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

/** Posledná zmena prvku receptom (D-129): BCF téma s výberom prvku, ktorá zverejnila revíziu. */
export interface ElementChange {
  model: string;
  /** vNNN. */
  revision: string;
  title: string;
  date: string;
}

/** Najnovšia téma (`model_tasks`) s prvkom vo výbere a zverejnenou revíziou; null = žiadna. */
export async function fetchLastElementChange(guid: string): Promise<ElementChange | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("model_tasks")
    .select("model, title, result_revision, updated_at")
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
