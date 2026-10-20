import { NextRequest, NextResponse } from "next/server";

import { listViewerPreviews, previewForPull } from "@/lib/viewer-previews";

/**
 * Náhľady viewera z PR forku pre výber viewera nad 3D (D-114).
 * `GET` = otvorené PR s náhľadom; `GET ?pr=73` = jeden PR (aj zatvorený).
 * Odpoveď je verejná a krátko cachovaná: obsahuje len čísla, názvy PR a URL
 * náhľadov verejného forku.
 */
export async function GET(req: NextRequest) {
  const pr = req.nextUrl.searchParams.get("pr");
  try {
    if (pr !== null) {
      if (!/^\d{1,6}$/.test(pr)) return NextResponse.json({ error: "invalid pr" }, { status: 400 });
      const preview = await previewForPull(Number(pr));
      if (!preview) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json(preview, { headers: { "Cache-Control": "public, max-age=30" } });
    }
    const previews = await listViewerPreviews();
    return NextResponse.json({ previews }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (err) {
    console.error("[api/viewer-previews]", err);
    return NextResponse.json({ error: "github unavailable" }, { status: 502 });
  }
}
