import { NextResponse } from "next/server";

import { nova } from "@/lib/library/editor-api";
import { brana, chybaServera, info, kodKniznice, neznamaKniznica, odpoved, sklad, vstup } from "@/lib/library/editor-server";
import { ZapisMigraciaChyba } from "@/lib/library/store-db";
import { withRequestProject } from "@/lib/project/request";

/** `POST nova` of the editor page (`assetin/server`) over the store in the DB, behind the `LIBRARY_WRITE_ENABLED` gate (D-186). */
export const dynamic = "force-dynamic";

async function postHandler(req: Request, ctx: { params: Promise<{ kniznica: string }> }) {
  const k = kodKniznice((await ctx.params).kniznica);
  if (!k) return neznamaKniznica();
  const b = await vstup(req);
  if (b instanceof NextResponse) return b;
  try {
    return odpoved(await nova(() => sklad(k), brana(), b, info(k)));
  } catch (err) {
    if (err instanceof ZapisMigraciaChyba) return NextResponse.json({ detail: err.message, error: err.message }, { status: 503 });
    return chybaServera(err);
  }
}

export const POST = withRequestProject(postHandler);
