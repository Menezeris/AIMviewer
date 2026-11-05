import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";
import { fetchAllPages } from "@/lib/data/pagination";
import { fetchGuidMap } from "@/lib/data/ifc";
import { buildDecorations, type TreeDecorations } from "@/lib/data/decoration-counts";

/**
 * AIM tree decorations (D-077) - per-GUID counts of active links (documents,
 * responsibilities, images) for the badge in the native tree of the embed viewer. Reads
 * the existing canonical views over `relationships` (D-051), no migration.
 * Paginated (PostgREST cap 1000) and cached (ISR tag `aim`, D-030).
 */

async function fetchTreeDecorationsImpl(projectId: string): Promise<TreeDecorations> {
  const supabase = getSupabaseAdmin();

  const [guidMap, docRows, respRows, capRows] = await Promise.all([
    fetchGuidMap(projectId),
    // Documents on an object: rel_associates_document.from_id = object.
    fetchAllPages<{ from_id: string | null }>((from, to) =>
      supabase
        .from("rel_associates_document")
        .select("from_id")
        .eq("project_id", projectId)
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Responsibilities: rel_assigns_to_actor.to_id = object (from = actor).
    fetchAllPages<{ to_id: string | null }>((from, to) =>
      supabase
        .from("rel_assigns_to_actor")
        .select("to_id")
        .eq("project_id", projectId)
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Reality Capture: aim_rel_capture_located.to_id = space (from = capture).
    fetchAllPages<{ to_id: string | null }>((from, to) =>
      supabase
        .from("aim_rel_capture_located")
        .select("to_id")
        .eq("project_id", projectId)
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  return buildDecorations(
    guidMap,
    docRows.map((r) => r.from_id).filter((v): v is string => !!v),
    respRows.map((r) => r.to_id).filter((v): v is string => !!v),
    capRows.map((r) => r.to_id).filter((v): v is string => !!v)
  );
}

/** Cached decorations (ISR 60 s; revalidated by the `aim` tag after ETL). */
export const fetchTreeDecorations = cachedProjectRead("fetch-tree-decorations", fetchTreeDecorationsImpl);
