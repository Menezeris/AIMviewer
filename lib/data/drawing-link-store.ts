import "server-only";

import { revalidateProject } from "@/lib/data/revalidate";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/data/pagination";
import { MAX_ZONE_MEMBERS, normLabel, type ZoneObject } from "@/lib/data/drawing-labels";
import type { LinkOverride, OverrideAction, OverrideTarget } from "@/lib/data/drawing-link-overrides";
import type { PageRegion } from "@/lib/llm/document-text";

/**
 * Store of manual label and zone links for pairing (D-160). Reads go through
 * the caller's `unstable_cache` (`drawing-links.ts`), a write invalidates the tag `aim`.
 */

type ObjRow = {
  id: string;
  object_ref: string;
  name: string | null;
  ifc_type: string | null;
  object_type: string;
  ifc_guid: string | null;
};

const OBJ_COLS = "id, object_ref, name, ifc_type, object_type, ifc_guid";

/** Building zones (IfcZone and IfcSpatialZone) with the GUIDs of member spaces. */
export async function fetchZones(projectId: string): Promise<ZoneObject[]> {
  const supabase = getSupabaseAdmin();
  const rows = await fetchAllPages<ObjRow>((from, to) =>
    supabase
      .from("objects")
      .select(OBJ_COLS)
      .eq("project_id", projectId)
      .in("object_type", ["zone", "spatial_zone"])
      .is("valid_until", null)
      .order("id")
      .range(from, to)
  );
  const zoneIds = rows.filter((r) => r.object_type === "zone").map((r) => r.id);
  const members = new Map<string, string[]>();
  if (zoneIds.length > 0) {
    const edges = await fetchAllPages<{ from_id: string; to_id: string }>((from, to) =>
      supabase
        .from("rel_assigns_to_group")
        .select("from_id, to_id")
        .eq("project_id", projectId)
        .in("to_id", zoneIds)
        .is("valid_until", null)
        .not("from_id", "is", null)
        .order("from_id")
        .range(from, to)
    );
    const memberIds = [...new Set(edges.map((e) => e.from_id))];
    const guid = new Map<string, string>();
    for (let i = 0; i < memberIds.length; i += 200) {
      const { data, error } = await supabase
        .from("objects")
        .select("id, ifc_guid")
        .eq("project_id", projectId)
        .in("id", memberIds.slice(i, i + 200))
        .eq("object_type", "space")
        .is("valid_until", null);
      if (error) throw new Error(error.message);
      for (const m of (data ?? []) as { id: string; ifc_guid: string | null }[]) {
        if (m.ifc_guid) guid.set(m.id, m.ifc_guid);
      }
    }
    for (const e of edges) {
      const g = guid.get(e.from_id);
      if (!g) continue;
      const list = members.get(e.to_id) ?? [];
      if (list.length < MAX_ZONE_MEMBERS) list.push(g);
      members.set(e.to_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    ref: r.object_ref,
    guid: r.ifc_guid,
    name: r.name,
    ifcType: r.ifc_type,
    members: members.get(r.id) ?? [],
  }));
}

type OverrideRow = {
  page: number;
  text: string;
  bbox: PageRegion | null;
  action: OverrideAction;
  target_id: string | null;
  target_ref: string | null;
  target_guid: string | null;
};

/** Live manual rows of a document (a single page or all), from the oldest; target with current data. */
export async function fetchOverrides(projectId: string, documentId: string, page: number | null, zones: readonly ZoneObject[]): Promise<LinkOverride[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("drawing_link_overrides")
    .select("page, text, bbox, action, target_id, target_ref, target_guid")
    .eq("project_id", projectId)
    .eq("document_id", documentId)
    .is("valid_until", null)
    .order("created_at");
  if (page !== null) q = q.eq("page", page);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OverrideRow[];
  const ids = [...new Set(rows.map((r) => r.target_id).filter(Boolean) as string[])];
  const live = new Map<string, ObjRow>();
  if (ids.length > 0) {
    const { data: objs, error: oErr } = await supabase
      .from("objects")
      .select(OBJ_COLS)
      .eq("project_id", projectId)
      .in("id", ids)
      .is("valid_until", null);
    if (oErr) throw new Error(oErr.message);
    for (const o of (objs ?? []) as ObjRow[]) live.set(o.id, o);
  }
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const out: LinkOverride[] = [];
  for (const r of rows) {
    if (r.action === "suppress") {
      out.push({ page: r.page, text: r.text, bbox: r.bbox, action: "suppress", target: null });
      continue;
    }
    const o = r.target_id ? live.get(r.target_id) : undefined;
    if (!o) continue; // the target is gone (re-ETL): the manual assignment has nowhere to point, the automation applies
    const members = zoneById.get(o.id)?.members;
    const target: OverrideTarget = {
      ref: o.object_ref,
      guid: o.ifc_guid ?? r.target_guid,
      name: o.name,
      ifc_type: o.ifc_type,
      objectType: o.object_type,
      ...(members && members.length > 0 ? { members } : {}),
    };
    out.push({ page: r.page, text: r.text, bbox: r.bbox, action: "assign", target });
  }
  return out;
}

export type ResolvedTarget = { ok: true; row: ObjRow } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assignment target: objects.id, object_ref, IFC GUID, or the name of a zone/space (must be unambiguous). */
export async function resolveLinkTarget(projectId: string, input: string): Promise<ResolvedTarget> {
  const supabase = getSupabaseAdmin();
  const t = input.trim();
  const base = () => supabase.from("objects").select(OBJ_COLS).eq("project_id", projectId).is("valid_until", null);
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as ObjRow[];
  };
  const exact = [
    ...(UUID_RE.test(t) ? await one(base().eq("id", t)) : []),
    ...(await one(base().eq("object_ref", t))),
    ...(await one(base().eq("ifc_guid", t))),
  ];
  const direct = [...new Map(exact.map((o) => [o.id, o])).values()];
  if (direct.length === 1) return { ok: true, row: direct[0] };
  const named = (
    await one(base().in("object_type", ["zone", "spatial_zone", "space"]).ilike("name", t.replace(/[%_]/g, "\\$&")).limit(20))
  ).filter((o) => o.name && normLabel(o.name) === normLabel(t));
  if (named.length === 1) return { ok: true, row: named[0] };
  const found = direct.length > 1 ? direct : named;
  if (found.length > 1) {
    return {
      ok: false,
      error: `Cieľ '${t}' nie je jednoznačný (${found.map((o) => o.object_ref).join(", ")}); zadaj object_ref.`,
    };
  }
  return { ok: false, error: `Cieľ '${t}' som nenašiel (object_ref, IFC GUID alebo meno zóny či miestnosti).` };
}

export interface OverrideWrite {
  documentId: string;
  documentRef: string | null;
  page: number;
  text: string;
  bbox: PageRegion | null;
  action: OverrideAction | "reset";
  target: ObjRow | null;
  author: string | null;
}

/** Ends the live row with the same key (document, page, text, bbox). */
async function endLive(projectId: string, w: Pick<OverrideWrite, "documentId" | "page" | "text" | "bbox">): Promise<number> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("drawing_link_overrides")
    .update({ valid_until: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("document_id", w.documentId)
    .eq("page", w.page)
    .eq("text", w.text)
    .is("valid_until", null);
  q = w.bbox ? q.eq("bbox", w.bbox) : q.is("bbox", null);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** assign / clear (suppress) / reset (back to the automation); the previous row with the same key is ended. */
export async function writeOverride(projectId: string, w: OverrideWrite): Promise<{ replaced: number }> {
  const replaced = await endLive(projectId, w);
  if (w.action !== "reset") {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("drawing_link_overrides").insert({
      project_id: projectId,
      document_id: w.documentId,
      document_ref: w.documentRef,
      page: w.page,
      text: w.text,
      bbox: w.bbox,
      action: w.action,
      target_id: w.target?.id ?? null,
      target_ref: w.target?.object_ref ?? null,
      target_guid: w.target?.ifc_guid ?? null,
      author: w.author,
    });
    if (error) throw new Error(error.message);
  }
  revalidateProject(projectId);
  return { replaced };
}
