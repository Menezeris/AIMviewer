import { NextResponse } from "next/server";

import { detail, HlavaMigraciaChyba, HlavaVstupChyba, prehlad } from "@/lib/kniznica/hlava";
import { supabaseHlavaStore } from "@/lib/kniznica/hlava-store";

/**
 * Read-only prehliadač knižnice požiadaviek (port do TS, krok 1, assetin-library V30; AIM D-186).
 *
 * - `GET ?kniznica=<kód>` (voliteľne): súbory hlavy knižnice bez textu (cesta, note_id, typ, rev, sha256, autor ...).
 * - `GET ?kniznica=<kód>&cesta=<cesta>`: jeden súbor s textom a blokovým modelom (TS parser, korpus zhody), kontrola
 *   sha256 textu a bajtového round-tripu.
 * Čítanie len na serveri cez `service_role` (anon / authenticated do schémy `library` prístup nemajú); nič sa nezapisuje.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
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
