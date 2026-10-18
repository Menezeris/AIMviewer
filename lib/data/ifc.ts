import "server-only";

import { unstable_cache } from "next/cache";

import { AIM_CACHE } from "@/lib/data/constants";
import { fetchAllPages } from "@/lib/data/pagination";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** ifc_guid → objects.id (aktívne záznamy, valid_until IS NULL). */
export type GuidMap = Record<string, string>;

export { getIfcModels, type IfcModel } from "@/lib/data/ifc-models";

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
