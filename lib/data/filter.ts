import "server-only";

import { cachedProjectRead } from "@/lib/data/revalidate";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** Returns object_ids of assets with the given IFC type. */
export const fetchByIfcType = cachedProjectRead(
  "filter-by-ifc-type",
  async (projectId: string, ifcType: string): Promise<string[]> => {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("objects")
      .select("id")
      .eq("project_id", projectId)
      .eq("ifc_type", ifcType)
      .eq("object_type", "asset")
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.id as string);
  },
);

/** Returns object_ids of assets whose classification code starts with prefix.
 *  Queries v_asset_classifications (union of occurrence + inherited type classifications). */
export const fetchByClassificationPrefix = cachedProjectRead(
  "filter-by-classification",
  async (projectId: string, prefix: string): Promise<string[]> => {
    const supabase = getSupabaseAdmin();

    // Step 1: find matching classification reference IDs
    const { data: refRows, error: refErr } = await supabase
      .from("classification_references")
      .select("id")
      .like("identification", `${prefix}%`);
    if (refErr) throw new Error(refErr.message);
    const refIds = (refRows ?? []).map((r) => r.id as string);
    if (refIds.length === 0) return [];

    // Step 2: find assets linked to those references (union: occurrence + inherited)
    const { data, error } = await supabase
      .from("v_asset_classifications")
      .select("object_id")
      .eq("project_id", projectId)
      .in("classification_ref_id", refIds);
    if (error) throw new Error(error.message);

    return [...new Set((data ?? []).map((r) => r.object_id as string))];
  },
);

/** Finds the direct space parent of an asset and all its sibling assets in that space. */
export async function fetchSpaceSiblings(
  projectId: string,
  objectId: string
): Promise<{ spaceId: string | null; siblingObjectIds: string[] }> {
  const supabase = getSupabaseAdmin();

  // Find parent of this object
  const { data: parentRows, error: parentErr } = await supabase
    .from("rel_contained_in_spatial_structure")
    .select("to_id")
    .eq("project_id", projectId)
    .eq("from_id", objectId)
    .is("valid_until", null)
    .limit(1);
  if (parentErr || !parentRows?.[0]?.to_id) return { spaceId: null, siblingObjectIds: [] };

  const spaceId = parentRows[0].to_id as string;

  // Confirm parent is actually a space
  const { data: spaceRow, error: spaceErr } = await supabase
    .from("objects")
    .select("id, object_type")
    .eq("project_id", projectId)
    .eq("id", spaceId)
    .limit(1);
  if (spaceErr || !spaceRow?.length || spaceRow[0].object_type !== "space") {
    return { spaceId: null, siblingObjectIds: [] };
  }

  // All assets in that space
  const { data: siblingRows, error: siblingErr } = await supabase
    .from("rel_contained_in_spatial_structure")
    .select("from_id")
    .eq("project_id", projectId)
    .eq("to_id", spaceId)
    .is("valid_until", null);
  if (siblingErr) throw new Error(siblingErr.message);

  // an element without an AIM node (D-183 K3) has from_id null
  const siblingObjectIds = (siblingRows ?? []).flatMap((r) => (r.from_id ? [r.from_id as string] : []));
  return { spaceId, siblingObjectIds };
}
