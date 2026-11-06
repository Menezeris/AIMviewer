import { describe, expect, it, vi } from "vitest";

import { readSessionCookie, verifySessionCookie } from "./session-cookie";
import { resolveSessionUser, type SessionRow } from "./session";

/**
 * Fixture made with better-call 1.3.6 `signCookieValue`, the function better-auth 1.6.17 uses for
 * `setSignedCookie` in AIMforked (D-200). The secret is a test value, never a real one. The value
 * contains URL-encoded `/`, `+` and `=`.
 */
const FIXTURE = {
  secret: "aim-test-secret-not-for-production-0123456789",
  token: "x7Kq9vLmN2pR4sT6uW8yZ0aB3cD5eF7g",
  cookieValue: "x7Kq9vLmN2pR4sT6uW8yZ0aB3cD5eF7g.sswpFk27Yxiat1y3hydL9JCckLI6YYAgYxtQ%2FJkSd%2Bk%3D",
};
const NOW = Date.parse("2026-11-06T10:00:00Z");
const PERSON = "0198a000-0000-7000-8000-000000000001";
const ADMIN = "0198a000-0000-7000-8000-0000000000ad";

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    user_id: "0198a000-0000-7000-8000-0000000000u1",
    person_id: PERSON,
    email: "fm@x.test",
    name: "Facility Manager",
    role: "user",
    session_id: "0198a000-0000-7000-8000-0000000000s1",
    session_expires_at: "2026-11-07T10:00:00Z",
    impersonated_by: null,
    ...overrides,
  };
}

function cookieHeader(value = FIXTURE.cookieValue, name = "better-auth.session_token") {
  return `aim_project=OCB; ${name}=${value}; theme=dark`;
}

function resolve(header: string | null, found: SessionRow | null = row(), secret = FIXTURE.secret) {
  const lookUp = vi.fn(async () => found);
  return { lookUp, result: resolveSessionUser(header, { secret, lookUp, now: () => NOW }) };
}

describe("session cookie (D-200)", () => {
  it("verifies a cookie signed by better-auth", async () => {
    expect(await verifySessionCookie(FIXTURE.cookieValue, FIXTURE.secret)).toBe(FIXTURE.token);
  });

  it("rejects the cookie with a wrong secret", async () => {
    expect(await verifySessionCookie(FIXTURE.cookieValue, "another-secret-of-enough-length-000000")).toBeNull();
    expect(await verifySessionCookie(FIXTURE.cookieValue, "")).toBeNull();
  });

  it("rejects a tampered token or signature", async () => {
    const tamperedToken = FIXTURE.cookieValue.replace(/^x/, "y");
    const [token] = FIXTURE.cookieValue.split(".");
    const otherSignature = `${token}.${"A".repeat(43)}%3D`;
    expect(await verifySessionCookie(tamperedToken, FIXTURE.secret)).toBeNull();
    expect(await verifySessionCookie(otherSignature, FIXTURE.secret)).toBeNull();
  });

  it("rejects malformed values", async () => {
    for (const value of ["", "no-dot", ".onlysignature%3D", `${FIXTURE.token}.short%3D`, "%E0%A4%A", `${FIXTURE.token}.${"!".repeat(43)}=`]) {
      expect(await verifySessionCookie(value, FIXTURE.secret), value).toBeNull();
    }
  });

  it("reads the secure cookie first and the plain one otherwise", () => {
    expect(readSessionCookie(cookieHeader())).toBe(FIXTURE.cookieValue);
    expect(
      readSessionCookie(`better-auth.session_token=plain; __Secure-better-auth.session_token=secure`)
    ).toBe("secure");
    expect(readSessionCookie("theme=dark")).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
  });
});

describe("session user (D-200)", () => {
  it("returns the user and person of a valid session", async () => {
    const { lookUp, result } = resolve(cookieHeader());
    expect(await result).toMatchObject({ personId: PERSON, email: "fm@x.test", writeBlock: null });
    expect(lookUp).toHaveBeenCalledWith(FIXTURE.token);
  });

  it("does not look up a cookie with a wrong secret", async () => {
    const { lookUp, result } = resolve(cookieHeader(), row(), "wrong-secret-of-enough-length-0000000");
    expect(await result).toBeNull();
    expect(lookUp).not.toHaveBeenCalled();
  });

  it("returns null for an unknown or expired session", async () => {
    expect(await resolve(cookieHeader(), null).result).toBeNull();
    expect(
      await resolve(cookieHeader(), row({ session_expires_at: "2026-11-06T09:59:59Z" })).result
    ).toBeNull();
  });

  it("returns null without a cookie", async () => {
    expect(await resolve(null).result).toBeNull();
    expect(await resolve("theme=dark").result).toBeNull();
  });

  it("blocks writes for a user without a person", async () => {
    expect(await resolve(cookieHeader(), row({ person_id: null })).result).toMatchObject({
      personId: null,
      writeBlock: "not_linked",
    });
  });

  it("blocks writes in an impersonated session", async () => {
    expect(await resolve(cookieHeader(), row({ impersonated_by: ADMIN })).result).toMatchObject({
      impersonatedBy: ADMIN,
      writeBlock: "impersonated",
    });
  });
});
