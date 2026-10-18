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
