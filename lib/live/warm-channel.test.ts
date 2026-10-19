import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LIVE_APPLIED_EVENT, LIVE_REPLY_EVENT } from "./protocol";
import type { QueryChannel } from "./query";
import { expectApplied, forgetWarmChannels, warmChannel } from "./warm-channel";

/** Falošný kanál: počíta prihlásenia a dovolí "vieweru" poslať reply a applied. */
function fakeChannel(status = "SUBSCRIBED") {
  const listeners = new Map<string, ((m: { payload?: unknown }) => void)[]>();
  const sent: { event: string; payload: unknown }[] = [];
  let opened = 0;
  let statusCb: ((s: string) => void) | null = null;
  const ch: QueryChannel = {
    on: (_t, filter, cb) => {
      listeners.set(filter.event, [...(listeners.get(filter.event) ?? []), cb]);
      return ch;
    },
    subscribe: (cb) => {
      statusCb = cb;
      queueMicrotask(() => cb(status));
    },
    send: async (msg) => {
      sent.push(msg);
    },
    close: () => {},
  };
  return {
    open: async () => {
      opened++;
      return ch;
    },
    opened: () => opened,
    sent,
    emit: (event: string, payload: unknown) => (listeners.get(event) ?? []).forEach((l) => l({ payload })),
    setStatus: (s: string) => statusCb?.(s),
  };
}

afterEach(() => forgetWarmChannels());

describe("teplý živý kanál (D-101)", () => {
  it("prihlási sa raz na inštanciu, odpovede páruje podľa id", async () => {
    const f = fakeChannel();
    const a = await warmChannel("k", f.open);
    const b = await warmChannel("k", f.open);
    expect(a).toBe(b);
    expect(f.opened()).toBe(1);
    const got: unknown[] = [];
    const off = a!.onReply("q1", (p) => got.push(p));
    f.emit(LIVE_REPLY_EVENT, { id: "iny", ok: true, result: 1 });
    f.emit(LIVE_REPLY_EVENT, { id: "q1", ok: true, result: 2 });
    off();
    f.emit(LIVE_REPLY_EVENT, { id: "q1", ok: true, result: 3 });
    expect(got).toEqual([{ id: "q1", ok: true, result: 2 }]);
  });

  it("po minúte nečinnosti sa kanál otvorí nanovo (zaspatá inštancia)", async () => {
    const f = fakeChannel();
    await warmChannel("k", f.open, 0);
    await warmChannel("k", f.open, 59_000);
    expect(f.opened()).toBe(1);
    await warmChannel("k", f.open, 120_000);
    expect(f.opened()).toBe(2);
  });

  it("zavretý kanál zabudne a ďalšie volanie sa prihlási znova", async () => {
    const f = fakeChannel();
    await warmChannel("k", f.open);
    f.setStatus("CLOSED");
    await warmChannel("k", f.open);
    expect(f.opened()).toBe(2);
  });

  it("expectApplied: potvrdenie, ktoré príde hneď po odoslaní, nezmešká; bez neho null po čase", async () => {
    const f = fakeChannel();
    const wait = await expectApplied("k", "c1", f.open);
    f.emit(LIVE_APPLIED_EVENT, { cmdId: "c1", ok: true, issues: [], state: { isolated_count: 14 } });
    await expect(wait!(1000)).resolves.toEqual({ cmdId: "c1", ok: true, issues: [], state: { isolated_count: 14 } });
    const none = await expectApplied("k", "c2", f.open);
    await expect(none!(20)).resolves.toBeNull();
  });

  it("nedostupný kanál: null, aby route vedela povedať, že viewer nepočúva", async () => {
    const f = fakeChannel("CHANNEL_ERROR");
    await expect(expectApplied("k", "c1", f.open)).resolves.toBeNull();
    await expect(expectApplied("k", "c1", async () => null)).resolves.toBeNull();
  });
});
