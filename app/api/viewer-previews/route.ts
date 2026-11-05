import { NextRequest, NextResponse } from "next/server";

import { listViewerPreviews, previewForPull } from "@/lib/viewer-previews";
import { withRequestProject } from "@/lib/project/request";

/**
 * Previews of the viewer from the PR fork for the viewer selection above 3D (D-116).
 * `GET` = open PRs with a preview; `GET ?pr=73` = one PR (also a closed one).
 * The response is public and briefly cached: it contains only numbers, PR names and URLs
 * of the previews of the public fork.
 */
async function getHandler(req: NextRequest) {
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

export const GET = withRequestProject(getHandler);
