import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter } from "@/lib/api-guard";
import { LAYERS, type Layer } from "@/lib/icdd/model";
import { fetchIcddPlan } from "@/lib/icdd/plan-fetch";

/**
 * Plán kontajnera ICDD (D-181, #350): JSON s indexom (payloady s verejnou URL a sha256) a väzbami AIM.
 * Len čítanie. Kontajner zloží prehliadač (`lib/icdd/client.ts`) a uloží ho do PC; ten istý plán slúži
 * pri importe späť na porovnanie s DB (roundtrip). `?layers=documents-elements,derived-spatial` zúži vrstvy.
 */

const limiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: Number(process.env.ICDD_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 20 : 0)) || Number.MAX_SAFE_INTEGER,
});

export const maxDuration = 60;

export async function GET(req: Request) {
  const rate = limiter.check(clientIpKey(req.headers));
  if (!rate.allowed) {
    return NextResponse.json({ error: "príliš veľa exportov, skús neskôr" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const param = new URL(req.url).searchParams.get("layers");
  let layers: Layer[] | undefined;
  if (param) {
    const asked = param.split(",").map((s) => s.trim());
    const bad = asked.filter((l) => !(LAYERS as readonly string[]).includes(l));
    if (bad.length) return NextResponse.json({ error: `neznáma vrstva: ${bad.join(", ")}`, layers: LAYERS }, { status: 400 });
    layers = asked as Layer[];
  }
  try {
    const plan = await fetchIcddPlan({ layers });
    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "icdd plan failed" }, { status: 500 });
  }
}
