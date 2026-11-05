import { NextResponse } from "next/server";

import { fetchUnderlayDrawings } from "@/lib/data/drawing";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestProject } from "@/lib/project/request";

/**
 * Podklady PDF pre viewer nanovo (D-168): klient hosta ich po `calibrate_underlay mode=restore` pošle viewerovi
 * ako `UNDERLAYS_LOAD`. Len čítanie, rovnaké dáta ako pri štarte viewera (kalibrácie bez histórie); zápis je
 * `PATCH /api/underlay/[documentId]`.
 */
async function getHandler(_req: Request) {
  const projectId = currentProjectId();
  try {
    return NextResponse.json({ drawings: await fetchUnderlayDrawings(projectId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "underlays failed" }, { status: 500 });
  }
}

export const GET = withRequestProject(getHandler);
