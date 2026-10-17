import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { AimRef } from "./join";

/** Dávka pre `.in()` filtre (limit dĺžky URL v PostgREST), ako v lib/llm/tools.ts. */
const IN_CHUNK = 100;

/**
 * IFC GlobalId -> uzol AIM (aktívny GUID v `ifc_guid_history`, D-010).
 * Read-only cez `service_role` (D-026).
 */
export async function lookupGuids(guids: string[]): Promise<Map<string, AimRef>> {
  const supabase = getSupabaseAdmin();
  const objectByGuid = new Map<string, string>();
  for (let i = 0; i < guids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("ifc_guid_history")
      .select("ifc_guid, object_id")
      .in("ifc_guid", guids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { ifc_guid: string; object_id: string }[]) {
      if (row.ifc_guid && row.object_id) objectByGuid.set(row.ifc_guid, row.object_id);
    }
  }

  const ids = [...new Set(objectByGuid.values())];
  const objects = new Map<string, AimRef>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_ref, name, object_type")
      .in("id", ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { id: string; object_ref: string | null; name: string | null; object_type: string }[]) {
      objects.set(o.id, { object_id: o.id, object_ref: o.object_ref, name: o.name, object_type: o.object_type });
    }
  }

  const out = new Map<string, AimRef>();
  for (const [guid, oid] of objectByGuid) {
    const o = objects.get(oid);
    if (o) out.set(guid, o);
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** objects.id alebo object_ref -> aktívny IFC GUID (prvky bez GUID sa vynechajú). */
export async function resolveTargetsToGuids(targets: string[]): Promise<Map<string, string>> {
  const supabase = getSupabaseAdmin();
  const idByTarget = new Map<string, string>();
  const uuids = targets.filter((t) => UUID_RE.test(t));
  const refs = targets.filter((t) => !UUID_RE.test(t));
  for (const [col, vals] of [["id", uuids], ["object_ref", refs]] as const) {
    for (let i = 0; i < vals.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_ref")
        .in(col, vals.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const o of (data ?? []) as { id: string; object_ref: string | null }[]) {
        idByTarget.set(col === "id" ? o.id : (o.object_ref as string), o.id);
      }
    }
  }
  const ids = [...new Set(idByTarget.values())];
  const guidById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("ifc_guid_history")
      .select("object_id, ifc_guid")
      .in("object_id", ids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { object_id: string; ifc_guid: string }[]) {
      if (row.object_id && row.ifc_guid) guidById.set(row.object_id, row.ifc_guid);
    }
  }
  const out = new Map<string, string>();
  for (const [target, id] of idByTarget) {
    const g = guidById.get(id);
    if (g) out.set(target, g);
  }
  return out;
}
