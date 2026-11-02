import { NextResponse } from "next/server";

import { stav } from "@/lib/kniznica/editor-api";
import { brana, kodKniznice, NO_STORE, neznamaKniznica } from "@/lib/kniznica/editor-server";

/** Stránka editora sa pýta, či beží pod serverom a smie ukladať (`assetin/server` `/api/stav`). */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ kniznica: string }> }) {
  const k = kodKniznice((await ctx.params).kniznica);
  if (!k) return neznamaKniznica();
  return NextResponse.json(stav(k, brana()), { headers: NO_STORE });
}
