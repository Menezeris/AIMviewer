import { NextResponse } from "next/server";

import { loadListHostValues } from "@/lib/data/list-host-values";
import { LIST_HOST_KEYS, type ListHostKey } from "@/lib/viewer-list";

/**
 * Hodnoty host stĺpcov panela Lists (D-174, #277): `GET /api/list-host-values?key=derived_referenced|derived_boundary`
 * vráti `{ values: { GlobalId: text }, count, truncated }`. Volá ho klient viewera, keď op `list` nesie stĺpec
 * `source: "host"`; hodnoty pošle forku v stĺpci správy `OPEN_LIST` / `LIST_UPDATE`. Read-only cez `service_role` (D-026).
 */

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!(LIST_HOST_KEYS as readonly string[]).includes(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 });
  try {
    return NextResponse.json(await loadListHostValues(key as ListHostKey), { headers: CACHE });
  } catch (err) {
    console.error("[api/list-host-values]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
