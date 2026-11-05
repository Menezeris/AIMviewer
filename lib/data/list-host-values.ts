import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LIST_HOST_MAX_VALUES, LIST_HOST_MAX_VALUE_LENGTH, type ListHostKey, type ListHostValues } from "@/lib/viewer-list";

import { fetchAllPages } from "./pagination";

/**
 * Hodnoty host stĺpcov panela Lists (D-174, #277): odvodené väzby z `v_space_elements` (D-167, geometria) ako
 * `GlobalId prvku -> text`. Viewer ich zobrazí v stĺpci `source: "host"`; kľúč stĺpca určuje, ktorá väzba to je.
 * Zaniknuté prvky a priestory (`valid_until`, D-088) sa nezobrazia.
 */

const RELATION: Record<ListHostKey, string> = { derived_referenced: "referenced", derived_boundary: "boundary" };
const IN_CHUNK = 100;
const CONCURRENCY = 6;

interface EdgeRow {
  space_id: string;
  space_ref: string | null;
  space_name: string | null;
  element_id: string;
  role: string | null;
}

async function mapChunks<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  const out: R[] = [];
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    for (const part of await Promise.all(chunks.slice(i, i + CONCURRENCY).map(fn))) out.push(...part);
  }
  return out;
}

export interface HostValuesResult {
  values: ListHostValues;
  /** Prvkov s hodnotou. */
  count: number;
  /** Viac prvkov, než prenesie stĺpec (strop `LIST_HOST_MAX_VALUES`). */
  truncated: boolean;
}

export async function loadListHostValues(key: ListHostKey): Promise<HostValuesResult> {
  const supabase = getSupabaseAdmin();
  const edges = await fetchAllPages<EdgeRow>((from, to) =>
    supabase
      .from("v_space_elements")
      .select("space_id, space_ref, space_name, element_id, role")
      .eq("relation", RELATION[key])
      .order("element_id")
      .order("space_id")
      .range(from, to),
  );
  if (edges.length === 0) return { values: {}, count: 0, truncated: false };

  const live = async (ids: string[], columns: string) =>
    mapChunks(ids, IN_CHUNK, async (chunk) => {
      const { data, error } = await supabase.from("objects").select(columns).in("id", chunk).is("valid_until", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Array<{ id: string; ifc_guid: string | null }>;
    });
  const [elements, spaces] = await Promise.all([
    live([...new Set(edges.map((e) => e.element_id))], "id, ifc_guid"),
    live([...new Set(edges.map((e) => e.space_id))], "id"),
  ]);
  const guidOf = new Map(elements.filter((e) => e.ifc_guid).map((e) => [e.id, e.ifc_guid as string]));
  const liveSpaces = new Set(spaces.map((s) => s.id));

  const perGuid = new Map<string, Set<string>>();
  for (const e of edges) {
    const guid = guidOf.get(e.element_id);
    const label = e.space_ref ?? e.space_name;
    if (!guid || !label || !liveSpaces.has(e.space_id)) continue;
    // Odvodená referencia, ktorá prvok len pretína (role partial), sa označí; inside = celý v priestore.
    const text = key === "derived_referenced" && e.role === "partial" ? `${label} (čiastočne)` : label;
    const set = perGuid.get(guid) ?? new Set<string>();
    set.add(text);
    perGuid.set(guid, set);
  }
  const entries = [...perGuid.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const values: ListHostValues = {};
  for (const [guid, texts] of entries.slice(0, LIST_HOST_MAX_VALUES)) {
    values[guid] = [...texts].sort().join(", ").slice(0, LIST_HOST_MAX_VALUE_LENGTH);
  }
  return { values, count: entries.length, truncated: entries.length > LIST_HOST_MAX_VALUES };
}
