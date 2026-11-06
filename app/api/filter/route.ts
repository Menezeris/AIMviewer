import { NextRequest, NextResponse } from "next/server";

import {
  fetchByIfcType,
  fetchByClassificationPrefix,
} from "@/lib/data/filter";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

async function getHandler(req: NextRequest) {
  const projectId = currentProjectId();
  const { searchParams } = req.nextUrl;
  const ifcType = searchParams.get("ifc_type");
  const classification = searchParams.get("classification");

  try {
    let objectIds: string[];

    if (ifcType) {
      objectIds = await fetchByIfcType(projectId, ifcType);
    } else if (classification) {
      objectIds = await fetchByClassificationPrefix(projectId, classification);
    } else {
      return NextResponse.json(
        { error: "Provide ifc_type or classification query param" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { objectIds },
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  } catch (err) {
    // Internal DB messages do not belong to the client - log and return a generic error.
    console.error("[api/filter]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export const GET = withRequestAuth(withRequestProject(getHandler), { source: "app:/api/filter", write: false });
