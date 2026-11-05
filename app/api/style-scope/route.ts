import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MAX_ZONE_GUIDS } from "@/lib/viewer-lens";
import { StyleInputError } from "@/lib/llm/style-plan";
import { ScopeResolver } from "@/lib/llm/style-scope";

/**
 * Symbolické množiny pre AIM chat lens a zoznam (D-096), GUIDy necestujú v URL akcie:
 *
 *   · `GET /api/style-scope?zone=<objects.id>` vráti IFC GUIDy miestností zóny (aj cez
 *     vnorené zóny) a prvkov v nich alebo dotýkajúcich sa ich (contained + referenced);
 *   · `GET /api/style-scope?document=<objects.id>[&page=N]` vráti GUIDy prvkov, ktorých
 *     sa dokument alebo jeho strana týka, aj zdedené cez nositeľa (D-104 krok 4).
 *
 * Volá ho klient viewera, keď op `lens` alebo `list` nesie `aim_zone` / `aim_document`.
 * Read-only cez `service_role` (D-026), cachované ako ostatné AIM dáta.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const zone = params.get("zone");
  const document = params.get("document");
  const id = zone ?? document ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: zone !== null ? "invalid zone" : "invalid document" }, { status: 400 });
  const rawPage = params.get("page");
  const page = rawPage === null ? undefined : Number(rawPage);
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  try {
    const scope = new ScopeResolver(getSupabaseAdmin());
    if (zone === null) {
      const { doc, ids } = await scope.documentMembers(id, page);
      if (doc.id !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
      const guids = await scope.guids([...ids], "");
      return NextResponse.json(
        {
          document: doc.name ?? doc.object_ref,
          ...(page ? { page } : {}),
          elements: guids.length,
          guids: guids.slice(0, MAX_ZONE_GUIDS),
        },
        { headers: CACHE },
      );
    }
    const picked = (await scope.pickZones(id)).filter((z) => z.id === id);
    if (picked.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ids = await scope.zoneMemberIds(picked);
    const guids = await scope.guids([...ids], "");
    return NextResponse.json(
      { zone: picked[0].object_ref ?? picked[0].name, elements: guids.length, guids: guids.slice(0, MAX_ZONE_GUIDS) },
      { headers: CACHE },
    );
  } catch (err) {
    if (err instanceof StyleInputError) return NextResponse.json({ error: "not found" }, { status: 404 });
    console.error("[api/style-scope]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
