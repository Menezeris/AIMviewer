import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MAX_ZONE_GUIDS } from "@/lib/viewer-lens";
import { StyleInputError } from "@/lib/llm/style-plan";
import { ScopeResolver } from "@/lib/llm/style-scope";

/**
 * Členovia zóny pre AIM chat lens (D-096): `GET /api/style-scope?zone=<objects.id>`
 * vráti IFC GUIDy miestností zóny (aj cez vnorené zóny) a prvkov v nich alebo
 * dotýkajúcich sa ich (contained + referenced). Volá ho klient viewera, keď op
 * `lens` nesie symbolickú zónu; GUIDy tak necestujú v URL akcie.
 * Read-only cez `service_role` (D-026), cachované ako ostatné AIM dáta.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const zone = new URL(req.url).searchParams.get("zone") ?? "";
  if (!UUID_RE.test(zone)) return NextResponse.json({ error: "invalid zone" }, { status: 400 });
  try {
    const scope = new ScopeResolver(getSupabaseAdmin());
    const picked = (await scope.pickZones(zone)).filter((z) => z.id === zone);
    if (picked.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ids = await scope.zoneMemberIds(picked);
    const guids = await scope.guids([...ids], "");
    return NextResponse.json(
      { zone: picked[0].object_ref ?? picked[0].name, elements: guids.length, guids: guids.slice(0, MAX_ZONE_GUIDS) },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    if (err instanceof StyleInputError) return NextResponse.json({ error: "not found" }, { status: 404 });
    console.error("[api/style-scope]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
