import { NextResponse } from "next/server";

import { fetchCaptureSummaryForObject } from "@/lib/data/captures";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestProject } from "@/lib/project/request";

/**
 * Reality Capture summary for an object selected in 3D (D-073) - space + number of shots.
 * Powers the "Reality Capture (N)" action in the AIM card (`lib/aim-panel.ts`). Read-only.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getHandler(req: Request) {
  const projectId = currentProjectId();
  const object = new URL(req.url).searchParams.get("object");
  if (!object || !UUID_RE.test(object)) {
    return NextResponse.json({ error: "invalid object id" }, { status: 400 });
  }
  try {
    const summary = await fetchCaptureSummaryForObject(projectId, object);
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[api/captures/summary]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export const GET = withRequestProject(getHandler);
