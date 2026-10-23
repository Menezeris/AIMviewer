import type { ViewerOwner } from "./protocol";

/**
 * Okno viewera prijíma príkazy len od svojho chatu (D-159). Vlastník = rozhovor (`sid`) prvého
 * prijatého príkazu po načítaní stránky; príkaz z iného rozhovoru sa nevykoná. Bez príkazu od
 * vlastníka 15 min prevezme okno ďalší chat sám, inak ho používateľ prevezme tlačidlom Prevziať.
 * Príkaz bez `sid` (starší server, `LIVE_OWNER_LOCK=0`, klient bez `Mcp-Session-Id`) sa prijme.
 */

export const OWNER_IDLE_MS = 15 * 60_000;

export interface OwnerState {
  sid: string | null;
  /** Kedy prišiel posledný príkaz od vlastníka (ms). */
  at: number;
}

export const NO_OWNER: OwnerState = { sid: null, at: 0 };

const free = (s: OwnerState, now: number) => s.sid === null || now - s.at > OWNER_IDLE_MS;

/** Príkaz od `sid`: prijať (a s ním nový stav) alebo odmietnuť ako cudzí. */
export function decideOwner(state: OwnerState, sid: string | undefined, now: number): { accept: boolean; state: OwnerState } {
  if (!sid) return { accept: true, state };
  if (state.sid === sid || free(state, now)) return { accept: true, state: { sid, at: now } };
  return { accept: false, state };
}

/** Pre odpoveď na otázku (`get_viewer_state`): kto ovláda okno z pohľadu `sid`. */
export function ownerFor(state: OwnerState, sid: string | undefined, now: number): ViewerOwner {
  if (free(state, now)) return "none";
  return sid !== undefined && state.sid === sid ? "you" : "other";
}

/** Používateľ klikol Prevziať: okno odteraz patrí rozhovoru `sid`. */
export function takeOver(sid: string, now: number): OwnerState {
  return { sid, at: now };
}
