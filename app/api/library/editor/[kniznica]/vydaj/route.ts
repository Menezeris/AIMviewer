import { NextResponse } from "next/server";

import { vydaj } from "@/lib/kniznica/editor-api";
import { overXsd } from "@/lib/kniznica/ids/xsd";
import { brana, chybaServera, kodKniznice, neznamaKniznica, odpoved, vstup } from "@/lib/kniznica/editor-server";
import { supabaseSkladVydania, supabaseUloziste, VydanieMigraciaChyba } from "@/lib/kniznica/vydanie-db";
import { withRequestProject } from "@/lib/project/request";

/**
 * `POST vydaj` stránky editora (`assetin/server` `api_vydaj`): validácia, snímka, IDS do katalógu AIM v jednej
 * transakcii, export MD. Za bránou `LIBRARY_RELEASE_ENABLED` (D-186 krok 6). Každé IDS ide cez ids.xsd (variant A,
 * `xmllint-wasm`); neplatné IDS alebo nedostupná schéma vydanie zastaví.
 */
export const dynamic = "force-dynamic";

async function postHandler(req: Request, ctx: { params: Promise<{ kniznica: string }> }) {
  const k = kodKniznice((await ctx.params).kniznica);
  if (!k) return neznamaKniznica();
  const b = await vstup(req);
  if (b instanceof NextResponse) return b;
  try {
    return odpoved(await vydaj(() => supabaseSkladVydania(k), brana(), b, { xsd: (xml) => overXsd(xml), uloziste: supabaseUloziste() }));
  } catch (err) {
    if (err instanceof VydanieMigraciaChyba) return NextResponse.json({ detail: err.message, error: err.message }, { status: 503 });
    return chybaServera(err);
  }
}

export const POST = withRequestProject(postHandler);
