import { NextResponse } from "next/server";

import { vydaj } from "@/lib/library/editor-api";
import { overXsd } from "@/lib/library/ids/xsd";
import { brana, chybaServera, kodKniznice, neznamaKniznica, odpoved, vstup } from "@/lib/library/editor-server";
import { supabaseSkladVydania, supabaseUloziste, VydanieMigraciaChyba } from "@/lib/library/release-db";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * `POST vydaj` of the editor page (`assetin/server` `api_vydaj`): validation, snapshot, IDS into the AIM catalog in one
 * transaction, MD export. Behind the `LIBRARY_RELEASE_ENABLED` gate (D-186 step 6). Every IDS goes through ids.xsd (variant A,
 * `xmllint-wasm`); an invalid IDS or an unavailable schema stops the release.
 */
export const dynamic = "force-dynamic";

async function postHandler(req: Request, ctx: { params: Promise<{ library: string }> }) {
  const k = kodKniznice((await ctx.params).library);
  if (!k) return neznamaKniznica();
  const b = await vstup(req);
  if (b instanceof NextResponse) return b;
  try {
    return odpoved(await vydaj(() => supabaseSkladVydania(k, currentProjectId()), brana(), b, { xsd: (xml) => overXsd(xml), uloziste: supabaseUloziste() }));
  } catch (err) {
    if (err instanceof VydanieMigraciaChyba) return NextResponse.json({ detail: err.message, error: err.message }, { status: 503 });
    return chybaServera(err);
  }
}

export const POST = withRequestAuth(withRequestProject(postHandler), { source: "app:/api/library/editor/[library]/vydaj", write: true });
