import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";

/**
 * Navigation lists of non-spatial nodes for the sidebar (asset types, persons,
 * organizations, documents). The spatial hierarchy has its own tree (D-027);
 * these nodes have no location, so they are shown as flat lists. One query,
 * `cache()` dedupes per request. Server-side via `service_role` (D-026).
 */

export interface NavItem {
  id: string;
  object_ref: string | null;
  name: string | null;
}

export interface SidebarNavData {
  assetTypes: NavItem[];
  systems: NavItem[];
  persons: NavItem[];
  organizations: NavItem[];
  documents: NavItem[];
}

const NAV_TYPES = ["asset_type", "system", "person", "organization", "document"] as const;

export const fetchSidebarNav = cachedProjectRead("sidebar-nav", async (projectId: string): Promise<SidebarNavData> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .eq("project_id", projectId)
    // D-189: nodes of the project; persons and organizations are global (project_id NULL, A1).
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .in("object_type", NAV_TYPES as unknown as string[])
    .is("valid_until", null); // vanished objects (D-088)
  if (error) throw new Error(error.message);

  const groups: SidebarNavData = {
    assetTypes: [],
    systems: [],
    persons: [],
    organizations: [],
    documents: [],
  };
  const bucket: Record<string, NavItem[]> = {
    asset_type: groups.assetTypes,
    system: groups.systems,
    person: groups.persons,
    organization: groups.organizations,
    document: groups.documents,
  };

  for (const o of data ?? []) {
    const list = bucket[o.object_type as string];
    if (!list) continue;
    list.push({
      id: o.id as string,
      object_ref: (o.object_ref as string | null) ?? null,
      name: (o.name as string | null) ?? null,
    });
  }

  const byLabel = (a: NavItem, b: NavItem) =>
    (a.name ?? a.object_ref ?? "").localeCompare(b.name ?? b.object_ref ?? "", "sk");
  groups.assetTypes.sort(byLabel);
  groups.systems.sort(byLabel);
  groups.persons.sort(byLabel);
  groups.organizations.sort(byLabel);
  groups.documents.sort(byLabel);

  return groups;
});
