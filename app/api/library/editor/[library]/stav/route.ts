import { NextResponse } from "next/server";

import { stav } from "@/lib/library/editor-api";
import { brana, kodKniznice, NO_STORE, neznamaKniznica } from "@/lib/library/editor-server";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/** The editor page asks whether it runs under a server and may save (`assetin/server` `/api/stav`). */
export const dynamic = "force-dynamic";

async function getHandler(_req: Request, ctx: { params: Promise<{ library: string }> }) {
  const k = kodKniznice((await ctx.params).library);
  if (!k) return neznamaKniznica();
  return NextResponse.json(stav(k, brana()), { headers: NO_STORE });
}

export const GET = withRequestAuth(withRequestProject(getHandler), { source: "app:/api/library/editor/[library]/stav", write: false });
