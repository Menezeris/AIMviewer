import { NextResponse } from "next/server";

import { clientIpKey } from "@/lib/api-guard";
import { MarkupParamError, parseMarkupParam } from "@/lib/bcf/markup";
import { pngHeaders, snapshotFor } from "@/lib/bcf/snapshot-http";
import { parseDocRegion } from "@/lib/viewer-ops";
import { withRequestProject } from "@/lib/project/request";

/**
 * Snapshot of a crop of a document page (D-158 step 3): `GET /api/drawing/<id>/snapshot?page=N&region=x_y_w_h`
 * (area in % from the top left as the topic link; without it the whole page), optionally `markup=<JSON array of marks,
 * URL-encoded, up to 8 kB>` (D-158 step 7: cloud, arrow, text, pin; unsaved comment). PNG with a frame, longer side
 * up to 1500 px, cache in the `documents` bucket. Read-only, without a token like the PDF itself; called by the fork for an
 * unsaved comment (snapshot into a local .bcfzip export). CORS open like BCF API.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = { "Access-Control-Allow-Origin": "*" };

async function getHandler(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const page = Number(q.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    return NextResponse.json({ message: "page musí byť celé číslo od 1." }, { status: 400, headers: CORS });
  }
  const raw = q.get("region") ?? undefined;
  const r = parseDocRegion(raw);
  if (raw && !r) return NextResponse.json({ message: "region: x_y_w_h v % strany." }, { status: 400, headers: CORS });
  let markup;
  try {
    markup = parseMarkupParam(q.get("markup"));
  } catch (e) {
    if (e instanceof MarkupParamError) return NextResponse.json({ message: e.message }, { status: 400, headers: CORS });
    throw e;
  }
  const out = await snapshotFor(
    { document_id: id, page, region: r ? { x: r.x, y: r.y, width: r.w, height: r.h } : null, markup },
    clientIpKey(req.headers),
  );
  if (!out.ok) {
    return NextResponse.json(
      { message: out.message },
      { status: out.status, headers: { ...CORS, ...(out.retryAfter ? { "Retry-After": String(out.retryAfter) } : {}) } },
    );
  }
  return new Response(new Uint8Array(out.png), { status: 200, headers: { ...CORS, ...pngHeaders(out.revisionChanged) } });
}

export const GET = withRequestProject(getHandler);
