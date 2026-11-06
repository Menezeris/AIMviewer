/**
 * The better-auth session cookie of the platform (D-200). The fork (AIMforked) signs the user in
 * with better-auth; AIM verifies the same cookie itself with the shared `BETTER_AUTH_SECRET` and
 * then loads the session from the database (`lib/auth/session.ts`).
 *
 * Format, checked against better-auth 1.6.17 and better-call 1.3.6 (`signCookieValue`,
 * `getSignedCookie`): the cookie `better-auth.session_token`, with the `__Secure-` prefix on
 * HTTPS, holds `encodeURIComponent(token + "." + base64(HMAC-SHA256(secret, token)))`. The
 * signature is 44 base64 characters ending in `=`. The cookie carries no expiry or user; both come
 * from the session row.
 *
 * Pure functions on Web Crypto, so they run in Node, the Edge runtime and tests.
 */

export const SESSION_COOKIE_NAME = "better-auth.session_token";
export const SECURE_COOKIE_PREFIX = "__Secure-";

const SIGNATURE_LENGTH = 44;
const SIGNATURE_PADDING = "=";
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;

/** The raw (still URL-encoded) session cookie from a Cookie header; the secure name wins. */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return (
    cookies.get(`${SECURE_COOKIE_PREFIX}${SESSION_COOKIE_NAME}`) ?? cookies.get(SESSION_COOKIE_NAME) ?? null
  );
}

/**
 * The session token when the signature matches the secret, otherwise null. A malformed value is
 * null too; the caller does not need to tell the cases apart.
 */
export async function verifySessionCookie(rawValue: string, secret: string): Promise<string | null> {
  if (!secret) return null;
  let value: string;
  try {
    value = decodeURIComponent(rawValue);
  } catch {
    return null;
  }

  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (signature.length !== SIGNATURE_LENGTH || !signature.endsWith(SIGNATURE_PADDING)) return null;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, ["verify"]);
  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(HMAC.name, key, signatureBytes, encoder.encode(token));
  if (!valid) return null;
  return token;
}
