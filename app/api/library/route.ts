import { NextResponse } from "next/server";

import { detail, HlavaMigraciaChyba, HlavaVstupChyba, prehlad } from "@/lib/kniznica/hlava";
import { supabaseHlavaStore } from "@/lib/kniznica/hlava-store";
import { withRequestProject } from "@/lib/project/request";

/**
 * Read-only browser of the requirements library (port to TS, step 1, assetin-library V30; AIM D-186).
 *
 * - `GET ?kniznica=<code>` (optional): files of the library head without text (path, note_id, type, rev, sha256, author ...).
 * - `GET ?kniznica=<code>&cesta=<path>`: one file with text and the block model (TS parser, conformance corpus), check of the
 *   sha256 of the text and of the byte round trip.
 * Reading only on the server via `service_role` (anon / authenticated have no access to the `library` schema); nothing is written.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

async function getHandler(req: Request) {
  const u = new URL(req.url);
  const kniznica = u.searchParams.get("kniznica");
  const cesta = u.searchParams.get("cesta");
  const store = supabaseHlavaStore();
  try {
    if (cesta !== null) {
      if (!kniznica) return fail("cesta potrebuje aj kniznica", 400);
      const d = await detail(store, kniznica, cesta);
      if (!d) return fail(`Súbor '${cesta}' v knižnici ${kniznica} nie je.`, 404);
      return NextResponse.json(d, { headers: NO_STORE });
    }
    return NextResponse.json(await prehlad(store, kniznica), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof HlavaVstupChyba) return fail(err.message, 400);
    if (err instanceof HlavaMigraciaChyba) return fail(err.message, 503);
    return fail(err instanceof Error ? err.message : "čítanie knižnice zlyhalo", 500);
  }
}

export const GET = withRequestProject(getHandler);
