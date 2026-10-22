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
  /** `others` = odpovede ďalších okien (iné `viewer`) počas `collectMs` po prvej (D-125). */
  | { ok: true; reply: LiveReplyPayload; others?: LiveReplyPayload[] }
  | { ok: false; reason: "not_configured" | "channel_error" | "timeout" };

/**
 * Zber odpovedí na jednu otázku: prvá vyhrá, s `collectMs` sa ešte chvíľu čaká na odpovede
 * ďalších okien (D-125). Odpoveď toho istého okna znova sa nepočíta.
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
    /** Pri vypršaní času: ak už prišla prvá odpoveď, vráti ju (zber sa skončí skôr). */
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
  const payload: LiveQueryPayload = {
    id: randomUUID(),
    query,
    ...(guids.length ? { guids } : {}),
    ...(opts.rev ? { rev: opts.rev } : {}),
  };
  // Teplý kanál inštancie (D-101): bez nového websocketu a prihlásenia pri každej otázke.
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
