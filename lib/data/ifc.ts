import "server-only";

import { unstable_cache } from "next/cache";

import { AIM_CACHE } from "@/lib/data/constants";
import { fetchAllPages } from "@/lib/data/pagination";
import { getIfcModels, withRevisions, type IfcModel } from "@/lib/data/ifc-models";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

export { getIfcModels, type IfcModel } from "@/lib/data/ifc-models";

/**
 * Modely federácie s aktuálnou revíziou (D-086). Bez cache: po správe "nová
 * revízia" (`router.refresh()`) musí stránka vidieť novú revíziu hneď. Bez tabuľky
 * `model_revisions` (migrácia ešte nie je nasadená) alebo pri chybe ostanú URL bez `rev`.
 */
export async function getCurrentIfcModels(): Promise<IfcModel[]> {
  const models = getIfcModels();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("model_revisions")
      .select("model, revision")
      .eq("is_current", true);
    if (error || !data) return models;
    return withRevisions(models, data as { model: string; revision: number }[]);
  } catch {
    return models;
  }
}

async function fetchGuidMapImpl(): Promise<GuidMap> {
  const supabase = getSupabaseAdmin();
  // Stránkovane: po federácii VZT (D-049) je aktívnych GUID záznamov > 1000
  // a PostgREST (db-max-rows) by mapu ticho orezal — prvky nad limit by v 3D
  // viewera nemali AIM kartu (GUID→id sa nepreloží).
  const data = await fetchAllPages<{ object_id: string | null; ifc_guid: string | null }>(
    (from, to) =>
      supabase
        .from("ifc_guid_history")
        .select("object_id, ifc_guid")
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
  );

  const map: GuidMap = {};
  for (const row of data) {
    if (row.ifc_guid && row.object_id) {
      map[row.ifc_guid] = row.object_id;
    }
  }
  return map;
}

/** Cachovaná GUID mapa (ISR 60 s, D-029). */
export const fetchGuidMap = unstable_cache(
  fetchGuidMapImpl,
  ["ifc-guid-map"],
  AIM_CACHE
);
