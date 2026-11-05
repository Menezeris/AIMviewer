import "server-only";

import { randomUUID } from "node:crypto";

import { lookupGuids } from "@/lib/engine/aim-lookup";
import { ACK_TIMEOUT_MS, FOREIGN_REJECTED_TEXT } from "@/lib/live/applied-text";
import { broadcastLive, broadcastLiveEvent, isTestChannel, liveBaseChannel, liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { LIVE_VIEWS_EVENT } from "@/lib/live/views-event";
import { expectApplied } from "@/lib/live/warm-channel";
import { viewCaptureOp } from "@/lib/viewer-views";

import { currentModelRevisions, supabaseSavedViewStore } from "./store";
import type { CaptureOutcome, SavedViewDeps } from "./tools";

/**
 * Produkčné závislosti uložených pohľadov (D-122): DB a živý viewer.
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

/** Čakanie na uloženie vo vieweri: zachytenie košíka a náhľadu trvá dlhšie než bežný príkaz. */
const CAPTURE_TIMEOUT_MS = ACK_TIMEOUT_MS * 2;

/**
 * `VIEW_CAPTURE` na živý kanál (D-161) a potvrdenie `APPLIED`: viewer uloží pohľad ako tlačidlo v paneli a
 * hostovi pošle `VIEW_SAVE` s tým istým `capture_id`; stav po príkaze nesie `view` (null = nič sa neuložilo,
 * kľúč chýba = starší viewer bez `VIEW_CAPTURE`).
 */
async function liveCapture(req: { name: string; capture_id: string }): Promise<CaptureOutcome> {
  const channel = liveChannel();
  if (!channel) return { ok: false, reason: "živý viewer nie je nastavený (LIVE_CHANNEL)" };
  const cmdId = randomUUID();
  const wait = await expectApplied(channel, cmdId).catch(() => null);
  if (!wait) return { ok: false, reason: "kanál viewera zlyhal" };
  const url = `/ifc?ops=${encodeURIComponent(viewCaptureOp(req))}&r=${Date.now().toString(36)}`;
  const sent = await broadcastLive(channel, [{ type: "navigate", url, label: `Uložiť pohľad: ${req.name}` }], fetch, cmdId).catch(() => ({ ok: false, status: 0 }));
  if (!sent.ok) return { ok: false, reason: `odoslanie do viewera zlyhalo (HTTP ${sent.status})` };
  const applied = await wait(CAPTURE_TIMEOUT_MS);
  if (!applied) {
    return {
      ok: false,
      reason: isTestChannel(channel)
        ? "pracovná session je na testovacom kanáli bez viewera (D-159), uloženie rob lokálne"
        : "viewer neodpovedal (nie je otvorený s ?live=)",
    };
  }
  if (applied.rejected === "foreign") return { ok: false, reason: FOREIGN_REJECTED_TEXT };
  const state = applied.state && typeof applied.state === "object" ? (applied.state as Record<string, unknown>) : {};
  const view = "view" in state ? (state.view as { id: string; name?: string; objects?: number } | null) : undefined;
  return { ok: true, view: view && typeof view.id === "string" ? view : view === undefined ? undefined : null, issues: applied.issues };
}

/** Zoznam pohľadov sa v DB zmenil mimo viewera: otvorené okno ho načíta znova (zmena dát patrí používateľovi, D-159). */
async function notifyViewsChanged(): Promise<void> {
  const channel = liveBaseChannel();
  if (channel) await broadcastLiveEvent(channel, LIVE_VIEWS_EVENT, { at: new Date().toISOString() });
}

export function defaultSavedViewDeps(): SavedViewDeps {
  return {
    store: supabaseSavedViewStore(),
    capture: liveCapture,
    notifyChanged: notifyViewsChanged,
    viewState: liveViewState,
    revisions: currentModelRevisions,
    storeyLabel,
    now: () => new Date(),
  };
}
