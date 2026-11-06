import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who writes (D-196, R12): the person and the source of the current request, sent to PostgREST as the
 * headers `x-aim-person-id` and `x-aim-source` on every call of the server client. The database
 * function `aim_pre_request` copies them into `app.person_id` / `app.source`, which the audit triggers
 * record. It trusts them only for the service_role key, which only this server holds.
 *
 * API routes get the context from `withRequestAuth` (`lib/auth/request.ts`, D-200): the person of the
 * platform session and the route as the source. Without a context the source is `app`.
 */
export type AuditContext = {
  /** IfcPerson node id (`platform.users.person_id`); null without a linked session. */
  personId?: string | null;
  /** Writer label: `app`, `app:<route>`, `mcp`, `fork`, `telegram` ... */
  source: string;
};

const store = new AsyncLocalStorage<AuditContext>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function currentAuditContext(): AuditContext | undefined {
  return store.getStore();
}

/** Headers for the current request; the person only when it is a UUID. */
export function auditHeaders(): Record<string, string> {
  const ctx = store.getStore();
  const headers: Record<string, string> = { "x-aim-source": (ctx?.source || "app").slice(0, 200) };
  if (ctx?.personId && UUID.test(ctx.personId)) headers["x-aim-person-id"] = ctx.personId;
  return headers;
}

/** Wraps a fetch so every request carries the audit headers of the current context. */
export function withAuditHeaders(baseFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [k, v] of Object.entries(auditHeaders())) headers.set(k, v);
    return baseFetch(input, { ...init, headers });
  };
}
