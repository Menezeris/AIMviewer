import "server-only";

import { randomUUID } from "node:crypto";

import { ACK_TIMEOUT_MS, FOREIGN_REJECTED_TEXT } from "@/lib/live/applied-text";
import { broadcastLive, isTestChannel, liveChannel } from "@/lib/live/broadcast";
import { queryLiveViewer } from "@/lib/live/query";
import { expectApplied } from "@/lib/live/warm-channel";
import { idsOpenOp, type IdsOpenReq } from "@/lib/viewer-ids";

import { supabaseIdsLibraryStore } from "./library-store";
import { supabaseIdsStore } from "./store";
import { execIdsTool, type IdsOpenOutcome, type IdsToolResult, type IdsViewerDeps } from "./tools";
import { currentProjectId } from "../project/context";

/** Waiting for IDS to open in the viewer: the host client first downloads the XML from the route, then sends it to the fork. */
const OPEN_TIMEOUT_MS = ACK_TIMEOUT_MS * 2;

/** `ids_open` to the live channel (D-162) and confirmation `APPLIED`; pattern `liveCapture` from views (D-161). */
async function liveOpen(req: IdsOpenReq): Promise<IdsOpenOutcome> {
  const channel = liveChannel();
  if (!channel) return { ok: false, reason: "živý viewer nie je nastavený (LIVE_CHANNEL)" };
  const cmdId = randomUUID();
  const wait = await expectApplied(channel, cmdId).catch(() => null);
  if (!wait) return { ok: false, reason: "kanál viewera zlyhal" };
  const url = `/ifc?ops=${encodeURIComponent(idsOpenOp(req))}&r=${Date.now().toString(36)}`;
  const sent = await broadcastLive(channel, [{ type: "navigate", url, label: `Otvoriť IDS ${req.code}` }], fetch, cmdId).catch(() => ({ ok: false, status: 0 }));
  if (!sent.ok) return { ok: false, reason: `odoslanie do viewera zlyhalo (HTTP ${sent.status})` };
  const applied = await wait(OPEN_TIMEOUT_MS);
  if (!applied) {
    return {
      ok: false,
      reason: isTestChannel(channel)
        ? "pracovná session je na testovacom kanáli bez viewera (D-159), otvorenie rob lokálne"
        : "viewer neodpovedal (nie je otvorený s ?live=)",
    };
  }
  if (applied.rejected === "foreign") return { ok: false, reason: FOREIGN_REJECTED_TEXT };
  return { ok: true, issues: applied.issues };
}

/** Raw `view_state` response (D-085); string = why it could not be read. */
async function liveViewState(): Promise<unknown> {
  const channel = liveChannel();
  if (!channel) return "živý viewer nie je nastavený (LIVE_CHANNEL)";
  const outcome = await queryLiveViewer(channel, "view_state");
  if (!outcome.ok) return outcome.reason === "timeout" ? "viewer neodpovedal (nie je otvorený s ?live=)" : "kanál viewera zlyhal";
  if (!outcome.reply.ok) return `viewer odpovedal chybou: ${outcome.reply.error}`;
  return outcome.reply.result;
}

const viewer: IdsViewerDeps = { open: liveOpen, viewState: liveViewState };

/** Production dependencies of the `ids_document` tool (D-162): DB and live viewer; the import is lazy from the MCP route. */
export function runIdsTool(name: string, args: Record<string, unknown>): Promise<IdsToolResult> {
  return execIdsTool(name, args, { store: supabaseIdsStore(currentProjectId()), viewer, lib: supabaseIdsLibraryStore(currentProjectId()) });
}
