import "server-only";

import type { AskAction } from "@/lib/llm/actions";

import { currentCaller } from "./caller";
import { LIVE_TEST_SUFFIX } from "./protocol";

/**
 * Live command channel (D-079): the server broadcasts UI actions (navigation URLs from the
 * whitelist) via the Supabase Realtime Broadcast REST API. A viewer subscribed to the
 * channel executes them like the AI dock. Fire-and-forget - we do not know whether anyone is listening.
 */

/** Event in the channel the client listens to (`components/live-channel.tsx`). */
export const LIVE_EVENT = "command";

export interface LivePayload {
  actions: AskAction[];
  /** Who sent the command (shown in the viewer). */
  from: string;
  sentAt: string;
  /** Command id for the `applied` acknowledgement (D-101). */
  cmdId?: string;
  /** Conversation that sent the command (D-159): the viewer accepts commands only from its own chat. */
  sid?: string;
}

/** Production channel (`LIVE_CHANNEL`) regardless of the caller: data changes (BCF, revisions) belong to the user. */
export function liveBaseChannel(): string | null {
  const c = process.env.LIVE_CHANNEL?.trim();
  return c ? c : null;
}

/**
 * Channel for the caller's commands and questions (D-159): a working session (Claude Code) gets the test
 * channel `<LIVE_CHANNEL>-test`, the user's chat the production one. The viewer picks the channel in the status bar.
 */
export function liveChannel(): string | null {
  const base = liveBaseChannel();
  if (!base) return null;
  return currentCaller()?.work ? `${base}${LIVE_TEST_SUFFIX}` : base;
}

/** Test channel of working sessions (D-159)? */
export const isTestChannel = (channel: string) => channel.endsWith(LIVE_TEST_SUFFIX);

/** `sid` into the command: binding the viewer to a chat can be turned off with `LIVE_OWNER_LOCK=0` (D-159). */
export function commandSid(): string | undefined {
  if (process.env.LIVE_OWNER_LOCK?.trim() === "0") return undefined;
  return currentCaller()?.sid;
}

export function buildBroadcastBody(channel: string, payload: LivePayload) {
  return {
    messages: [{ topic: channel, event: LIVE_EVENT, payload, private: false }],
  };
}

export async function broadcastLive(
  channel: string,
  actions: AskAction[],
  fetchImpl: typeof fetch = fetch,
  cmdId?: string,
): Promise<{ ok: boolean; status: number }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 0 };

  const sid = commandSid();
  const payload: LivePayload = {
    actions,
    from: "Claude",
    sentAt: new Date().toISOString(),
    ...(cmdId ? { cmdId } : {}),
    ...(sid ? { sid } : {}),
  };
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildBroadcastBody(channel, payload)),
  });
  return { ok: res.ok, status: res.status };
}

/**
 * An event other than commands (e.g. "BCF topics changed", D-099): the same REST
 * broadcast, its own event name and payload.
 */
export async function broadcastLiveEvent(
  channel: string,
  event: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, status: 0 };
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: [{ topic: channel, event, payload, private: false }] }),
  });
  return { ok: res.ok, status: res.status };
}
