import { afterEach, describe, expect, it, vi } from "vitest";

// Modul je server-only (D-026) — mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { broadcastLive, buildBroadcastBody, LIVE_EVENT } from "./broadcast";

describe("živý kanál (D-079)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("telo broadcastu cieli na verejný kanál a udalosť command", () => {
    const body = buildBroadcastBody("demo-kanal", {
      actions: [{ type: "navigate", url: "/ifc?focus=A", label: "3D" }],
      from: "Claude",
      sentAt: "t",
    });
    expect(body.messages[0]).toMatchObject({
      topic: "demo-kanal",
      event: LIVE_EVENT,
      private: false,
      payload: { actions: [{ url: "/ifc?focus=A" }] },
    });
  });

  it("posiela na Realtime REST so service_role kľúčom", async () => {
    vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const res = await broadcastLive(
      "demo",
      [{ type: "navigate", url: "/ifc?focus=A", label: "3D" }],
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ ok: true, status: 202 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect((init.headers as Record<string, string>).apikey).toBe("secret");
  });

  it("bez Supabase env nič neposiela", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const fetchImpl = vi.fn();
    const res = await broadcastLive("demo", [], fetchImpl as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
