import { describe, expect, it } from "vitest";

import { initializeClientName, isWorkClient, issueSessionId, readSessionId } from "./session-id";

describe("identita rozhovoru konektora (D-159)", () => {
  it("vydaná hlavička sa overí a nesie sid a meno klienta", () => {
    const id = issueSessionId("claude-code", "tajne", "abc12345");
    expect(id).toMatch(/^[\x21-\x7e]+$/); // viditeľné ASCII, platná hodnota hlavičky
    expect(readSessionId(id, "tajne")).toEqual({ sid: "abc12345", client: "claude-code" });
  });

  it("podvrh, iný kľúč a nezmysel sa neprijmú", () => {
    const id = issueSessionId("claude-ai", "tajne", "abc12345");
    const [sid, , sig] = id.split(".");
    const forged = `${sid}.${Buffer.from("claude-code").toString("base64url")}.${sig}`;
    expect(readSessionId(forged, "tajne")).toBeNull();
    expect(readSessionId(id, "iny")).toBeNull();
    expect(readSessionId("x", "tajne")).toBeNull();
    expect(readSessionId(null, "tajne")).toBeNull();
  });

  it("meno klienta len z initialize, aj v dávke", () => {
    expect(initializeClientName({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai" } } })).toBe("claude-ai");
    expect(initializeClientName([{ method: "ping" }, { method: "initialize", params: {} }])).toBe("unknown");
    expect(initializeClientName({ method: "tools/call" })).toBeNull();
  });

  it("pracovná session = Claude Code podľa mena alebo User-Agent", () => {
    expect(isWorkClient("claude-code")).toBe(true);
    expect(isWorkClient(undefined, "claude-code/2.1.0 (sdk-ts)")).toBe(true);
    expect(isWorkClient("Claude Code")).toBe(true);
    expect(isWorkClient("claude-ai", "python-httpx/0.27")).toBe(false);
    expect(isWorkClient(null, undefined)).toBe(false);
  });
});

describe("volajúci požiadavky (D-159)", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code" } } };

  it("initialize vydá hlavičku, ďalšie volanie s ňou má ten istý rozhovor", async () => {
    const { mcpCaller, callerLabel } = await import("./session-id");
    const first = mcpCaller(h({}), init, "tajne");
    expect(first.issued).toBeTruthy();
    expect(first.caller.work).toBe(true);
    const next = mcpCaller(h({ "mcp-session-id": first.issued! }), { method: "tools/call" }, "tajne");
    expect(next.issued).toBeUndefined();
    expect(next.caller).toEqual(first.caller);
    expect(callerLabel(next.caller)).toBe(`claude-code#${next.caller.sid} (work)`);
  });

  it("bez hlavičky: bez sid, klient z User-Agent; chat nie je pracovná session", async () => {
    const { mcpCaller, callerLabel } = await import("./session-id");
    const { caller } = mcpCaller(h({ "user-agent": "Claude-User" }), { method: "tools/call" }, "tajne");
    expect(caller).toEqual({ sid: undefined, client: "ua:Claude-User", work: false });
    expect(callerLabel(caller)).toBe("ua:Claude-User");
  });
});
