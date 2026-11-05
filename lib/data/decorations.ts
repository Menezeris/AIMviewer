import "server-only";

import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";
import { fetchAllPages } from "@/lib/data/pagination";
import { fetchGuidMap } from "@/lib/data/ifc";
import { buildDecorations, type TreeDecorations } from "@/lib/data/decoration-counts";

/**
 * AIM dekorácie stromu (D-077) — per-GUID počty aktívnych väzieb (dokumenty,
 * zodpovednosti, snímky) pre badge v natívnom strome embed viewera. Číta
 * existujúce kanonické views nad `relationships` (D-051), žiadna migrácia.
 * Stránkovane (PostgREST cap 1000) a cachované (ISR tag `aim`, D-030).
 */

async function fetchTreeDecorationsImpl(): Promise<TreeDecorations> {
  const supabase = getSupabaseAdmin();

  const [guidMap, docRows, respRows, capRows] = await Promise.all([
    fetchGuidMap(),
    // Dokumenty na objekte: rel_associates_document.from_id = objekt.
    fetchAllPages<{ from_id: string | null }>((from, to) =>
      supabase
        .from("rel_associates_document")
        .select("from_id")
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Zodpovednosti: rel_assigns_to_actor.to_id = objekt (from = aktor).
    fetchAllPages<{ to_id: string | null }>((from, to) =>
      supabase
        .from("rel_assigns_to_actor")
        .select("to_id")
        .is("valid_until", null)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Reality Capture: aim_rel_capture_located.to_id = priestor (from = capture).
    fetchAllPages<{ to_id: string | null }>((from, to) =>
      supabase
        .from("aim_rel_capture_located")
        .select("to_id")
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

/** Cachované dekorácie (ISR 60 s; revaliduje sa tagom `aim` po ETL). */
export const fetchTreeDecorations = unstable_cache(
  fetchTreeDecorationsImpl,
  ["fetch-tree-decorations"],
  AIM_CACHE
);
