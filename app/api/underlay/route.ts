import { NextResponse } from "next/server";

import { fetchUnderlayDrawings } from "@/lib/data/drawing";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * PDF underlays for the viewer anew (D-168): the host client sends them to the viewer after `calibrate_underlay mode=restore`
 * as `UNDERLAYS_LOAD`. Read-only, the same data as at viewer start (calibrations without history); writing is
 * `PATCH /api/underlay/[documentId]`.
 */
async function getHandler() {
  const projectId = currentProjectId();
  try {
    return NextResponse.json({ drawings: await fetchUnderlayDrawings(projectId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "underlays failed" }, { status: 500 });
  }
}

export const GET = withRequestAuth(withRequestProject<[Request]>(getHandler), { source: "app:/api/underlay", write: false });
