import "server-only";

import { fireRoutine, routineConfigured, type RoutineConfig } from "@/lib/feedback/routine";
import { LIVE_BCF_EVENT } from "@/lib/live/bcf-event";
import { broadcastLiveEvent, liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { resolveTargets } from "@/lib/llm/view-tools";

import { supabaseBcfStore } from "./store";
import { viewFromState, type BcfDeps, type CapturedView } from "./tools";

/**
 * Produkčné závislosti BCF tools (D-099): DB, živý viewer a routine
 * "AIM: BCF téma". Logika je v `tools.ts` a testuje sa bez nich.
 */

/** Routine "AIM: BCF téma" - iná než pre požiadavky na tools (D-090), má repo OCB. */
export function bcfRoutine(): RoutineConfig {
  return {
    url: process.env.CLAUDE_BCF_ROUTINE_FIRE_URL,
    token: process.env.CLAUDE_BCF_ROUTINE_TOKEN,
    env: "CLAUDE_BCF_ROUTINE_FIRE_URL, CLAUDE_BCF_ROUTINE_TOKEN",
  };
}

/** Strop súbežných BCF sessions (env `BCF_MAX_SESSIONS`, predvolene 3). */
export function bcfMaxSessions(): number {
  const n = Number.parseInt(process.env.BCF_MAX_SESSIONS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** `view_state` živého viewera (D-085); string = prečo sa nedal prečítať. */
export async function liveViewState(): Promise<Record<string, unknown> | string> {
  const channel = liveChannel();
  if (!channel) return "živý viewer nie je nastavený (LIVE_CHANNEL)";
  const outcome = await queryLiveViewer(channel, "view_state");
  if (!outcome.ok) {
    return outcome.reason === "timeout" ? "viewer neodpovedal (nie je otvorený s ?live=)" : "kanál viewera zlyhal";
  }
  if (!outcome.reply.ok) return `viewer odpovedal chybou: ${outcome.reply.error}`;
  const r = outcome.reply.result;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : {};
}

/** `view_state` -> BCF pohľad; string = prečo sa nedal zachytiť. */
export async function captureLiveView(): Promise<CapturedView | string> {
  const state = await liveViewState();
  return typeof state === "string" ? state : viewFromState(state);
}

/** "Témy sa zmenili" na živý kanál; otvorený viewer si ich načíta znova. */
export async function notifyBcfChanged(): Promise<void> {
  const channel = liveChannel();
  if (channel) await broadcastLiveEvent(channel, LIVE_BCF_EVENT, { at: new Date().toISOString() });
}

export function defaultBcfDeps(): BcfDeps {
  const cfg = bcfRoutine();
  return {
    store: supabaseBcfStore(),
    fire: routineConfigured(cfg) ? (text) => fireRoutine(text, fetch, cfg) : null,
    captureView: captureLiveView,
    viewState: liveViewState,
    resolve: resolveTargets,
    now: () => new Date(),
    maxSessions: bcfMaxSessions(),
    notify: notifyBcfChanged,
  };
}
