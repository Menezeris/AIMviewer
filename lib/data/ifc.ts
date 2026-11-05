import "server-only";

import { cachedProjectRead } from "@/lib/data/revalidate";
import { fetchAllPages } from "@/lib/data/pagination";
import type { IfcModel } from "@/lib/data/ifc-models";
import { fetchProjectModels } from "@/lib/project/models";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** ifc_guid -> objects.id (active records of live nodes of the project, D-189). */
export type GuidMap = Record<string, string>;

export type { IfcModel } from "@/lib/data/ifc-models";

/**
 * IFC models of the project with their current revision (D-086, D-189): containers with a current
 * revision from the DB, not a hardcoded list. Without cache: after the "new revision" message
 * (`router.refresh()`) the page must see the new revision right away. On error an empty list (the viewer
 * shows that the model is missing), not the models of another project.
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
  // Paginated: after the VZT federation (D-049) there are > 1000 active GUID records
  // and PostgREST (db-max-rows) would silently truncate the map - elements over the limit would have no
  // AIM card in the viewer's 3D (the GUID->id would not resolve).
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

/** Cached GUID map (ISR 60 s, D-029). */
export const fetchGuidMap = cachedProjectRead("ifc-guid-map", fetchGuidMapImpl);
