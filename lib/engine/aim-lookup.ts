import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { AimRef } from "./join";
import { currentProjectId } from "../project/context";

/** Batch for `.in()` filters (URL length limit in PostgREST), as in lib/llm/tools.ts. */
const IN_CHUNK = 100;

/**
 * IFC GlobalId -> AIM node (active GUID in `ifc_guid_history`, D-010).
 * Read-only via `service_role` (D-026).
 */
export async function lookupGuids(guids: string[]): Promise<Map<string, AimRef>> {
  const projectId = currentProjectId();
  const supabase = getSupabaseAdmin();
  const objectByGuid = new Map<string, string>();
  for (let i = 0; i < guids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("ifc_guid_history")
      .select("ifc_guid, object_id")
      .in("ifc_guid", guids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { ifc_guid: string; object_id: string }[]) {
      if (row.ifc_guid && row.object_id) objectByGuid.set(row.ifc_guid, row.object_id);
    }
  }

  const ids = [...new Set(objectByGuid.values())];
  const objects = new Map<string, AimRef>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, object_ref, name, object_type")
      .eq("project_id", projectId)
      .in("id", ids.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { id: string; object_ref: string | null; name: string | null; object_type: string }[]) {
      objects.set(o.id, { object_id: o.id, object_ref: o.object_ref, name: o.name, object_type: o.object_type });
    }
  }

  const out = new Map<string, AimRef>();
  for (const [guid, oid] of objectByGuid) {
    const o = objects.get(oid);
    if (o) out.set(guid, o);
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Candidate for an element code: the GUID and what it is (for the ambiguity report). */
export interface NameCandidate {
  guid: string;
  label: string;
}

/** Codes with several matches - not chosen silently, the tool returns the candidates (D-102). */
export class AmbiguousTargetError extends Error {}

/** Unambiguous codes -> GUID; ambiguous ones into an error with a list of candidates. */
export function pickUnique(matches: Map<string, NameCandidate[]>): Map<string, string> {
  const out = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [target, list] of matches) {
    const guids = [...new Set(list.map((c) => c.guid))];
    if (guids.length === 1) out.set(target, guids[0]);
    else if (guids.length > 1) {
      const shown = list.slice(0, 5).map((c) => `${c.label} ${c.guid}`).join("; ");
      ambiguous.push(`${target}: ${guids.length} prvkov (${shown}${list.length > 5 ? "; ..." : ""})`);
    }
  }
  if (ambiguous.length > 0) {
    throw new AmbiguousTargetError(`Kód nie je jednoznačný - zadaj global_ids: ${ambiguous.join(" | ")}`);
  }
  return out;
}

type FindNames = (names: string[]) => Promise<Map<string, { global_id: string; ifc_type: string; model: string }[]>>;
/** The engine is enabled (like `ENGINE_ENABLED` in the MCP route); without it a code is searched only in AIM. */
export const engineEnabled = () => process.env.ENGINE_ENABLED === "1" || process.env.ENGINE_SPIKE === "1";
const findNamesInIfc: FindNames = async (names) => (engineEnabled() ? (await import("./names")).findByNames(names) : new Map());

/**
 * objects.id, object_ref or element code -> active IFC GUID (elements without a GUID are skipped).
 * A code that is not an object_ref (VV.03.01.040 is a name, SD04.0001 is not in AIM at all)
 * is looked up by the exact `objects.name` and then by IFC Name/Tag in the engine (D-102).
 */
export async function resolveTargetsToGuids(targets: string[], findNames: FindNames = findNamesInIfc): Promise<Map<string, string>> {
  const projectId = currentProjectId();
  const supabase = getSupabaseAdmin();
  const idByTarget = new Map<string, string>();
  const uuids = targets.filter((t) => UUID_RE.test(t));
  const refs = targets.filter((t) => !UUID_RE.test(t));
  for (const [col, vals] of [["id", uuids], ["object_ref", refs]] as const) {
    for (let i = 0; i < vals.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, object_ref")
        .eq("project_id", projectId)
        .in(col, vals.slice(i, i + IN_CHUNK))
        .is("valid_until", null); // expired objects (D-088)
      if (error) throw new Error(error.message);
      for (const o of (data ?? []) as { id: string; object_ref: string | null }[]) {
        idByTarget.set(col === "id" ? o.id : (o.object_ref as string), o.id);
      }
    }
  }
  const out = new Map<string, string>();
  for (const [target, g] of await guidsOfObjects(idByTarget)) out.set(target, g);

  // Element code: exact name in AIM, then IFC Name/Tag.
  const byName = refs.filter((t) => !idByTarget.has(t));
  for (const [target, g] of await resolveNamesToGuids(byName, findNames)) out.set(target, g);
  return out;
}

/** Element codes (not object_ref) -> GUID: exact `objects.name`, then IFC Name/Tag; ambiguous = error. */
export async function resolveNamesToGuids(byName: string[], findNames: FindNames = findNamesInIfc): Promise<Map<string, string>> {
  const projectId = currentProjectId();
  if (byName.length === 0) return new Map();
  const supabase = getSupabaseAdmin();
  const named = new Map<string, NameCandidate[]>();
  for (let i = 0; i < byName.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("objects")
      .select("id, name, object_ref, ifc_type")
      .eq("project_id", projectId)
      .in("name", byName.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; name: string; object_ref: string | null; ifc_type: string | null }[];
    const guids = await guidsOfObjects(new Map(rows.map((r) => [r.id, r.id])));
    for (const r of rows) {
      const g = guids.get(r.id);
      if (!g) continue;
      named.set(r.name, [...(named.get(r.name) ?? []), { guid: g, label: `${r.object_ref ?? r.name} ${r.ifc_type ?? ""}`.trim() }]);
    }
  }
  const rest = byName.filter((t) => !named.has(t));
  if (rest.length > 0) {
    for (const [name, hits] of await findNames(rest)) {
      named.set(name, hits.map((h) => ({ guid: h.global_id, label: `${h.ifc_type} ${h.model}` })));
    }
  }
  return pickUnique(named);
}

/** objects.id -> active IFC GUID for the map goal -> objects.id. */
async function guidsOfObjects(idByTarget: Map<string, string>): Promise<Map<string, string>> {
  const supabase = getSupabaseAdmin();
  const ids = [...new Set(idByTarget.values())];
  const guidById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("ifc_guid_history")
      .select("object_id, ifc_guid")
      .in("object_id", ids.slice(i, i + IN_CHUNK))
      .is("valid_until", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { object_id: string; ifc_guid: string }[]) {
      if (row.object_id && row.ifc_guid) guidById.set(row.object_id, row.ifc_guid);
    }
  }
  const out = new Map<string, string>();
  for (const [target, id] of idByTarget) {
    const g = guidById.get(id);
    if (g) out.set(target, g);
  }
  return out;
}
