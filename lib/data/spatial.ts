import "server-only";

import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";
import { fetchAllPages } from "@/lib/data/pagination";
import { isGroupOnly, treeEdges } from "@/lib/data/group-only";

/**
 * Data-access layer for the spatial hierarchy (S1).
 *
 * Reads `objects` + active spatial edges (`rel_aggregates` +
 * `rel_contained_in_spatial_structure`, D-048) and assembles the tree
 * Site -> Building -> Floor -> Space -> Asset (D-018, D-021). `asset_type` NEVER
 * appears here (a type has no location).
 *
 * With ~15 nodes we load the whole graph in one go and assemble it in memory -
 * no recursion in the DB. Everything runs server-side via `service_role` (D-026).
 */

export const SPATIAL_TYPES = [
  "site",
  "building",
  "floor",
  "space",
  "asset",
] as const;

export type SpatialType = (typeof SPATIAL_TYPES)[number];

/** Raw row from `objects` (the subset of columns the Viewer needs). */
export interface ObjectRow {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
  elevation: number | null; // only floor (from the `floors` extension)
}

/** Tree node - `ObjectRow` + children. */
export interface SpatialNode extends ObjectRow {
  children: SpatialNode[];
}

/** Shortened link to a node (breadcrumb, list of assets). */
export interface NodeRef {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
}

interface Graph {
  byId: Map<string, ObjectRow>;
  /** to_id (parent) -> from_id[] (children) */
  childrenOf: Map<string, string[]>;
  /** from_id (child) -> to_id (parent) */
  parentOf: Map<string, string>;
}

interface RawSpatialObject {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
}

/**
 * Loads all spatial objects paginated (bypasses the Supabase `db-max-rows`
 * limit of 1000). Stable order via `order(id)` - necessary for correct pagination.
 */
function loadSpatialObjects(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  projectId: string,
): Promise<RawSpatialObject[]> {
  return fetchAllPages<RawSpatialObject>((from, to) =>
    supabase
      .from("objects")
      .select(
        "id, object_type, object_ref, name, ifc_type, ifc_guid, predefined_type"
      )
      .eq("project_id", projectId)
      .in("object_type", SPATIAL_TYPES as unknown as string[])
      .is("valid_until", null) // vanished objects (D-088)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

/** Active spatial edge `from_id (child) -> to_id (parent)`. */
interface RawEdge {
  from_id: string;
  to_id: string;
}

/**
 * Loads all active edges of one spatial view paginated - after the
 * VZT federation there are also > 1000 edges (every asset has a containment edge) and PostgREST
 * would silently truncate them without pagination: elements over the limit would lose their parent
 * and drop out of the tree (parentless assets are omitted).
 */
function loadSpatialEdges(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  view: "rel_aggregates" | "rel_contained_in_spatial_structure",
  projectId: string,
): Promise<RawEdge[]> {
  return fetchAllPages<RawEdge>((from, to) =>
    supabase
      .from(view)
      .select("from_id, to_id")
      .eq("project_id", projectId)
      .is("valid_until", null)
      // A side without an AIM node (D-183 K3) does not belong in the tree.
      .not("from_id", "is", null)
      .not("to_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

/** Serializable form of the graph for `unstable_cache` (Maps do not survive JSON). */
interface GraphData {
  objects: ObjectRow[];
  /** Active spatial edges `[from_id (child), to_id (parent)]`. */
  edges: [string, string][];
}

/**
 * Loads the whole spatial graph with one set of queries and caches it as **one
 * shared record** (ISR, tag `aim`). Key for click-through speed:
 * the tree in the layout and the detail of any node draw from the same cache
 * record, so the first click on a new node triggers no DB queries on the graph
 * (previously `fetchNode` was cached per id -> every new node = the whole graph again).
 */
const loadGraphData = cachedProjectRead("spatial-graph", async (projectId: string): Promise<GraphData> => {
  const supabase = getSupabaseAdmin();

  const [objectRows, aggEdges, containedEdges, floorsRes, spacesRes] = await Promise.all([
    // Spatial objects paginated - Supabase caps the response at 1000 rows
    // (`db-max-rows`), and after the VZT federation (D-049) there are > 1000 assets. Without pagination
    // elements over the limit would be lost from the graph (fetchNode -> 404).
    loadSpatialObjects(supabase, projectId),
    // Spatial links IFC-canonically (D-048): decomposition of the structure (rel_aggregates)
    // + placement of an element (rel_contained_in_spatial_structure). Only active
    // (valid_until IS NULL) - partial-unique on both guarantees 1 parent per child.
    // Also paginated (there are as many edges as elements).
    loadSpatialEdges(supabase, "rel_aggregates", projectId),
    loadSpatialEdges(supabase, "rel_contained_in_spatial_structure", projectId),
    supabase.from("floors").select("id, elevation"),
    supabase.from("spaces").select("id, long_name"),
  ]);

  if (floorsRes.error) throw new Error(floorsRes.error.message);
  if (spacesRes.error) throw new Error(spacesRes.error.message);

  const elevationById = new Map<string, number | null>(
    (floorsRes.data ?? []).map((f) => [f.id as string, f.elevation as number | null])
  );
  const longNameById = new Map<string, string | null>(
    (spacesRes.data ?? []).map((s) => [s.id as string, s.long_name as string | null])
  );

  const byId = new Map<string, ObjectRow>();
  for (const o of objectRows) {
    const id = o.id as string;
    const rawName = (o.name as string | null) ?? null;
    // Space: show "number - function description" (D-040). Name = number (IfcSpace.Name),
    // long_name = IfcSpace.LongName from the `spaces` extension.
    const longName = longNameById.get(id) ?? null;
    const displayName =
      o.object_type === "space" && longName && rawName
        ? `${rawName} — ${longName}`
        : rawName;
    byId.set(id, {
      id,
      object_type: o.object_type as SpatialType,
      object_ref: (o.object_ref as string | null) ?? null,
      name: displayName,
      ifc_type: (o.ifc_type as string | null) ?? null,
      ifc_guid: (o.ifc_guid as string | null) ?? null,
      predefined_type: (o.predefined_type as string | null) ?? null,
      elevation: elevationById.get(id) ?? null,
    });
  }

  // A node is either aggregated (structure) or contained (an element); an assembly part from the file (D-183 K3)
  // has a parent only from placement (treeEdges).
  const edges = treeEdges(aggEdges, containedEdges, byId);

  return { objects: [...byId.values()], edges };
});

/**
 * The graph as Maps (per-request memo via `cache()`) - composition from cached data
 * is purely in-memory (~1-2k nodes, sub-ms), no DB round-trip on a HIT.
 */
const loadGraph = cache(async (projectId: string): Promise<Graph> => {
  const { objects, edges } = await loadGraphData(projectId);

  const byId = new Map<string, ObjectRow>(objects.map((o) => [o.id, o]));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const [from, to] of edges) {
    parentOf.set(from, to);
    // Pipes and fittings (D-049) have a storey since D-183 K3, but are not under it in the tree
    // (they would flood it); the breadcrumb shows their storey.
    if (isGroupOnly(byId.get(from)!)) continue;
    const list = childrenOf.get(to);
    if (list) list.push(from);
    else childrenOf.set(to, [from]);
  }

  return { byId, childrenOf, parentOf };
});

/** Order of children: floors by elevation, otherwise by object_ref/name. */
function compareNodes(a: ObjectRow, b: ObjectRow): number {
  if (a.object_type === "floor" && b.object_type === "floor") {
    return (a.elevation ?? 0) - (b.elevation ?? 0);
  }
  const ka = a.object_ref ?? a.name ?? "";
  const kb = b.object_ref ?? b.name ?? "";
  return ka.localeCompare(kb, "sk");
}

function buildSubtree(id: string, graph: Graph): SpatialNode {
  const row = graph.byId.get(id)!;
  const childIds = graph.childrenOf.get(id) ?? [];
  const children = childIds
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map((c) => buildSubtree(c.id, graph));
  return { ...row, children };
}

/**
 * The whole tree of the spatial hierarchy. Roots = nodes without a parent (typically `site`).
 * A derivative of the cached graph (`loadGraphData`) - assembling is in-memory, no own
 * `unstable_cache` is needed (the route render is additionally cached by the Full Route Cache).
 */
export const fetchSpatialTree = cache(async (projectId: string): Promise<SpatialNode[]> => {
  const graph = await loadGraph(projectId);
  const roots: ObjectRow[] = [];
  for (const row of graph.byId.values()) {
    // Root = a spatial structure without a parent (site). An `asset` without a parent (an element without
    // a storey in the file) does not belong in the tree (reachable via a system / a direct link).
    if (!graph.parentOf.has(row.id) && row.object_type !== "asset") roots.push(row);
  }
  return roots.sort(compareNodes).map((r) => buildSubtree(r.id, graph));
});

export interface NodeDetail {
  node: ObjectRow;
  /** Path from the root to the parent of the node (without the node itself). */
  breadcrumb: NodeRef[];
  /** Direct children (assets under a space, spaces under a floor, ...). */
  children: NodeRef[];
}

function toRef(row: ObjectRow): NodeRef {
  return {
    id: row.id,
    object_type: row.object_type,
    object_ref: row.object_ref,
    name: row.name,
  };
}

/**
 * Detail of a single node + breadcrumb (walking up the spatial edges)
 * and direct children. `null` if the node does not exist / is not spatial.
 * A derivative of the cached graph - the first click on a new node triggers no DB queries
 * (the previous per-id caching reloaded
 * the whole graph at every new node; that was the main latency of a cold click).
 */
export const fetchNode = cache(async (projectId: string, id: string): Promise<NodeDetail | null> => {
  const graph = await loadGraph(projectId);
  const node = graph.byId.get(id);
  if (!node) return null;

  // Breadcrumb: collect the ancestors and reverse to the order root -> ... -> parent.
  const breadcrumb: NodeRef[] = [];
  let cursor = graph.parentOf.get(id);
  const guard = new Set<string>(); // guard against a cycle
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const parent = graph.byId.get(cursor);
    if (parent) breadcrumb.push(toRef(parent));
    cursor = graph.parentOf.get(cursor);
  }
  breadcrumb.reverse();

  const children = (graph.childrenOf.get(id) ?? [])
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map(toRef);

  return { node, breadcrumb, children };
});
