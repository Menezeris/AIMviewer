import { describe, expect, it, vi } from "vitest";

import { auditHeaders } from "@/lib/audit/context";

import { withRequestAuth, type RouteAuthDeps } from "./request";
import type { SessionUser } from "./session";

const PERSON = "0198a000-0000-7000-8000-000000000001";
const SOURCE = "app:/api/saved-views";

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "0198a000-0000-7000-8000-0000000000a1",
    personId: PERSON,
    email: "fm@x.test",
    name: "Facility Manager",
    role: "user",
    sessionId: "0198a000-0000-7000-8000-0000000000b1",
    impersonatedBy: null,
    writeBlock: null,
    ...overrides,
  };
}

function deps(found: SessionUser | null, overrides: Partial<RouteAuthDeps> = {}): RouteAuthDeps {
  return {
    sessionUser: vi.fn(async () => found),
    signInRequired: () => false,
    signInConfigured: () => true,
    ...overrides,
  };
}

/** A handler that answers with the audit headers it would send to PostgREST. */
const echoHeaders = async () => Response.json(auditHeaders());

async function call(found: SessionUser | null, write: boolean, overrides: Partial<RouteAuthDeps> = {}) {
  const route = withRequestAuth(echoHeaders, { source: SOURCE, write }, deps(found, overrides));
  return route(new Request("https://aim.test/api/saved-views", { method: write ? "POST" : "GET" }));
}

describe("withRequestAuth (D-200)", () => {
  it("runs a write with the person and the source of the session", async () => {
    const res = await call(user(), true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "x-aim-source": SOURCE, "x-aim-person-id": PERSON });
  });

  it("refuses a write of an account without a person, but lets it read", async () => {
    const unlinked = user({ personId: null, writeBlock: "not_linked" });
    const write = await call(unlinked, true);
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: "account not linked to a person" });

    const read = await call(unlinked, false);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ "x-aim-source": SOURCE });
  });

  it("refuses a write in an impersonated session", async () => {
    const res = await call(user({ impersonatedBy: "0198a000-0000-7000-8000-0000000000ad", writeBlock: "impersonated" }), true);
    expect(res.status).toBe(403);
  });

  it("keeps anonymous writes as today until sign-in is required", async () => {
    const open = await call(null, true);
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ "x-aim-source": SOURCE });

    const required = await call(null, true, { signInRequired: () => true });
    expect(required.status).toBe(401);

    const read = await call(null, false, { signInRequired: () => true });
    expect(read.status).toBe(200);
  });

  it("does not look up a session when sign-in is not configured", async () => {
    const sessionUser = vi.fn(async () => user());
    const res = await call(null, true, { signInConfigured: () => false, sessionUser });
    expect(res.status).toBe(200);
    expect(sessionUser).not.toHaveBeenCalled();
  });

  it("reads without a person but refuses a write when the session lookup fails", async () => {
    const failing = { sessionUser: vi.fn(async () => Promise.reject(new Error("platform_api not exposed"))) };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call(null, false, failing)).status).toBe(200);
    expect((await call(null, true, failing)).status).toBe(503);
    error.mockRestore();
  });
});
