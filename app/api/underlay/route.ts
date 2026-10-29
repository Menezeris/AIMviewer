import { NextResponse } from "next/server";

import { fetchUnderlayDrawings } from "@/lib/data/drawing";

/**
 * Podklady PDF pre viewer nanovo (D-168): klient hosta ich po `calibrate_underlay mode=restore` pošle viewerovi
 * ako `UNDERLAYS_LOAD`. Len čítanie, rovnaké dáta ako pri štarte viewera (kalibrácie bez histórie); zápis je
 * `PATCH /api/underlay/[documentId]`.
 */
export async function GET() {
  try {
    return NextResponse.json({ drawings: await fetchUnderlayDrawings() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "underlays failed" }, { status: 500 });
  }
}
