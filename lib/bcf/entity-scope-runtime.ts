import "server-only";

import { fetchAllPages } from "../data/pagination";
import { normalizeStoreyLabel } from "../engine/storey";
import { IFC_GUID_RE } from "../engine/tools";
import { getSupabaseAdmin } from "../supabase/server";

import type { EntityScope } from "./entity-scope";
import { BcfInputError } from "./tools";

/**
 * Rozsah entity pre `bcf_topic_list entity` (D-158 krok 4) z grafu AIM: entita podľa
 * objects.id, GlobalId, object_ref, podlažia (1NP = 1.NP) alebo slova "projekt"; potomkovia
 * cez `rel_aggregates` (budova -> podlažie -> priestor), prvky cez contained a referenced
 * (D-080), dokumenty cez `rel_associates_document` entity a jej priestorových uzlov.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 200;
/** Hĺbka dekompozície projekt -> lokalita -> budova -> podlažie -> priestor (+ rezerva). */
const MAX_DEPTH = 6;

interface Node {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_guid: string | null;
}

const COLS = "id, object_type, object_ref, name, ifc_guid";

/** `.in` po dávkach a stránkach (PostgREST vracia najviac 1000 riadkov naraz). */
async function fetchIn<T>(table: string, cols: string, key: string, values: string[], activeOnly = true): Promise<T[]> {
  const db = getSupabaseAdmin();
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    out.push(
      ...(await fetchAllPages<T>((from, to) => {
        let q = db.from(table).select(cols).in(key, chunk);
        if (activeOnly) q = q.is("valid_until", null);
        return q.order("id").range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
      })),
    );
  }
  return out;
}

async function findEntity(raw: string): Promise<Node> {
  const want = raw.trim();
  const db = getSupabaseAdmin();
  const objects = () => db.from("objects").select(COLS).is("valid_until", null);
  if (/^(projekt|project|ifcproject)$/i.test(want)) {
    const { data, error } = await objects().eq("object_type", "project").limit(2);
    if (error) throw new Error(error.message);
    if (data?.length === 1) return data[0] as Node;
    throw new BcfInputError("IfcProject v AIM nie je jednoznačný; zadaj jeho GlobalId alebo object_ref.");
  }
  const tries: [string, string][] = [];
  if (UUID_RE.test(want)) tries.push(["id", want.toLowerCase()]);
  if (IFC_GUID_RE.test(want)) tries.push(["ifc_guid", want]);
  tries.push(["object_ref", want]);
  for (const [col, val] of tries) {
    const { data, error } = await objects().eq(col, val).limit(2);
    if (error) throw new Error(error.message);
    if (data?.length === 1) return data[0] as Node;
  }
  // Podlažie zápisom ako v ostatných tooloch (1NP = 1.NP = 1 NP).
  const { data: floors, error } = await objects().eq("object_type", "floor");
  if (error) throw new Error(error.message);
  const norm = normalizeStoreyLabel(want);
  const floor = ((floors ?? []) as Node[]).find((f) => normalizeStoreyLabel(f.object_ref ?? "") === norm || normalizeStoreyLabel(f.name ?? "") === norm);
  if (floor) return floor;
  throw new BcfInputError(
    `Entita '${want}' v AIM nie je (objects.id, IFC GlobalId, object_ref, podlažie ako 1NP alebo 'projekt'; search_objects ju nájde).`,
  );
}

export async function entityScope(raw: string): Promise<EntityScope> {
  const node = await findEntity(raw);
  const label = node.object_ref ?? node.name ?? node.id;
  const self = node.ifc_guid;
  if (node.object_type === "project") {
    return { label, object_type: node.object_type, self, guids: new Set(self ? [self] : []), documents: new Set() };
  }
  // Priestorové uzly pod entitou (budova -> podlažie -> priestor).
  const containers = new Set([node.id]);
  let frontier = [node.id];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const kids = await fetchIn<{ from_id: string | null }>("rel_aggregates", "id, from_id", "to_id", frontier);
    // Časť bez uzla AIM (D-183 K3) má from_id null.
    frontier = kids.flatMap((k) => (k.from_id && !containers.has(k.from_id) ? [k.from_id] : []));
    for (const id of frontier) containers.add(id);
  }
  const ids = new Set(containers);
  for (const rel of ["rel_contained_in_spatial_structure", "rel_referenced_in_spatial_structure"]) {
    // Prvok bez uzla AIM (D-183 K3) má from_id null.
    for (const r of await fetchIn<{ from_id: string | null }>(rel, "id, from_id", "to_id", [...containers])) {
      if (r.from_id) ids.add(r.from_id);
    }
  }
  const guids = new Set<string>();
  for (const o of await fetchIn<{ ifc_guid: string | null }>("objects", "id, ifc_guid", "id", [...ids])) {
    if (o.ifc_guid) guids.add(o.ifc_guid);
  }
  const documents = new Set(
    (await fetchIn<{ to_id: string | null }>("rel_associates_document", "id, to_id", "from_id", [...containers])).flatMap((r) =>
      r.to_id ? [r.to_id] : [],
    ),
  );
  return { label, object_type: node.object_type, self, guids, documents };
}
