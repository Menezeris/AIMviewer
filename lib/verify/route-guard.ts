import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";

/**
 * Ochrana `/api/verify/*` (D-185 UI): origin guard a per-IP rate limit (D-068) ako pri IDS (D-162). Výpočet
 * (`run`, `run_all`) beží vždy; ULOŽENIE behu k revízii je za env bránou `VERIFY_WRITE_ENABLED` (predvolene vypnutá,
 * ako ostatné zápisy z viewera D-161, D-162, D-164), bez nej viewer dostane výsledok, ale nič sa neuloží.
 */

const RATE_LIMIT_MAX = Number(process.env.VERIFY_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 120 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.VERIFY_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

export const NO_STORE = { "Cache-Control": "no-store" };

/** IFC GlobalId (22 znakov base64 IFC). */
export const GUID_RE = /^[0-9A-Za-z_$]{22}$/;

export const jsonFail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export const verifySaveEnabled = () => process.env.VERIFY_WRITE_ENABLED === "true";

/** Motor IFC (ENGINE_ENABLED, D-084); bez neho sa overovať nedá. */
export const verifyEngineEnabled = () => process.env.ENGINE_ENABLED === "1" || process.env.ENGINE_SPIKE === "1";

/** null = požiadavka smie ďalej; inak 403 / 429. */
export function verifyGuard(req: Request): NextResponse | null {
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) return jsonFail("cross-origin request denied", 403);
  if (RATE_LIMIT_MAX > 0) {
    const rate = limiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek na overenie, skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }
  }
  return null;
}

/** Telo POST ako objekt (malé, len parametre). */
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (raw.length > 10_000) return null;
  try {
    const b = JSON.parse(raw || "{}");
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
