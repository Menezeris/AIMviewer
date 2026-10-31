import "server-only";

import { fetchAllPages } from "../data/pagination";
import { getSupabaseAdmin } from "../supabase/server";

import { lookupGuids } from "./aim-lookup";

const IN_CHUNK = 100;

/**
 * IFC GlobalId prvku -> názov systému z grafu AIM (D-164): GUID -> uzol (`ifc_guid_history`),
 * uzol -> systém cez `rel_assigns_to_group` (uzly `object_type='system'`). Prvok bez
 * systému v mape nie je. Read-only, `service_role` (D-026).
 */
export async function systemsOfGuids(guids: string[]): Promise<Map<string, string>> {
  const nodes = await lookupGuids(guids);
  const guidByNode = new Map<string, string>();
  for (const [guid, n] of nodes) guidByNode.set(n.object_id, guid);
  const supabase = getSupabaseAdmin();
  const edges: { from_id: string; to_id: string }[] = [];
  const ids = [...guidByNode.keys()];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    edges.push(
      ...(await fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
        supabase.from("rel_assigns_to_group").select("from_id, to_id").in("from_id", chunk).is("valid_until", null).not("to_id", "is", null).order("id").range(from, to),
      )),
    );
  }
  const groupIds = [...new Set(edges.map((e) => e.to_id))];
  const names = new Map<string, string>();
  for (let i = 0; i < groupIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, name, object_ref")
      .in("id", groupIds.slice(i, i + IN_CHUNK))
      .eq("object_type", "system")
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { id: string; name: string | null; object_ref: string | null }[]) names.set(o.id, o.name ?? o.object_ref ?? o.id);
  }
  const out = new Map<string, string>();
  for (const e of edges) {
    const guid = guidByNode.get(e.from_id);
    const name = names.get(e.to_id);
    if (guid && name && !out.has(guid)) out.set(guid, name);
  }
  return out;
}
