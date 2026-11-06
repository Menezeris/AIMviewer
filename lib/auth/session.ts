import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { readSessionCookie, verifySessionCookie } from "./session-cookie";

/**
 * The signed-in platform user of a request (D-200). The fork signs in with better-auth; AIM checks
 * the cookie signature with the shared `BETTER_AUTH_SECRET` and loads the session through
 * `platform_api.session_for_token` (an AIMforked function, EXECUTE for service_role only). AIM never
 * reads the platform tables directly. The same check covers a browser request and a request the
 * fork's server sends with the user's cookie forwarded.
 */

/** Why a signed-in user may read but not write. */
export type WriteBlock = "not_linked" | "impersonated";

export type SessionUser = {
  userId: string;
  /** IfcPerson node of the user (`platform.users.person_id`); null until an admin links it. */
  personId: string | null;
  email: string;
  name: string;
  role: string;
  sessionId: string;
  /** The admin who impersonates the user, if any. */
  impersonatedBy: string | null;
  /** Null when the user may write; otherwise the reason writes are refused. */
  writeBlock: WriteBlock | null;
};

/** A row of `platform_api.session_for_token`. */
export type SessionRow = {
  user_id: string;
  person_id: string | null;
  email: string;
  name: string;
  role: string;
  session_id: string;
  session_expires_at: string;
  impersonated_by: string | null;
};

export type SessionLookup = (token: string) => Promise<SessionRow | null>;

export type ResolveOptions = {
  secret: string;
  lookUp: SessionLookup;
  now?: () => number;
};

const API_SCHEMA = "platform_api";
const SESSION_FUNCTION = "session_for_token";

/** Resolves the user of a Cookie header, or null for no, an invalid or an expired session. */
export async function resolveSessionUser(
  cookieHeader: string | null,
  { secret, lookUp, now = Date.now }: ResolveOptions
): Promise<SessionUser | null> {
  const raw = readSessionCookie(cookieHeader);
  if (!raw) return null;
  const token = await verifySessionCookie(raw, secret);
  if (!token) return null;

  const row = await lookUp(token);
  if (!row) return null;
  // The function already filters expired sessions; this guards against clock skew and stale rows.
  if (Date.parse(row.session_expires_at) <= now()) return null;

  return {
    userId: row.user_id,
    personId: row.person_id,
    email: row.email,
    name: row.name,
    role: row.role,
    sessionId: row.session_id,
    impersonatedBy: row.impersonated_by,
    writeBlock: writeBlockOf(row),
  };
}

function writeBlockOf(row: SessionRow): WriteBlock | null {
  if (!row.person_id) return "not_linked";
  // A write would be logged under the impersonated person, not the admin who acts.
  if (row.impersonated_by) return "impersonated";
  return null;
}

/** Session lookup through PostgREST with the service_role client. */
export const lookUpSessionInDatabase: SessionLookup = async (token) => {
  const { data, error } = await getSupabaseAdmin()
    .schema(API_SCHEMA)
    .rpc(SESSION_FUNCTION, { p_token: token });
  if (error) throw new Error(`${API_SCHEMA}.${SESSION_FUNCTION} failed: ${error.message}`);
  const rows = (data ?? []) as SessionRow[];
  return rows[0] ?? null;
};

/** The signed-in user of a request. Throws when `BETTER_AUTH_SECRET` is not configured. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is missing. Set the same value as in the AIMforked deployment (D-200)."
    );
  }
  return resolveSessionUser(req.headers.get("cookie"), { secret, lookUp: lookUpSessionInDatabase });
}
