import "server-only";

import { lookupGuids } from "@/lib/engine/aim-lookup";
import { liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";

import { currentModelRevisions, supabaseSavedViewStore } from "./store";
import type { SavedViewDeps } from "./tools";

/**
 * Produkčné závislosti uložených pohľadov (D-117): DB a živý viewer.
 * Logika je v `tools.ts` a `plan.ts` a testuje sa bez nich.
 */

/** Surová odpoveď `view_state` (D-085); string = prečo sa nedala prečítať (vzor `captureLiveView`, D-099). */
async function liveViewState(): Promise<unknown> {
  const channel = liveChannel();
  if (!channel) return "živý viewer nie je nastavený (LIVE_CHANNEL)";
  const outcome = await queryLiveViewer(channel, "view_state");
  if (!outcome.ok) {
    return outcome.reason === "timeout" ? "viewer neodpovedal (nie je otvorený s ?live=)" : "kanál viewera zlyhal";
  }
  if (!outcome.reply.ok) return `viewer odpovedal chybou: ${outcome.reply.error}`;
  return outcome.reply.result;
}

async function storeyLabel(guid: string): Promise<string | null> {
  const ref = (await lookupGuids([guid])).get(guid);
  return ref?.object_ref ?? ref?.name ?? null;
}

export function defaultSavedViewDeps(): SavedViewDeps {
  return {
    store: supabaseSavedViewStore(),
    viewState: liveViewState,
    revisions: currentModelRevisions,
    storeyLabel,
    now: () => new Date(),
  };
}
