import { NextResponse } from "next/server";

import { withAuditContext } from "@/lib/audit/context";

import { getSessionUser, type SessionUser, type WriteBlock } from "./session";

/**
 * Wraps an API route so its writes carry the signed-in person (D-200, D-196). The route runs inside
 * `withAuditContext` with the person of the platform session and the route's source, so every
 * service_role call sends `x-aim-person-id` and the audit log names the person.
 *
 * A writing route refuses a signed-in user who may not write (403): an account without a person or
 * an impersonated session. A request without a session keeps today's behaviour (person NULL) until
 * `AIM_SIGN_IN_REQUIRED=true`, which refuses it with 401. Without `BETTER_AUTH_SECRET` sign-in is
 * not configured and every request counts as without a session. When the session lookup fails, a
 * read goes on without a person and a write is refused (503).
 */

export type RouteAuthOptions = {
  /** Writer label for the audit log, `app:/api/<route>`. */
  source: string;
  /** True when the route writes; reads are never refused. */
  write: boolean;
};

export type RouteAuthDeps = {
  sessionUser: (req: Request) => Promise<SessionUser | null>;
  signInRequired: () => boolean;
  signInConfigured: () => boolean;
};

const WRITE_BLOCK_MESSAGES: Record<WriteBlock, string> = {
  not_linked: "account not linked to a person",
  impersonated: "writes are not allowed in an impersonated session",
};
const SIGN_IN_REQUIRED_MESSAGE = "sign-in required";
const SESSION_LOOKUP_FAILED_MESSAGE = "sign-in check unavailable";

const defaultDeps: RouteAuthDeps = {
  sessionUser: getSessionUser,
  signInRequired: () => process.env.AIM_SIGN_IN_REQUIRED === "true",
  signInConfigured: () => Boolean(process.env.BETTER_AUTH_SECRET),
};

export function withRequestAuth<A extends [Request, ...unknown[]]>(
  handler: (...args: A) => Promise<Response> | Response,
  opts: RouteAuthOptions,
  deps: RouteAuthDeps = defaultDeps
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const [req] = args;
    let user: SessionUser | null = null;
    if (deps.signInConfigured()) {
      try {
        user = await deps.sessionUser(req);
      } catch (err) {
        // A read goes on without a person; a write must not run with the wrong attribution.
        console.error(`[auth] ${opts.source}: session lookup failed`, err);
        if (opts.write) return NextResponse.json({ error: SESSION_LOOKUP_FAILED_MESSAGE }, { status: 503 });
      }
    }

    if (opts.write) {
      if (user?.writeBlock) {
        console.warn(`[auth] ${opts.source}: write refused (${user.writeBlock}) for user ${user.userId}`);
        return NextResponse.json({ error: WRITE_BLOCK_MESSAGES[user.writeBlock] }, { status: 403 });
      }
      if (!user && deps.signInRequired()) {
        return NextResponse.json({ error: SIGN_IN_REQUIRED_MESSAGE }, { status: 401 });
      }
    }

    return withAuditContext({ personId: user?.personId ?? null, source: opts.source }, () => handler(...args));
  };
}
