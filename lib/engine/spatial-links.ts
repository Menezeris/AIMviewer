import "server-only";

import { fetchAllPages } from "../data/pagination";
import { getSupabaseAdmin } from "../supabase/server";

import { lookupGuids } from "./aim-lookup";
import type { SpatialLink } from "./tools";

const IN_CHUNK = 100;
/** Strop odvodených väzieb jedného dopytu (miestnosť s tisíckami prvkov nezahltí volanie). */
const MAX_LINKS = 5000;

/**
 * Odvodené IfcRelReferencedInSpatialStructure (D-080) z grafu AIM pre `ifc_relations` (D-167):
 * prvok -> priestor aj priestor -> prvky, naprieč modelmi federácie (VZT výustka -> IfcSpace z ASR).
 * V IFC súbore tieto hrany nie sú, vznikajú geometriou v `python -m etl.derive`; panel vlastností
 * ich číta z DB, preto ich tu doplníme k tým zo súboru. Read-only, `service_role` (D-026).
 */
export async function spatialLinksOfGuid(guid: string): Promise<SpatialLink[]> {
  const node = (await lookupGuids([guid])).get(guid);
  if (!node) return [];
  const supabase = getSupabaseAdmin();
  const edges = await fetchAllPages<{ from_id: string; to_id: string; role: string | null }>((from, to) =>
    supabase
      .from("rel_referenced_in_spatial_structure")
      .select("from_id, to_id, role")
      .or(`from_id.eq.${node.object_id},to_id.eq.${node.object_id}`)
      .is("valid_until", null)
      .order("id")
      .range(from, to),
  );
  const otherIds = [...new Set(edges.slice(0, MAX_LINKS).map((e) => (e.from_id === node.object_id ? e.to_id : e.from_id)))];
  const others = new Map<string, { ifc_guid: string | null; ifc_type: string | null; name: string | null }>();
  for (let i = 0; i < otherIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, ifc_guid, ifc_type, name")
      .in("id", otherIds.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { id: string; ifc_guid: string | null; ifc_type: string | null; name: string | null }[]) others.set(o.id, o);
  }
  const out: SpatialLink[] = [];
  for (const e of edges.slice(0, MAX_LINKS)) {
    const outgoing = e.from_id === node.object_id;
    const o = others.get(outgoing ? e.to_id : e.from_id);
    if (!o?.ifc_guid) continue;
    // from_id = prvok, to_id = priestor: z prvku je priestor Relating strana (inverse), z priestoru sú prvky forward.
    out.push({ direction: outgoing ? "inverse" : "forward", global_id: o.ifc_guid, ifc_type: o.ifc_type ?? "", name: o.name, ...(e.role ? { role: e.role } : {}) });
  }
  return out;
}
