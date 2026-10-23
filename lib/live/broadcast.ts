import "server-only";

import type { AskAction } from "@/lib/llm/actions";

import { currentCaller } from "./caller";
import { LIVE_TEST_SUFFIX } from "./protocol";

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
  /** Rozhovor, ktorý príkaz poslal (D-159): viewer prijíma príkazy len od svojho chatu. */
  sid?: string;
}

/** Produkčný kanál (`LIVE_CHANNEL`) bez ohľadu na volajúceho: zmeny dát (BCF, revízie) patria používateľovi. */
export function liveBaseChannel(): string | null {
  const c = process.env.LIVE_CHANNEL?.trim();
  return c ? c : null;
}

/**
 * Kanál pre príkazy a otázky volajúceho (D-159): pracovná session (Claude Code) dostane testovací
 * kanál `<LIVE_CHANNEL>-test`, chat používateľa produkčný. Viewer si kanál vyberie v stavovej lište.
 */
export function liveChannel(): string | null {
  const base = liveBaseChannel();
  if (!base) return null;
  return currentCaller()?.work ? `${base}${LIVE_TEST_SUFFIX}` : base;
}

/** Testovací kanál pracovných sessions (D-159)? */
export const isTestChannel = (channel: string) => channel.endsWith(LIVE_TEST_SUFFIX);

/** `sid` do príkazu: viazanie viewera na chat sa dá vypnúť `LIVE_OWNER_LOCK=0` (D-159). */
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
