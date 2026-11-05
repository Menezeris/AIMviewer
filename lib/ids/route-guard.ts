import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";

/**
  * Protection of IDS writes from the viewer (D-162, D-182): env gate `IDS_WRITE_ENABLED` (off by default), origin guard and
  * per-IP rate limit (D-068), as with views and underlays (D-161, D-072). Shared by `/api/ids`,
  * `/api/ids/library`, `/api/ids/models` and `/api/ids/runs`; the limit is counted together.
 */

const RATE_LIMIT_MAX = Number(process.env.IDS_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.IDS_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

export const NO_STORE = { "Cache-Control": "no-store" };

export const jsonFail = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

/** null = the write is allowed; otherwise a 403 / 429 response. */
export function idsWriteGuard(req: Request): NextResponse | null {
  if (process.env.IDS_WRITE_ENABLED !== "true") {
    return NextResponse.json({ error: "ukladanie IDS z viewera je vypnuté (IDS_WRITE_ENABLED), ulož ho v chate" }, { status: 403 });
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = limiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek, skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }
  }
  return null;
}

/** JSON telo do stropu; string = chyba (413 / 400). */
export async function readJson(req: Request, maxChars: number): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const raw = await req.text();
  if (raw.length > maxChars) return { ok: false, res: jsonFail("payload too large", 413) };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, res: jsonFail("invalid JSON", 400) };
  }
}
