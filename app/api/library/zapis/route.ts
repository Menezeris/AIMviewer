import { NextResponse } from "next/server";

import { branaZapisu } from "@/lib/kniznica/brana";
import { supabaseSklad, ZapisMigraciaChyba } from "@/lib/kniznica/sklad-db";
import { uloz, type Zmena } from "@/lib/kniznica/zapis";

/**
 * Uloženie z editora knižnice (D-186 krok 3): `POST {kniznica, zmeny: [{id, pointer, hodnota}], verzie: {id: sha256},
 * autor, sprava?}`. Writer opraví text v pamäti, loader ho znova natypuje, do DB ide len to, čo prešlo, naraz
 * (`library.zapis_revizie`) s projekciou. Súbeh (iná verzia, AS409) = 409 a nič sa neprepíše.
 * Za bránou `LIBRARY_WRITE_ENABLED` (predvolene vypnutá).
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const KOD_RE = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_BODY = 500_000;

export async function POST(req: Request) {
  const zamietnute = branaZapisu(req);
  if (zamietnute) return zamietnute;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "telo je príliš veľké" }, { status: 413, headers: NO_STORE });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "neplatný JSON" }, { status: 400, headers: NO_STORE });
  }
  const kniznica = typeof b.kniznica === "string" ? b.kniznica : "";
  const autor = typeof b.autor === "string" ? b.autor.trim().slice(0, 120) : "";
  if (!KOD_RE.test(kniznica)) return NextResponse.json({ error: "kniznica: kód knižnice" }, { status: 400, headers: NO_STORE });
  if (!autor) return NextResponse.json({ error: "Chýba meno (kto ukladá)." }, { status: 400, headers: NO_STORE });
  const zmeny = Array.isArray(b.zmeny)
    ? (b.zmeny as Array<Record<string, unknown>>).filter((z) => z && typeof z.id === "string" && typeof z.pointer === "string").map((z) => ({ id: z.id as string, pointer: z.pointer as string, hodnota: z.hodnota ?? null }) as Zmena)
    : [];
  if (zmeny.length === 0) return NextResponse.json({ error: "žiadne zmeny" }, { status: 400, headers: NO_STORE });
  const verzie = b.verzie && typeof b.verzie === "object" ? (Object.fromEntries(Object.entries(b.verzie as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>) : {};
  try {
    const v = await uloz(supabaseSklad(kniznica), zmeny, { autor, sprava: typeof b.sprava === "string" ? b.sprava.slice(0, 500) : null, zdroj: "editor" }, verzie);
    return NextResponse.json(v, { status: v.konflikt ? 409 : 200, headers: NO_STORE });
  } catch (err) {
    if (err instanceof ZapisMigraciaChyba) return NextResponse.json({ error: err.message }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ error: err instanceof Error ? err.message : "zápis zlyhal" }, { status: 500, headers: NO_STORE });
  }
}
