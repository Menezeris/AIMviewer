/**
 * Tests of /api/ask protection (D-068): sliding-window rate limit + origin guard.
 * An endpoint without protection triggered up to 9 LLM calls per anonymous POST - a direct
 * vector for exhausting the provider's credit.
 */
import { describe, expect, it } from "vitest";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "./api-guard";

/** Manually advanceable clock. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("povolí max požiadaviek v okne, ďalšiu odmietne s Retry-After", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: clock.now });

    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);

    const denied = limiter.check("ip1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("okno sa posúva — po vypršaní najstaršieho hitu pustí ďalší", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: clock.now });

    limiter.check("ip1");
    clock.tick(30_000);
    limiter.check("ip1");
    expect(limiter.check("ip1").allowed).toBe(false);

    clock.tick(31_000); // the first hit (t=0) dropped out of the window, the second (t=30s) remains
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(false);
  });

  it("kľúče sú izolované — iná IP má vlastné okno", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });

    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(false);
    expect(limiter.check("ip2").allowed).toBe(true);
  });

  it("odmietnuté požiadavky sa nepočítajú do okna (nedajú sa 'predĺžiť' útokom)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1, now: clock.now });

    limiter.check("ip1");
    for (let i = 0; i < 5; i++) {
      clock.tick(1_000);
      expect(limiter.check("ip1").allowed).toBe(false);
    }
    clock.tick(5_001); // 10s after the FIRST (the only counted) hit
    expect(limiter.check("ip1").allowed).toBe(true);
  });

  it("Retry-After klesá s časom", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: clock.now });

    limiter.check("ip1");
    const d1 = limiter.check("ip1");
    clock.tick(45_000);
    const d2 = limiter.check("ip1");
    expect(d2.retryAfterSeconds).toBeLessThan(d1.retryAfterSeconds);
    expect(d2.retryAfterSeconds).toBe(15);
  });
});

describe("isCrossOriginBlocked", () => {
  it("blokne cudziu origin", () => {
    expect(isCrossOriginBlocked("https://evil.example", "aim.assetin.sk")).toBe(true);
  });

  it("pustí same-origin (vrátane portu)", () => {
    expect(isCrossOriginBlocked("https://aim.assetin.sk", "aim.assetin.sk")).toBe(false);
    expect(isCrossOriginBlocked("http://localhost:3000", "localhost:3000")).toBe(false);
  });

  it("pustí požiadavky bez Origin (curl, eval runner, server-side)", () => {
    expect(isCrossOriginBlocked(null, "aim.assetin.sk")).toBe(false);
  });

  it("blokne nevalidnú Origin hlavičku", () => {
    expect(isCrossOriginBlocked("not-a-url", "aim.assetin.sk")).toBe(true);
  });
});

describe("clientIpKey", () => {
  it("preferuje x-real-ip, potom prvý x-forwarded-for hop, potom 'unknown'", () => {
    expect(
      clientIpKey(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))
    ).toBe("1.2.3.4");
    expect(clientIpKey(new Headers({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" }))).toBe(
      "5.6.7.8"
    );
    expect(clientIpKey(new Headers())).toBe("unknown");
  });
});
