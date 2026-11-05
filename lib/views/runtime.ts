import "server-only";

import { randomUUID } from "node:crypto";

import { lookupGuids } from "@/lib/engine/aim-lookup";
import { ACK_TIMEOUT_MS, FOREIGN_REJECTED_TEXT } from "@/lib/live/applied-text";
import { broadcastLive, broadcastLiveEvent, isTestChannel, liveBaseChannel, liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { LIVE_VIEWS_EVENT } from "@/lib/live/views-event";
import { expectApplied } from "@/lib/live/warm-channel";
import { viewCaptureOp } from "@/lib/viewer-views";

import { currentProjectId } from "../project/context";

import { currentModelRevisions, supabaseSavedViewStore } from "./store";
import type { CaptureOutcome, SavedViewDeps } from "./tools";

/**
  * Production dependencies of saved views (D-122): the DB and the live viewer.
  * The logic is in `tools.ts` and `plan.ts` and is tested without them.
 */

/** Raw `view_state` response (D-085); string = why it could not be read (pattern `captureLiveView`, D-099). */
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

/** Waiting for a save in the viewer: capturing the basket and the preview takes longer than an ordinary command. */
const CAPTURE_TIMEOUT_MS = ACK_TIMEOUT_MS * 2;

/**
  * `VIEW_CAPTURE` to the live channel (D-161) and the `APPLIED` confirmation: the viewer saves the view as a button in the panel and
  * sends the host `VIEW_SAVE` with the same `capture_id`; the state after the command carries `view` (null = nothing was saved,
  * the key missing = an older viewer without `VIEW_CAPTURE`).
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

/** The list of views in the DB changed outside the viewer: the open window loads it again (a data change belongs to the user, D-159). */
async function notifyViewsChanged(): Promise<void> {
  const channel = liveBaseChannel();
  if (channel) await broadcastLiveEvent(channel, LIVE_VIEWS_EVENT, { at: new Date().toISOString() });
}

export function defaultSavedViewDeps(): SavedViewDeps {
  const projectId = currentProjectId();
  return {
    store: supabaseSavedViewStore(projectId),
    capture: liveCapture,
    notifyChanged: notifyViewsChanged,
    viewState: liveViewState,
    revisions: () => currentModelRevisions(projectId),
    storeyLabel,
    now: () => new Date(),
  };
}
