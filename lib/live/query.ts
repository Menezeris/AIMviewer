import "server-only";

import { randomUUID } from "node:crypto";

import { currentCaller } from "./caller";
import {
  LIVE_QUERY_EVENT,
  LIVE_REPLY_EVENT,
  isLiveReply,
  type LiveQueryPayload,
  type LiveReplyPayload,
  type ViewerQuery,
} from "./protocol";

/**
 * A question to an open viewer (D-085): the server connects to the live channel
 * (Supabase Realtime, D-079), sends `query` and waits for a `reply` with the same id.
 * Unlike commands this is not fire-and-forget: without an open viewer
 * with `?live=` a timeout comes and the tool says so, not "sent".
 */

export const QUERY_TIMEOUT_MS = 8000;

/** Minimal channel interface - supabase-js `RealtimeChannel`, a stand-in in tests. */
export interface QueryChannel {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void): QueryChannel;
  subscribe(cb: (status: string) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
  close(): void;
}

export type QueryOutcome =
  /** `others` = answers of further windows (other `viewer`) during `collectMs` after the first (D-125). */
  | { ok: true; reply: LiveReplyPayload; others?: LiveReplyPayload[] }
  | { ok: false; reason: "not_configured" | "channel_error" | "timeout" };

/**
 * Collecting answers to one question: the first wins, with `collectMs` it waits a little longer for answers
 * of further windows (D-125). A repeated answer from the same window does not count.
 */
function collector(collectMs: number | undefined, done: (o: QueryOutcome) => void) {
  let first: LiveReplyPayload | null = null;
  const others: LiveReplyPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    add(p: LiveReplyPayload) {
      if (!first) {
        first = p;
        if (!collectMs) done({ ok: true, reply: p });
        else timer = setTimeout(() => done({ ok: true, reply: p, others }), collectMs);
        return;
      }
      const seen = [first, ...others].some((r) => r.viewer !== undefined && r.viewer === p.viewer);
      if (!seen) others.push(p);
    },
    /** On timeout: if the first answer already arrived, returns it (collecting ends earlier). */
    settle(): boolean {
      if (!first) return false;
      clearTimeout(timer);
      done({ ok: true, reply: first, others });
      return true;
    },
  };
}

export async function connect(channel: string): Promise<QueryChannel | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ch = client.channel(channel, { config: { broadcast: { self: false } } });
  const wrapped: QueryChannel = {
    on: (type, filter, cb) => {
      ch.on(type, filter, cb);
      return wrapped;
    },
    subscribe: (cb) => ch.subscribe((s) => cb(String(s))),
    send: (msg) => ch.send(msg),
    close: () => {
      void client.removeChannel(ch);
    },
  };
  return wrapped;
}

export async function queryLiveViewer(
  channel: string,
  query: ViewerQuery,
  guids: string[] = [],
  opts: { timeoutMs?: number; rev?: string; collectMs?: number; open?: (channel: string) => Promise<QueryChannel | null> } = {},
): Promise<QueryOutcome> {
  const sid = currentCaller()?.sid;
  const payload: LiveQueryPayload = {
    id: randomUUID(),
    query,
    ...(guids.length ? { guids } : {}),
    ...(opts.rev ? { rev: opts.rev } : {}),
    ...(sid ? { sid } : {}),
  };
  // Warm channel of the instance (D-101): no new websocket and subscription for every question.
  if (!opts.open) {
    const { warmChannel } = await import("./warm-channel");
    const warm = await warmChannel(channel);
    if (warm) return askWarm(warm, payload, opts.timeoutMs ?? QUERY_TIMEOUT_MS, opts.collectMs);
  }
  const ch = await (opts.open ?? connect)(channel);
  if (!ch) return { ok: false, reason: "not_configured" };

  return new Promise<QueryOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: QueryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ch.close();
      resolve(outcome);
    };
    const replies = collector(opts.collectMs, done);
    const timer = setTimeout(() => replies.settle() || done({ ok: false, reason: "timeout" }), opts.timeoutMs ?? QUERY_TIMEOUT_MS);
    ch.on("broadcast", { event: LIVE_REPLY_EVENT }, ({ payload: p }) => {
      if (isLiveReply(p) && p.id === payload.id) replies.add(p);
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: LIVE_QUERY_EVENT, payload }).catch(() => done({ ok: false, reason: "channel_error" }));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        done({ ok: false, reason: "channel_error" });
      }
    });
  });
}

async function askWarm(
  warm: import("./warm-channel").WarmChannel,
  payload: LiveQueryPayload,
  timeoutMs: number,
  collectMs?: number,
): Promise<QueryOutcome> {
  return new Promise<QueryOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: QueryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(outcome);
    };
    const replies = collector(collectMs, done);
    const timer = setTimeout(() => replies.settle() || done({ ok: false, reason: "timeout" }), timeoutMs);
    const off = warm.onReply(payload.id, (reply) => replies.add(reply));
    warm.send(LIVE_QUERY_EVENT, payload).catch(() => done({ ok: false, reason: "channel_error" }));
  });
}
