import "server-only";

import { isTestChannel, liveChannel } from "../live/broadcast";
import { queryLiveViewer } from "../live/query";
import { getSupabaseAdmin } from "../supabase/server";

import type { CalibratedDocument, ControlDeps, ResolvedFloor, ViewerSnapshot, ViewerUnderlay } from "./underlay-control";

/**
 * Produkčné závislosti ovládania podkladov (D-168): dokumenty s `_georef` a podlažia z DB, stav podkladov zo
 * živého viewera (`get_viewer_state.underlays`). Bez viewera sa `list` odpovie len z DB.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWER_TIMEOUT_MS = 2_500;

async function documents(): Promise<CalibratedDocument[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("objects")
    .select("id, object_ref, name, georef:properties->_georef")
    .eq("object_type", "document")
    .is("valid_until", null)
    .not("properties->_georef", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    object_ref: (r.object_ref as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    georef: r.georef,
  }));
}

async function floorRows() {
  const { data, error } = await getSupabaseAdmin()
    .from("objects")
    .select("id, ifc_guid, object_ref, name")
    .eq("object_type", "floor")
    .is("valid_until", null);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.ifc_guid) as { id: string; ifc_guid: string; object_ref: string | null; name: string | null }[];
}

async function floorNames(guids: string[]): Promise<Map<string, string>> {
  const wanted = new Set(guids);
  return new Map((await floorRows()).filter((f) => wanted.has(f.ifc_guid)).map((f) => [f.ifc_guid, f.object_ref ?? f.name ?? f.ifc_guid]));
}

/** Podlažie podľa kódu, mena, UUID alebo IFC GUID; zhodné štítky z viac modelov federácie dajú viac GUID. */
async function floor(ref: string): Promise<ResolvedFloor | null> {
  const key = ref.trim().toLowerCase();
  const rows = await floorRows();
  const hit = rows.filter(
    (f) => f.ifc_guid === ref.trim() || (UUID_RE.test(ref) && f.id.toLowerCase() === key) || f.object_ref?.toLowerCase() === key || f.name?.toLowerCase() === key,
  );
  if (hit.length === 0) return null;
  return { name: hit[0].object_ref ?? hit[0].name ?? ref, guids: [...new Set(hit.map((f) => f.ifc_guid))] };
}

/** Stav podkladov zo živého viewera; chýbajúce pole `underlays` = starý viewer. */
async function viewer(): Promise<ViewerSnapshot> {
  const channel = liveChannel();
  if (!channel) return { connected: false, reason: "LIVE_CHANNEL nie je nastavený", underlays: null, underlays_3d: null };
  const outcome = await queryLiveViewer(channel, "view_state", [], { timeoutMs: VIEWER_TIMEOUT_MS }).catch(() => null);
  if (!outcome || !outcome.ok) {
    return { connected: false, reason: isTestChannel(channel) ? "na testovacom kanáli nie je viewer" : "viewer neodpovedal", underlays: null, underlays_3d: null };
  }
  if (!outcome.reply.ok) return { connected: false, reason: `viewer odpovedal chybou: ${outcome.reply.error}`, underlays: null, underlays_3d: null };
  const state = (outcome.reply.result ?? {}) as { underlays?: unknown; underlays_3d?: unknown };
  return {
    connected: true,
    underlays: Array.isArray(state.underlays) ? (state.underlays as ViewerUnderlay[]) : null,
    underlays_3d: typeof state.underlays_3d === "boolean" ? state.underlays_3d : null,
  };
}

export function defaultControlDeps(): ControlDeps {
  return { documents, floorNames, floor, viewer, writeEnabled: process.env.UNDERLAY_WRITE_ENABLED === "true" };
}
