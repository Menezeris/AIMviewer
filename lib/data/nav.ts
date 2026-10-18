import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";

/**
 * Navigačné zoznamy ne-priestorových uzlov pre sidebar (typy assetov, osoby,
 * organizácie, dokumenty). Priestorová hierarchia má vlastný strom (D-027);
 * tieto uzly polohu nemajú, preto sa zobrazia ako ploché zoznamy. Jeden dotaz,
 * `cache()` dedupe na request. Server-side cez `service_role` (D-026).
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

export const fetchSidebarNav = unstable_cache(async (): Promise<SidebarNavData> => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("objects")
    .select("id, object_type, object_ref, name")
    .in("object_type", NAV_TYPES as unknown as string[])
    .is("valid_until", null); // zaniknuté objekty (D-088)
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
}, ["sidebar-nav"], AIM_CACHE);
