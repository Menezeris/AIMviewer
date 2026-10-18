import { NextResponse } from "next/server";

import { fetchNodeSummary } from "@/lib/data/object";
import { fetchNodeSections } from "@/lib/data/relations";
import { fetchCaptureSummaryForObject } from "@/lib/data/captures";
import { fetchDerivedRelations } from "@/lib/data/derivations";
import type { ElementDetail } from "@/lib/aim-panel";

/**
 * Detail prvku pre AIM inspector v 3D (D-077) a bočný info-panel prehliadačky
 * výkresov (D-042 D). Od D-077 obohatený o sekcie uzla (zodpovednosti, história
 * GUID) a capture súhrn — NodeSummary polia ostávajú aditívne zachované.
 * Server-side cez `service_role` (D-026), cachované (ISR).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const [summary, sections, captures, derived] = await Promise.all([
      fetchNodeSummary(id),
      fetchNodeSections(id),
      fetchCaptureSummaryForObject(id),
      // Vrstva AIM (D-089): odvodené vzťahy pre Relationship records vo vieweri.
      fetchDerivedRelations(id).catch(() => undefined),
    ]);
    if (!summary) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const detail: ElementDetail = {
      ...summary,
      responsibilities: sections.responsibilities,
      guidHistory: sections.guidHistory,
      captures,
      derived,
    };
    // Read-only súhrn (revaliduje sa s ostatnými AIM dátami po 60 s). Cache v
    // prehliadači + na CDN → opakovaný klik na ten istý kód vo výkrese je okamžitý,
    // bez HTTP round-tripu na server (D-030 perf, dodatok).
    return NextResponse.json(detail, {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error(`[api/element/${id}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
