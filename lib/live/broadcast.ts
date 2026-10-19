import "server-only";

import type { AskAction } from "@/lib/llm/actions";

/**
 * Živý príkazový kanál (D-079): server odvysiela UI akcie (navigačné URL zo
 * whitelistu) cez Supabase Realtime Broadcast REST API. Viewer prihlásený na
 * kanál ich vykoná ako AI dock. Fire-and-forget — nevieme, či niekto počúva.
 */

/** Udalosť v kanáli, na ktorú počúva klient (`components/live-channel.tsx`). */
export const LIVE_EVENT = "command";

export interface LivePayload {
  actions: AskAction[];
  /** Kto príkaz poslal (zobrazí sa vo vieweri). */
  from: string;
  sentAt: string;
  /** Id príkazu pre potvrdenie `applied` (D-101). */
  cmdId?: string;
}

export function liveChannel(): string | null {
  const c = process.env.LIVE_CHANNEL?.trim();
  return c ? c : null;
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

  const payload: LivePayload = { actions, from: "Claude", sentAt: new Date().toISOString(), ...(cmdId ? { cmdId } : {}) };
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
 * Iná udalosť než príkazy (napr. "témy BCF sa zmenili", D-099): ten istý REST
 * broadcast, vlastné meno udalosti a payload.
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
