import { NextResponse } from "next/server";

import { loadListHostValues } from "@/lib/data/list-host-values";
import { LIST_HOST_KEYS, type ListHostKey } from "@/lib/viewer-list";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestProject } from "@/lib/project/request";

/**
 * Values of the host columns of the Lists panel (D-174, #277): `GET /api/list-host-values?key=derived_referenced|derived_boundary`
 * returns `{ values: { GlobalId: text }, count, truncated }`. Called by the viewer client when a `list` op carries a column
 * `source: "host"`; the values are sent to the fork in the column of the `OPEN_LIST` / `LIST_UPDATE` message. Read-only via `service_role` (D-026).
 */

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };

async function getHandler(req: Request) {
  const projectId = currentProjectId();
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!(LIST_HOST_KEYS as readonly string[]).includes(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 });
  try {
    return NextResponse.json(await loadListHostValues(projectId, key as ListHostKey), { headers: CACHE });
  } catch (err) {
    console.error("[api/list-host-values]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export const GET = withRequestProject(getHandler);
