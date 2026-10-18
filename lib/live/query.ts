import "server-only";

import { randomUUID } from "node:crypto";

import {
  LIVE_QUERY_EVENT,
  LIVE_REPLY_EVENT,
  isLiveReply,
  type LiveQueryPayload,
  type LiveReplyPayload,
  type ViewerQuery,
} from "./protocol";

/**
 * Otázka do otvoreného viewera (D-085): server sa pripojí na živý kanál
 * (Supabase Realtime, D-079), pošle `query` a čaká na `reply` s rovnakým id.
 * Na rozdiel od príkazov to nie je fire-and-forget: bez otvoreného viewera
 * s `?live=` príde timeout a tool to povie, nie "odoslané".
 */

export const QUERY_TIMEOUT_MS = 8000;

/** Minimálne rozhranie kanála - supabase-js `RealtimeChannel`, v testoch náhrada. */
export interface QueryChannel {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload?: unknown }) => void): QueryChannel;
  subscribe(cb: (status: string) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: unknown }): Promise<unknown>;
  close(): void;
}

export type QueryOutcome =
  | { ok: true; reply: LiveReplyPayload }
  | { ok: false; reason: "not_configured" | "channel_error" | "timeout" };

async function connect(channel: string): Promise<QueryChannel | null> {
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
  opts: { timeoutMs?: number; open?: (channel: string) => Promise<QueryChannel | null> } = {},
): Promise<QueryOutcome> {
  const ch = await (opts.open ?? connect)(channel);
  if (!ch) return { ok: false, reason: "not_configured" };
  const payload: LiveQueryPayload = { id: randomUUID(), query, ...(guids.length ? { guids } : {}) };

  return new Promise<QueryOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: QueryOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ch.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => done({ ok: false, reason: "timeout" }), opts.timeoutMs ?? QUERY_TIMEOUT_MS);
    ch.on("broadcast", { event: LIVE_REPLY_EVENT }, ({ payload: p }) => {
      if (isLiveReply(p) && p.id === payload.id) done({ ok: true, reply: p });
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
