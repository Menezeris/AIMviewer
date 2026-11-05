import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { AimSelectionInfo, SelectionContext } from "./selection-summary";

/** Dávka pre `.in()` filtre (limit dĺžky URL v PostgREST), ako v lib/engine/aim-lookup.ts. */
const IN_CHUNK = 100;

interface Obj {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  object_type: string;
}
interface Edge {
  from_id: string;
  to_id: string;
}

/** Uzly, ktoré nie sú rodičovská zostava, ale priestorová štruktúra. */
const SPATIAL = new Set(["site", "building", "floor", "space", "project"]);

/**
 * IFC GlobalId -> objekt AIM s IFC triedou, podlažím a rodičovskou zostavou (D-093).
 * Podlažie: `rel_contained_in_spatial_structure` prvku (priestor -> podlažie cez
 * `rel_aggregates`), inak kontajner jeho zostavy. Zostava: `rel_aggregates` na
 * nepriestorový uzol. Read-only cez `service_role` (D-026), zaniknuté objekty nie (D-088).
 */
export async function lookupSelectionContext(guids: string[]): Promise<SelectionContext> {
  const supabase = getSupabaseAdmin();

  const chunked = async <T>(values: string[], fetch: (part: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const out: T[] = [];
    for (let i = 0; i < values.length; i += IN_CHUNK) {
      const { data, error } = await fetch(values.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as T[]));
    }
    return out;
  };
  const objects = new Map<string, Obj>();
  const loadObjects = async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !objects.has(id));
    const rows = await chunked<Obj>(missing, (part) =>
      supabase
        .from("objects")
        .select("id, object_ref, name, ifc_type, object_type")
        .in("id", part)
        .is("valid_until", null),
    );
    for (const o of rows) objects.set(o.id, o);
  };
  const edges = async (view: string, from: string[]) => {
    const rows = await chunked<Edge>([...new Set(from)], (part) =>
      supabase.from(view).select("from_id, to_id").in("from_id", part).is("valid_until", null),
    );
    const m = new Map<string, string>();
    for (const r of rows) if (r.to_id) m.set(r.from_id, r.to_id); // kontajner bez uzla AIM (D-183 K3)
    return m;
  };

  const history = await chunked<{ ifc_guid: string; object_id: string }>(guids, (part) =>
    supabase.from("ifc_guid_history").select("ifc_guid, object_id").in("ifc_guid", part).is("valid_until", null),
  );
  const objectByGuid = new Map(history.filter((r) => r.ifc_guid && r.object_id).map((r) => [r.ifc_guid, r.object_id]));
  const ids = [...new Set(objectByGuid.values())];
  if (ids.length === 0) return new Map();
  await loadObjects(ids);

  // Zostava (rel_aggregates dieťa -> rodič) a kontajner prvku aj zostavy.
  const aggregate = await edges("rel_aggregates", ids);
  await loadObjects([...aggregate.values()]);
  const assembly = (id: string) => {
    const p = aggregate.get(id);
    const o = p ? objects.get(p) : undefined;
    return o && !SPATIAL.has(o.object_type) ? o : undefined;
  };
  const containedFrom = [...ids, ...ids.map((id) => assembly(id)?.id).filter((v): v is string => Boolean(v))];
  const contained = await edges("rel_contained_in_spatial_structure", containedFrom);
  await loadObjects([...contained.values()]);
  const spaces = [...contained.values()].filter((id) => objects.get(id)?.object_type === "space");
  const floorBySpace = await edges("rel_aggregates", spaces);
  await loadObjects([...floorBySpace.values()]);

  const floorOf = (id: string | undefined): Obj | undefined => {
    if (!id) return undefined;
    const c = objects.get(contained.get(id) ?? "");
    if (c?.object_type === "floor") return c;
    if (c?.object_type === "space") return objects.get(floorBySpace.get(c.id) ?? "");
    return undefined;
  };

  const out: SelectionContext = new Map();
  for (const [guid, oid] of objectByGuid) {
    const o = objects.get(oid);
    if (!o) continue;
    const asm = assembly(oid);
    const floor = o.object_type === "floor" ? o : (floorOf(oid) ?? floorOf(asm?.id));
    const info: AimSelectionInfo = {
      object_id: o.id,
      object_ref: o.object_ref,
      name: o.name,
      ifc_type: o.ifc_type,
      floor: floor ? (floor.object_ref ?? floor.name) : null,
      parent: asm ? { object_ref: asm.object_ref, name: asm.name, ifc_type: asm.ifc_type } : null,
    };
    out.set(guid, info);
  }
  return out;
}
