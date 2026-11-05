import { NextResponse } from "next/server";

import { over } from "@/lib/kniznica/editor-api";
import { chybaServera, kodKniznice, neznamaKniznica, odpoved, sklad, vstup } from "@/lib/kniznica/editor-server";
import { withRequestProject } from "@/lib/project/request";

/** `POST kontrola`: diagnostiky pracovnej kópie z editora, nič sa nezapisuje (D-186, U16). */
export const dynamic = "force-dynamic";

async function postHandler(req: Request, ctx: { params: Promise<{ kniznica: string }> }) {
  const k = kodKniznice((await ctx.params).kniznica);
  if (!k) return neznamaKniznica();
  const b = await vstup(req);
  if (b instanceof NextResponse) return b;
  try {
    return odpoved(await over(sklad(k), b));
  } catch (err) {
    return chybaServera(err);
  }
}

export const POST = withRequestProject(postHandler);
