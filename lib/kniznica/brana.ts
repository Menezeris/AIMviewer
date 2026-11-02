import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";

/**
 * Brána zápisu do knižnice (D-186 krok 3): `LIBRARY_WRITE_ENABLED=true` (predvolene vypnutá, zapína sa na
 * Samuelovo slovo), origin guard a per-IP rate limit ako pri IDS (D-162, D-068).
 */

const MAX = Number(process.env.LIBRARY_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const WINDOW = Number(process.env.LIBRARY_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: WINDOW, max: MAX });

export const zapisPovoleny = () => process.env.LIBRARY_WRITE_ENABLED === "true";

export function branaZapisu(req: Request): NextResponse | null {
  if (!zapisPovoleny()) return NextResponse.json({ error: "zápis do knižnice v AIM je vypnutý (LIBRARY_WRITE_ENABLED)" }, { status: 403 });
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  if (MAX > 0 && !limiter.check(clientIpKey(req.headers)).allowed) return NextResponse.json({ error: "príliš veľa zápisov, skús o chvíľu" }, { status: 429 });
  return null;
}
