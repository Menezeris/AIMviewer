import { describe, expect, it, vi } from "vitest";
import { auditHeaders, withAuditContext, withAuditHeaders } from "./context";

const PERSON = "11111111-2222-3333-4444-555555555555";

describe("audit context (D-196)", () => {
  it("defaults to source app without a person", () => {
    expect(auditHeaders()).toEqual({ "x-aim-source": "app" });
  });

  it("sends person and source inside a context", () => {
    const h = withAuditContext({ personId: PERSON, source: "app:/api/bcf" }, () => auditHeaders());
    expect(h).toEqual({ "x-aim-source": "app:/api/bcf", "x-aim-person-id": PERSON });
  });

  it("drops a person that is not a UUID", () => {
    const h = withAuditContext({ personId: "x'; drop", source: "mcp" }, () => auditHeaders());
    expect(h).toEqual({ "x-aim-source": "mcp" });
  });

  it("keeps the context across awaits", async () => {
    const h = await withAuditContext({ personId: PERSON, source: "fork" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return auditHeaders();
    });
    expect(h["x-aim-source"]).toBe("fork");
  });

  it("adds the headers to every fetch and keeps the caller's headers", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const f = withAuditHeaders(base as unknown as typeof fetch);
    await withAuditContext({ personId: PERSON, source: "app:/api/x" }, () =>
      f("https://db/rest/v1/objects", { method: "POST", headers: { apikey: "k" } }),
    );
    const init = (base.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = new Headers(init.headers);
    expect(h.get("apikey")).toBe("k");
    expect(h.get("x-aim-person-id")).toBe(PERSON);
    expect(h.get("x-aim-source")).toBe("app:/api/x");
    expect(init.method).toBe("POST");
  });
});
