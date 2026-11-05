/**
 * Protection of public API routes (D-068): per-IP sliding-window rate limit
 * + cross-origin guard. Pure functions with injectable clocks - testable
 * without the Next runtime.
 *
 * The in-memory limiter is per serverless instance (on Vercel instances
 * scale and get recycled) - it is not an exact distributed limit, but it really
 * stops cheap abuse (a script hammering a single instance). An exact
 * global limit would need KV/Upstash - a conscious trade-off, see D-068.
 */

interface RateLimiterOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per key in the window. */
  max: number;
  /** Time source - injectable for tests (default Date.now). */
  now?: () => number;
}

export interface RateCheck {
  allowed: boolean;
  /** Seconds until the window frees up - value for the Retry-After header (0 if allowed). */
  retryAfterSeconds: number;
}

/**
 * Sliding-window limiter: keeps request timestamps per key and on every
 * check cuts off those outside the window. Memory is cleaned up lazily - a key disappears when
 * its window expires (prune on check), so the Map does not grow forever.
 */
export function createRateLimiter({ windowMs, max, now = Date.now }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();
  let checksSincePrune = 0;

  function check(key: string): RateCheck {
    const t = now();
    const cutoff = t - windowMs;

    // Lazy prune of the whole map every 64th check, so that keys of one-off
    // visitors do not stay in memory forever.
    if (++checksSincePrune >= 64) {
      checksSincePrune = 0;
      for (const [k, arr] of hits) {
        const alive = arr.filter((ts) => ts > cutoff);
        if (alive.length === 0) hits.delete(k);
        else hits.set(k, alive);
      }
    }

    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= max) {
      hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
      };
    }
    recent.push(t);
    hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { check };
}

/**
 * Cross-origin guard for browser POSTs: if a request CARRIES an Origin header
 * and its host does not match the request host, it is a foreign page firing
 * at our API from the user's browser - block. Requests without Origin
 * (curl, server-side scripts, eval runner) pass - the limiter still
 * covers them; this is a CSRF layer, not authentication.
 */
export function isCrossOriginBlocked(
  originHeader: string | null,
  requestHost: string | null
): boolean {
  if (!originHeader || !requestHost) return false;
  try {
    return new URL(originHeader).host !== requestHost;
  } catch {
    // Invalid Origin - a browser never sends it like this; block.
    return true;
  }
}

/**
 * Client IP from the headers set by the platform on Vercel (the proxy
 * overwrites them, the client cannot spoof them). Outside such infrastructure it is just a
 * best-effort key for the limiter - it is no worse than nothing.
 */
export function clientIpKey(headers: Headers): string {
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
