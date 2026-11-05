import "server-only";

import { cachedProjectRead } from "@/lib/data/revalidate";
import { fetchAllPages } from "@/lib/data/pagination";
import type { IfcModel } from "@/lib/data/ifc-models";
import { fetchProjectModels } from "@/lib/project/models";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** ifc_guid → objects.id (aktívne záznamy živých uzlov projektu, D-189). */
export type GuidMap = Record<string, string>;

export type { IfcModel } from "@/lib/data/ifc-models";

/**
 * IFC models of the project with their current revision (D-086, D-189): containers with a current
 * revision from the DB, not a hardcoded list. Bez cache: po správe "nová revízia"
 * (`router.refresh()`) musí stránka vidieť novú revíziu hneď. Pri chybe prázdny zoznam (viewer
 * ukáže, že model nie je), nie modely iného projektu.
 */
export async function getCurrentIfcModels(projectId: string): Promise<IfcModel[]> {
  try {
    return await fetchProjectModels(projectId);
  } catch (err) {
    console.error("[ifc] project models", err);
    return [];
  }
}

async function fetchGuidMapImpl(projectId: string): Promise<GuidMap> {
  const supabase = getSupabaseAdmin();
  // Stránkovane: po federácii VZT (D-049) je aktívnych GUID záznamov > 1000
  // a PostgREST (db-max-rows) by mapu ticho orezal — prvky nad limit by v 3D
  // viewera nemali AIM kartu (GUID→id sa nepreloží).
  const data = await fetchAllPages<{ object_id: string | null; ifc_guid: string | null }>(
    (from, to) =>
      supabase
        // D-189: GUIDs resolve within the project (an IFC GUID is unique only per project);
        // `ifc_guid_node` = active history of live nodes plus GUID aliases.
        .from("ifc_guid_node")
        .select("object_id, ifc_guid")
        .eq("project_id", projectId)
        .order("ifc_guid", { ascending: true })
        .order("object_id", { ascending: true })
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
export const fetchGuidMap = cachedProjectRead("ifc-guid-map", fetchGuidMapImpl);
