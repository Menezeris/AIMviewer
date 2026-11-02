import { NextResponse } from "next/server";

import { branaZapisu } from "@/lib/kniznica/brana";
import { supabaseSklad, ZapisMigraciaChyba } from "@/lib/kniznica/sklad-db";
import { vytvor } from "@/lib/kniznica/zapis";

/**
 * Nová poznámka zo šablóny typu (D-186 krok 3): `POST {kniznica, typ, id, nazov, data?, autor}`. Cestu určuje ID;
 * poznámka, ktorá sa nedá natypovať, sa nezapíše. Za bránou `LIBRARY_WRITE_ENABLED`.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const KOD_RE = /^[A-Za-z0-9._-]{1,80}$/;

export async function POST(req: Request) {
  const zamietnute = branaZapisu(req);
  if (zamietnute) return zamietnute;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kniznica = typeof b.kniznica === "string" ? b.kniznica : "";
  const autor = typeof b.autor === "string" ? b.autor.trim().slice(0, 120) : "";
  if (!KOD_RE.test(kniznica)) return NextResponse.json({ error: "kniznica: kód knižnice" }, { status: 400, headers: NO_STORE });
  if (!autor) return NextResponse.json({ error: "Chýba meno (kto vytvára)." }, { status: 400, headers: NO_STORE });
  if (typeof b.typ !== "string" || typeof b.id !== "string" || typeof b.nazov !== "string") {
    return NextResponse.json({ error: "typ, id a nazov sú povinné" }, { status: 400, headers: NO_STORE });
  }
  const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? (b.data as Record<string, unknown>) : {};
  try {
    const v = await vytvor(supabaseSklad(kniznica), { typ: b.typ, id: b.id, nazov: b.nazov.slice(0, 300), data }, { autor, zdroj: "nova" });
    return NextResponse.json(v, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ZapisMigraciaChyba) return NextResponse.json({ error: err.message }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: err instanceof Error ? err.message : "vytvorenie zlyhalo" }, { status: 500, headers: NO_STORE });
  }
}
