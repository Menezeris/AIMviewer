import "server-only";

import { fetchAllPages } from "../data/pagination";
import { getSupabaseAdmin } from "../supabase/server";

import { lookupGuids } from "./aim-lookup";
import type { SpatialLink } from "./tools";
import { currentProjectId } from "../project/context";

const IN_CHUNK = 100;
/** Ceiling of derived links of one query (a space with thousands of elements does not flood the call). */
const MAX_LINKS = 5000;

/**
 * Derived IfcRelReferencedInSpatialStructure (D-080) from the AIM graph for `ifc_relations` (D-167):
 * element -> space and space -> elements, across federation models (VZT outlet -> IfcSpace from ASR).
 * These edges are not in the IFC file, they arise by geometry in `python -m etl.derive`; the properties panel
 * reads them from the DB, so we add them here to those from the file. Read-only, `service_role` (D-026).
 */
export async function spatialLinksOfGuid(guid: string): Promise<SpatialLink[]> {
  const projectId = currentProjectId();
  const node = (await lookupGuids([guid])).get(guid);
  if (!node) return [];
  const supabase = getSupabaseAdmin();
  const edges = await fetchAllPages<{ from_id: string; to_id: string; role: string | null }>((from, to) =>
    supabase
      .from("rel_referenced_in_spatial_structure")
      .select("from_id, to_id, role")
      .eq("project_id", projectId)
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
      .eq("project_id", projectId)
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
    // from_id = element, to_id = space: from the element the space is the Relating side (inverse), from the space the elements are forward.
    out.push({ direction: outgoing ? "inverse" : "forward", global_id: o.ifc_guid, ifc_type: o.ifc_type ?? "", name: o.name, ...(e.role ? { role: e.role } : {}) });
  }
  return out;
}
