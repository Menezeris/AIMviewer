import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LIVE_QUERY_EVENT, LIVE_REPLY_EVENT } from "./protocol";
import { queryLiveViewer, type QueryChannel } from "./query";

/** Falošný kanál: zachytí odoslanú otázku a dovolí "viewerom" odpovedať. */
function fakeChannel(status = "SUBSCRIBED") {
  const listeners: ((m: { payload?: unknown }) => void)[] = [];
  const sent: { event: string; payload: { id: string } }[] = [];
  let closed = false;
  const ch: QueryChannel = {
    on: (_t, filter, cb) => {
      if (filter.event === LIVE_REPLY_EVENT) listeners.push(cb);
      return ch;
    },
    subscribe: (cb) => queueMicrotask(() => cb(status)),
    send: async (msg) => {
      sent.push(msg as (typeof sent)[number]);
    },
    close: () => {
      closed = true;
    },
  };
  return {
    open: async () => ch,
    sent,
    reply: (payload: unknown) => listeners.forEach((l) => l({ payload })),
    isClosed: () => closed,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("otázka do živého viewera (D-085)", () => {
  it("pošle query a vráti odpoveď s rovnakým id, cudzie id ignoruje", async () => {
    const f = fakeChannel();
    const pending = queryLiveViewer("kanal", "bounds", ["G"], { open: f.open, timeoutMs: 1000 });
    await tick();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ event: LIVE_QUERY_EVENT, payload: { query: "bounds", guids: ["G"] } });
    const id = f.sent[0].payload.id;
    f.reply({ id: "iny", ok: true, result: { cudzie: true } });
    f.reply({ id, ok: true, result: { model: 1 } });
    await expect(pending).resolves.toEqual({ ok: true, reply: { id, ok: true, result: { model: 1 } } });
    expect(f.isClosed()).toBe(true);
  });

  it("bez viewera timeout, bez konfigurácie not_configured, zlyhaný kanál channel_error", async () => {
    const f = fakeChannel();
    await expect(queryLiveViewer("k", "view_state", [], { open: f.open, timeoutMs: 20 })).resolves.toEqual({
      ok: false,
      reason: "timeout",
    });
    expect(f.isClosed()).toBe(true);
    await expect(queryLiveViewer("k", "view_state", [], { open: async () => null })).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
    const bad = fakeChannel("CHANNEL_ERROR");
    await expect(queryLiveViewer("k", "view_state", [], { open: bad.open, timeoutMs: 1000 })).resolves.toEqual({
      ok: false,
      reason: "channel_error",
    });
  });
});

describe("počty AIM chat lens (D-096)", () => {
  it("lens_state nesie rev a odpoveď viewera sa vráti ako text pre model", async () => {
    const { lensCountsText } = await import("./lens-counts");
    const f = fakeChannel();
    const pending = lensCountsText("kanal", "r1", (ch, q, g, opts) => queryLiveViewer(ch, q, g, { ...opts, open: f.open }));
    await tick();
    expect(f.sent[0].payload).toMatchObject({ query: "lens_state", rev: "r1" });
    f.reply({ id: f.sent[0].payload.id, ok: true, result: { active: true, rules: [{ name: "Prívod", count: 8 }] } });
    expect(await pending).toContain('"count":8');
  });

  it("timeout a chyba viewera povedia, že počty nie sú, nie že lens zlyhala", async () => {
    const { lensCountsText } = await import("./lens-counts");
    expect(await lensCountsText("k", "r", async () => ({ ok: false, reason: "timeout" }))).toMatch(/neprišli/);
    expect(await lensCountsText("k", "r", async () => ({ ok: true, reply: { id: "x", ok: false, error: "boom" } }))).toMatch(/boom/);
  });
});

describe("zber odpovedí viacerých okien (D-125)", () => {
  it("s collectMs vráti prvú odpoveď a odpovede ďalších okien, to isté okno znova nie", async () => {
    const f = fakeChannel();
    const pending = queryLiveViewer("kanal", "view_state", [], { open: f.open, timeoutMs: 1000, collectMs: 30 });
    await tick();
    const id = f.sent[0].payload.id;
    f.reply({ id, ok: true, result: 1, viewer: "a" });
    f.reply({ id, ok: true, result: 2, viewer: "b" });
    f.reply({ id, ok: true, result: 3, viewer: "a" });
    const out = await pending;
    expect(out.ok && out.reply.viewer).toBe("a");
    expect(out.ok && out.others?.map((r) => r.viewer)).toEqual(["b"]);
  });

  it("bez collectMs skončí hneď pri prvej odpovedi (doterajšie správanie)", async () => {
    const f = fakeChannel();
    const pending = queryLiveViewer("kanal", "view_state", [], { open: f.open, timeoutMs: 1000 });
    await tick();
    f.reply({ id: f.sent[0].payload.id, ok: true, result: 1, viewer: "a" });
    const out = await pending;
    expect(out.ok && out.others).toBeUndefined();
  });

  it("timeout počas zberu vráti prvú odpoveď, nie chybu", async () => {
    const f = fakeChannel();
    const pending = queryLiveViewer("kanal", "view_state", [], { open: f.open, timeoutMs: 20, collectMs: 500 });
    await tick();
    f.reply({ id: f.sent[0].payload.id, ok: true, result: 1, viewer: "a" });
    const out = await pending;
    expect(out.ok).toBe(true);
  });
});
