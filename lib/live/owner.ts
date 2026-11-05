import type { ViewerOwner } from "./protocol";

/**
 * A viewer window accepts commands only from its own chat (D-159). The owner = the conversation (`sid`) of the first
 * command accepted after the page loads; a command from another conversation is not executed. Without a command from
 * the owner for 15 min another chat takes over the window on its own, otherwise the user takes it over with the Take over button.
 * A command without `sid` (older server, `LIVE_OWNER_LOCK=0`, client without `Mcp-Session-Id`) is accepted.
 */

export const OWNER_IDLE_MS = 15 * 60_000;

export interface OwnerState {
  sid: string | null;
  /** When the last command from the owner arrived (ms). */
  at: number;
}

export const NO_OWNER: OwnerState = { sid: null, at: 0 };

const free = (s: OwnerState, now: number) => s.sid === null || now - s.at > OWNER_IDLE_MS;

/** Command from `sid`: accept (and with it the new state) or reject as foreign. */
export function decideOwner(state: OwnerState, sid: string | undefined, now: number): { accept: boolean; state: OwnerState } {
  if (!sid) return { accept: true, state };
  if (state.sid === sid || free(state, now)) return { accept: true, state: { sid, at: now } };
  return { accept: false, state };
}

/** For answering a question (`get_viewer_state`): who controls the window from the point of view of `sid`. */
export function ownerFor(state: OwnerState, sid: string | undefined, now: number): ViewerOwner {
  if (free(state, now)) return "none";
  return sid !== undefined && state.sid === sid ? "you" : "other";
}

/** The user clicked Take over: from now on the window belongs to conversation `sid`. */
export function takeOver(sid: string, now: number): OwnerState {
  return { sid, at: now };
}
