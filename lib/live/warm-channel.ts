import "server-only";

import { connect, type QueryChannel } from "./query";
import {
  LIVE_APPLIED_EVENT,
  LIVE_REPLY_EVENT,
  isLiveApplied,
  isLiveReply,
  type LiveAppliedPayload,
  type LiveReplyPayload,
} from "./protocol";

/**
 * Warm live channel (D-101): one Realtime channel subscription per function
 * instance instead of a new websocket for every question. Answers (`reply`) and
 * command acknowledgements (`applied`) are paired by id. A channel that closes
 * or fails is forgotten and the next call subscribes again.
 */

export interface WarmChannel {
  send(event: string, payload: unknown): Promise<void>;
  onReply(id: string, cb: (p: LiveReplyPayload) => void): () => void;
  onApplied(cmdId: string, cb: (p: LiveAppliedPayload) => void): () => void;
  /** Viewer windows (`viewer`) that answered on the channel within the last `withinMs` (D-125). */
  recentViewers(withinMs: number, now?: number): string[];
}

type Open = (channel: string) => Promise<QueryChannel | null>;

const SUBSCRIBE_TIMEOUT_MS = 4000;
/**
 * An instance may fall asleep between calls and the websocket then silently dies; a channel
 * unused for longer than this is therefore reopened (one extra subscription
 * at the start of the next series of calls).
 */
const IDLE_MS = 60_000;
interface Entry {
  pending: Promise<WarmChannel | null>;
  usedAt: number;
  close: () => void;
}
const cache = new Map<string, Entry>();

export function warmChannel(name: string, open: Open = connect, now = Date.now()): Promise<WarmChannel | null> {
  let entry = cache.get(name);
  if (entry && now - entry.usedAt > IDLE_MS) {
    entry.close();
    cache.delete(name);
    entry = undefined;
  }
  if (!entry) {
    const holder: { entry?: Entry } = {};
    // Forget only its own record - closing the old channel must not drop a new one.
    const forget = () => {
      if (holder.entry && cache.get(name) === holder.entry) cache.delete(name);
    };
    const created = create(name, open, forget);
    entry = { pending: created.then((c) => c?.warm ?? null), usedAt: now, close: () => void created.then((c) => c?.close()) };
    holder.entry = entry;
    cache.set(name, entry);
    void entry.pending.then((w) => {
      if (!w) forget();
    });
  }
  entry.usedAt = now;
  return entry.pending;
}

/** Len pre testy. */
export function forgetWarmChannels(): void {
  cache.clear();
}

async function create(name: string, open: Open, forget: () => void): Promise<{ warm: WarmChannel; close: () => void } | null> {
  const ch = await open(name).catch(() => null);
  if (!ch) return null;
  const replies = new Map<string, (p: LiveReplyPayload) => void>();
  const applied = new Map<string, (p: LiveAppliedPayload) => void>();
  // When each window last answered (D-125): more windows = the state may differ.
  const viewers = new Map<string, number>();
  const sawViewer = (v: string | undefined) => {
    if (v) viewers.set(v, Date.now());
  };
  ch.on("broadcast", { event: LIVE_REPLY_EVENT }, ({ payload }) => {
    if (!isLiveReply(payload)) return;
    sawViewer(payload.viewer);
    replies.get(payload.id)?.(payload);
  });
  ch.on("broadcast", { event: LIVE_APPLIED_EVENT }, ({ payload }) => {
    if (!isLiveApplied(payload)) return;
    sawViewer(payload.viewer);
    applied.get(payload.cmdId)?.(payload);
  });
  const subscribed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), SUBSCRIBE_TIMEOUT_MS);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        resolve(false);
        forget(); // also later: a closed channel is reopened on the next call
      }
    });
  });
  if (!subscribed) {
    ch.close();
    return null;
  }
  const warm: WarmChannel = {
    send: (event, payload) => ch.send({ type: "broadcast", event, payload }).then(() => undefined),
    onReply: (id, cb) => {
      replies.set(id, cb);
      return () => replies.delete(id);
    },
    onApplied: (cmdId, cb) => {
      applied.set(cmdId, cb);
      return () => applied.delete(cmdId);
    },
    recentViewers: (withinMs, now = Date.now()) => [...viewers].filter(([, at]) => now - at <= withinMs).map(([v]) => v),
  };
  return { warm, close: () => ch.close() };
}

/**
 * Subscribes the wait for `applied` with `cmdId` before sending the command (otherwise a
 * fast acknowledgement would arrive before anyone listens). Returns a function that
 * waits at most `timeoutMs`; null = the channel is not available.
 */
export async function expectApplied(
  name: string,
  cmdId: string,
  open: Open = connect,
): Promise<((timeoutMs: number) => Promise<LiveAppliedPayload | null>) | null> {
  const w = await warmChannel(name, open);
  if (!w) return null;
  let resolve!: (p: LiveAppliedPayload) => void;
  const got = new Promise<LiveAppliedPayload>((r) => (resolve = r));
  const off = w.onApplied(cmdId, (p) => resolve(p));
  return async (timeoutMs) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), timeoutMs)));
    try {
      return await Promise.race([got, late]);
    } finally {
      clearTimeout(timer);
      off();
    }
  };
}

/** How many viewer windows on the channel answered within the last `withinMs` (D-125); 0 without a warm channel. */
export async function recentViewerCount(name: string, withinMs: number, open: Open = connect): Promise<number> {
  const w = cache.has(name) ? await warmChannel(name, open) : null;
  return w ? w.recentViewers(withinMs).length : 0;
}
