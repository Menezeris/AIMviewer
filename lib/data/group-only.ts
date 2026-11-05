/**
 * MEP "grouping" classes (D-049, the `group_only` list in `etl/scheme.py`): piping, fittings and distribution,
 * where the instance does not matter. Since D-183 K3 they have a storey from the file in the data
 * (`rel_contained_in_spatial_structure` from the revision copy); the exception remains only in the tree, which does not show them
 * under the storey (otherwise they would flood it), they are reachable via the system or a direct link.
 */
export const GROUP_ONLY_IFC_TYPES: ReadonlySet<string> = new Set([
  "IfcDuctSegment",
  "IfcDuctFitting",
  "IfcPipeSegment",
  "IfcPipeFitting",
  "IfcCableSegment",
  "IfcCableFitting",
  "IfcCableCarrierSegment",
  "IfcCableCarrierFitting",
]);

/** An element is not shown in the tree under the spatial structure (only a system member, D-049). */
export function isGroupOnly(row: { object_type: string; ifc_type: string | null }): boolean {
  return row.object_type === "asset" && row.ifc_type !== null && GROUP_ONLY_IFC_TYPES.has(row.ifc_type);
}

/**
 * Tree edges `[child, parent]` from aggregation and placement. Since D-183 K3 `rel_aggregates` also carries assemblies from the
 * file (a railing in the staircase); an element (`asset`) has a parent in the tree only from placement, so an assembly part is therefore
 * not taken from aggregation (otherwise it would be both under the storey and under the staircase). An edge outside the graph or with a side without an
 * AIM node (null) drops out.
 */
export function treeEdges(
  aggregates: readonly { from_id: string | null; to_id: string | null }[],
  contained: readonly { from_id: string | null; to_id: string | null }[],
  byId: ReadonlyMap<string, { object_type: string }>,
): [string, string][] {
  const out: [string, string][] = [];
  const push = (from: string | null, to: string | null, skipAsset: boolean) => {
    if (!from || !to) return;
    const child = byId.get(from);
    if (!child || !byId.has(to)) return;
    if (skipAsset && child.object_type === "asset") return;
    out.push([from, to]);
  };
  for (const r of aggregates) push(r.from_id, r.to_id, true);
  for (const r of contained) push(r.from_id, r.to_id, false);
  return out;
}
