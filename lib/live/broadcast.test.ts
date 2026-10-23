import { afterEach, describe, expect, it, vi } from "vitest";

// Modul je server-only (D-026) — mimo RSC runtime treba marker odmockovať.
vi.mock("server-only", () => ({}));

import { bcfLoadMessage, LIVE_BCF_EVENT } from "./bcf-event";
import { broadcastLive, broadcastLiveEvent, buildBroadcastBody, LIVE_EVENT } from "./broadcast";

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

describe("udalosť BCF tém (D-099 dodatok)", () => {
  it("broadcastLiveEvent pošle vlastnú udalosť a payload na kanál", async () => {
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const res = await broadcastLiveEvent("kanal", LIVE_BCF_EVENT, { at: "t" }, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, status: 202 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/realtime/v1/api/broadcast");
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ topic: "kanal", event: "bcf_topics", payload: { at: "t" }, private: false }],
    });
    vi.unstubAllEnvs();
  });

  it("správa mostu ukazuje na BCF API toho istého originu", () => {
    expect(bcfLoadMessage("https://aim.example/")).toEqual({
      type: "AIM_BCF_LOAD",
      baseUrl: "https://aim.example/api/bcf",
      projectId: "aim",
    });
  });
});

describe("kanál podľa volajúceho (D-159)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("pracovná session ide na testovací kanál, chat a zmeny dát na produkčný", async () => {
    vi.stubEnv("LIVE_CHANNEL", "demo");
    const { liveChannel, liveBaseChannel, isTestChannel } = await import("./broadcast");
    const { withCaller } = await import("./caller");
    expect(liveChannel()).toBe("demo");
    expect(withCaller({ sid: "s1", client: "claude-ai", work: false }, () => liveChannel())).toBe("demo");
    expect(withCaller({ sid: "s2", client: "claude-code", work: true }, () => liveChannel())).toBe("demo-test");
    expect(withCaller({ sid: "s2", client: "claude-code", work: true }, () => liveBaseChannel())).toBe("demo");
    expect(isTestChannel("demo-test")).toBe(true);
    expect(isTestChannel("demo")).toBe(false);
  });

  it("príkaz nesie sid rozhovoru; LIVE_OWNER_LOCK=0 ho vynechá", async () => {
    vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret");
    const { withCaller } = await import("./caller");
    const send = async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
      await withCaller({ sid: "s1", client: "claude-ai", work: false }, () =>
        broadcastLive("demo", [{ type: "navigate", url: "/ifc", label: "3D" }], fetchImpl as unknown as typeof fetch, "c1"),
      );
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      return JSON.parse(String(init.body)).messages[0].payload;
    };
    expect(await send()).toMatchObject({ cmdId: "c1", sid: "s1" });
    vi.stubEnv("LIVE_OWNER_LOCK", "0");
    expect((await send()).sid).toBeUndefined();
  });
});
