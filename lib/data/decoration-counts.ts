import type { GuidMap } from "@/lib/data/ifc";

/**
 * AIM tree decorations (D-077) - pure aggregation of link counts per object,
 * keyed by IFC GlobalId for the bridge message AIM_TREE_DECORATIONS.
 *
 * Deliberately WITHOUT `server-only`/DB dependencies (pattern `capture-placement.ts`):
 * the aggregation is unit-testable, the DB read lives in `decorations.ts`.
 */

/** Compact counts for the badge in the viewer tree: d=documents, r=responsibilities, c=images. */
export interface TreeDecoration {
  d?: number;
  r?: number;
  c?: number;
}

/** Per-GUID map of decorations - payload of the bridge message AIM_TREE_DECORATIONS. */
export type TreeDecorations = Record<string, TreeDecoration>;

/**
 * Link rows (already filtered to active) -> per-GUID counts. Objects without a GUID
 * (not in the model) are silently skipped - the badge belongs only to elements in the 3D tree.
 *
 * @param guidMap  ifc_guid -> objects.id (fetchGuidMap)
 * @param docObjectIds   object (from_id) for each document link
 * @param respObjectIds  object (to_id) for each responsibility link
 * @param capSpaceIds    space (to_id) for each capture -> space link
 */
export function buildDecorations(
  guidMap: GuidMap,
  docObjectIds: readonly string[],
  respObjectIds: readonly string[],
  capSpaceIds: readonly string[]
): TreeDecorations {
  const guidByObjectId = new Map<string, string>();
  for (const [guid, objectId] of Object.entries(guidMap)) {
    guidByObjectId.set(objectId, guid);
  }

  const out: TreeDecorations = {};
  const bump = (objectId: string, key: keyof TreeDecoration) => {
    const guid = guidByObjectId.get(objectId);
    if (!guid) return;
    const deco = (out[guid] ??= {});
    deco[key] = (deco[key] ?? 0) + 1;
  };

  for (const id of docObjectIds) bump(id, "d");
  for (const id of respObjectIds) bump(id, "r");
  for (const id of capSpaceIds) bump(id, "c");
  return out;
}
