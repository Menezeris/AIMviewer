import "server-only";

import { fireRoutine, routineConfigured, type RoutineConfig } from "@/lib/feedback/routine";
import { LIVE_BCF_EVENT } from "@/lib/live/bcf-event";
import { broadcastLiveEvent, liveBaseChannel, liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { resolveTargets } from "@/lib/llm/view-tools";

import { currentProjectId } from "../project/context";
import { supabaseBcfStore } from "./store";
import { viewFromState, type BcfDeps, type CapturedView } from "./tools";

/**
 * Production dependencies of the BCF tools (D-099): DB, live viewer and the routine
 * "AIM: BCF téma". The logic is in `tools.ts` and is tested without them.
 */

/** The routine "AIM: BCF téma" - different from the one for tool requests (D-090), it has the OCB repo. */
export function bcfRoutine(): RoutineConfig {
  return {
    url: process.env.CLAUDE_BCF_ROUTINE_FIRE_URL,
    token: process.env.CLAUDE_BCF_ROUTINE_TOKEN,
    env: "CLAUDE_BCF_ROUTINE_FIRE_URL, CLAUDE_BCF_ROUTINE_TOKEN",
  };
}

/** Cap on concurrent BCF sessions (env `BCF_MAX_SESSIONS`, default 3). */
export function bcfMaxSessions(): number {
  const n = Number.parseInt(process.env.BCF_MAX_SESSIONS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** `view_state` of the live viewer (D-085); string = why it could not be read. */
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

/** `view_state` -> BCF viewpoint; string = why it could not be captured. */
export async function captureLiveView(): Promise<CapturedView | string> {
  const state = await liveViewState();
  return typeof state === "string" ? state : viewFromState(state);
}

/** "Topics changed" to the live channel; an open viewer reloads them. */
export async function notifyBcfChanged(): Promise<void> {
  // A data change belongs to the user's viewer even when a working session made it (D-159).
  const channel = liveBaseChannel();
  if (channel) await broadcastLiveEvent(channel, LIVE_BCF_EVENT, { at: new Date().toISOString() });
}

export function defaultBcfDeps(): BcfDeps {
  const cfg = bcfRoutine();
  return {
    store: supabaseBcfStore(currentProjectId()),
    fire: routineConfigured(cfg) ? (text) => fireRoutine(text, fetch, cfg) : null,
    captureView: captureLiveView,
    viewState: liveViewState,
    resolve: resolveTargets,
    now: () => new Date(),
    maxSessions: bcfMaxSessions(),
    notify: notifyBcfChanged,
  };
}
