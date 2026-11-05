import { NextRequest, NextResponse } from "next/server";

import { fetchSpaceSiblings } from "@/lib/data/filter";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestProject } from "@/lib/project/request";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const projectId = currentProjectId();
  const { objectId } = await params;

  // Validation like /api/element - without it invalid input goes all the way to Postgres
  // (uuid cast error) and the internal message would leak into the response.
  if (!UUID_RE.test(objectId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const result = await fetchSpaceSiblings(projectId, objectId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    // Internal DB messages do not belong to the client - log and return a generic error.
    console.error(`[api/space-siblings/${objectId}]`, err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export const GET = withRequestProject(getHandler);
