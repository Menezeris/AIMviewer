import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { applyOverrides } from "@/lib/data/drawing-link-overrides";
import { fetchOverrides, fetchZones } from "@/lib/data/drawing-link-store";
import { cachedProjectRead } from "@/lib/data/revalidate";
import { fetchAllPages } from "@/lib/data/pagination";
import { parseBlocks } from "@/lib/llm/document-text";
import {
  labelCodes,
  pairLabels,
  resolveLabels,
  resolveZoneLabels,
  toLinksWire,
  type DocumentLinksWire,
  type DrawingLabel,
  type LabelObject,
  type PageLinks,
} from "@/lib/data/drawing-labels";

export type { DocumentLinksWire, PageLinks };

/**
 * Drawing labels as links to an element (D-130): page rows (`document_pages.blocks`,
 * D-123) + the storey of the drawing (carrier of a document of type floor, D-104) + objects with codes
 * from the labels. The pairing is an AIM layer, computed on read, nothing is stored.
 */

/** Storeys that carry the document (a storey floor plan has exactly one). */
async function drawingFloors(projectId: string, documentIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (documentIds.length === 0) return out;
  const supabase = getSupabaseAdmin();
  const { data: rels, error } = await supabase
    .from("rel_associates_document")
    .select("from_id, to_id")
    .eq("project_id", projectId)
    .in("to_id", documentIds)
    .is("valid_until", null)
    .not("from_id", "is", null);
  if (error) throw new Error(error.message);
  const pairs = (rels ?? []) as { from_id: string; to_id: string }[];
  if (pairs.length === 0) return out;
  const { data: floors, error: fErr } = await supabase
    .from("objects")
    .select("id")
    .eq("project_id", projectId)
    .in("id", [...new Set(pairs.map((p) => p.from_id))])
    .eq("object_type", "floor")
    .is("valid_until", null);
  if (fErr) throw new Error(fErr.message);
  const floorIds = new Set(((floors ?? []) as { id: string }[]).map((f) => f.id));
  for (const p of pairs) {
    if (!floorIds.has(p.from_id)) continue;
    const set = out.get(p.to_id) ?? new Set<string>();
    set.add(p.from_id);
    out.set(p.to_id, set);
  }
  return out;
}

type ObjectRow = {
  id: string;
  object_ref: string;
  name: string | null;
  ifc_type: string | null;
  object_type: string;
  ifc_guid: string | null;
};

/** Objects with codes from the labels: exact `object_ref` and occurrences of types (`<type>.%`). */
async function fetchLabelObjects(projectId: string, labels: readonly DrawingLabel[]): Promise<ObjectRow[]> {
  const { refs, typePrefixes } = labelCodes(labels);
  const supabase = getSupabaseAdmin();
  const base = () =>
    supabase
      .from("objects")
      .select("id, object_ref, name, ifc_type, object_type, ifc_guid")
      .eq("project_id", projectId)
      .in("object_type", ["asset", "asset_type", "space"])
      .is("valid_until", null)
      .order("id");
  // Without .or(): codes contain dots, simple filters need no escaping. There are few types on a page.
  const parts = await Promise.all([
    ...(refs.length > 0 ? [fetchAllPages<ObjectRow>((from, to) => base().in("object_ref", refs).range(from, to))] : []),
    ...typePrefixes.map((p) =>
      fetchAllPages<ObjectRow>((from, to) => base().like("object_ref", `${p}.%`).range(from, to))
    ),
  ]);
  const byId = new Map(parts.flat().map((o) => [o.id, o]));
  return [...byId.values()];
}

/**
 * Storey of objects: an element directly on the storey or in a space (rel_contained...),
 * a space via rel_aggregates. Returns the storey id (or null) for each object.
 */
async function floorOf(projectId: string, objects: readonly ObjectRow[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const supabase = getSupabaseAdmin();
  const add = (id: string, floor: string) => {
    const set = out.get(id) ?? new Set<string>();
    set.add(floor);
    out.set(id, set);
  };
  const assetIds = objects.filter((o) => o.object_type === "asset").map((o) => o.id);
  const spaceIds = objects.filter((o) => o.object_type === "space").map((o) => o.id);
  const contained = assetIds.length
    ? await fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
        supabase
          .from("rel_contained_in_spatial_structure")
          .select("from_id, to_id")
          .eq("project_id", projectId)
          .in("from_id", assetIds)
          .is("valid_until", null)
          .order("from_id")
          .range(from, to)
      )
    : [];
  // Parent of a space (also of spaces that contain elements) = the storey.
  // A container without an AIM node (a model storey without a counterpart, D-183 K3) has no to_id.
  const spaces = [...new Set([...spaceIds, ...contained.flatMap((c) => (c.to_id ? [c.to_id] : []))])];
  const aggregates = spaces.length
    ? await fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
        supabase
          .from("rel_aggregates")
          .select("from_id, to_id")
          .eq("project_id", projectId)
          .in("from_id", spaces)
          .is("valid_until", null)
          .not("to_id", "is", null)
          .order("from_id")
          .range(from, to)
      )
    : [];
  const parent = new Map(aggregates.map((a) => [a.from_id, a.to_id]));
  for (const c of contained) {
    if (!c.to_id) continue;
    add(c.from_id, c.to_id);
    const up = parent.get(c.to_id);
    if (up) add(c.from_id, up);
  }
  for (const id of spaceIds) {
    const up = parent.get(id);
    if (up) add(id, up);
  }
  return out;
}

async function fetchDocumentLinksImpl(projectId: string, documentId: string, page: number | null): Promise<PageLinks[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from("document_pages").select("page, blocks").eq("document_id", documentId).order("page");
  if (page !== null) query = query.eq("page", page);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const pages = ((data ?? []) as { page: number; blocks: unknown }[]).map((p) => {
    const blocks = parseBlocks(p.blocks);
    return { page: p.page, blocks, labels: pairLabels(blocks) };
  });
  const zones = await fetchZones(projectId);
  const manual = await fetchOverrides(projectId, documentId, page, zones);
  const all = pages.flatMap((p) => p.labels);

  const [floors, objects] = all.length
    ? await Promise.all([
        drawingFloors(projectId, [documentId]).then((m) => m.get(documentId) ?? new Set<string>()),
        fetchLabelObjects(projectId, all),
      ])
    : [new Set<string>(), [] as ObjectRow[]];
  const floorsOf = await floorOf(projectId, objects);
  const labelObjects: LabelObject[] = objects.map((o) => ({
    id: o.id,
    ref: o.object_ref,
    guid: o.ifc_guid,
    name: o.name,
    ifcType: o.ifc_type,
    objectType: o.object_type,
    onFloor: [...(floorsOf.get(o.id) ?? [])].some((f) => floors.has(f)),
  }));
  return pages.map((p) => {
    const auto = [...resolveLabels(p.labels, labelObjects), ...resolveZoneLabels(p.blocks, zones, p.labels)];
    const links = applyOverrides(auto, p.blocks, manual.filter((o) => o.page === p.page));
    return { page: p.page, links };
  });
}

/** Links from the labels of the pages of a document (all pages or one), ISR tag `aim`. */
export const fetchDocumentLinks = cachedProjectRead("fetch-document-links", fetchDocumentLinksImpl);

/**
 * Links for storey floor plans in the viewer (documents with `storeyGuid` in `DOCUMENTS_LOAD`):
 * the host sends them after the document library. Other documents get links only once there is a
 * storey for them too (sections, schedules) - pairing of type codes needs it.
 */
export async function fetchViewerDocumentLinks(projectId: string, documentIds: readonly string[]): Promise<DocumentLinksWire[]> {
  const results = await Promise.all(
    documentIds.map(async (id) => toLinksWire(id, await fetchDocumentLinks(projectId, id, null)))
  );
  return results.flat();
}
