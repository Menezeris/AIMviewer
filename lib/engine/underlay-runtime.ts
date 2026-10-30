import "server-only";

import { revalidateTag } from "next/cache";

import type { MergeResult } from "../data/georef";
import { getIfcModels } from "../data/ifc-models";
import { getSupabaseAdmin } from "../supabase/server";

import { installArchiveSource } from "./archive-source";
import { meshModel } from "./measure";
import { openEngineSession } from "./session";
import { resolveTargetsToGuids } from "./aim-lookup";
import { IFC_GUID_RE, modelsFor, storeyGuid, structured, type EngineDeps } from "./tools";
import type { UnderlayDeps, UnderlayDocument, UnderlayModel, UnderlayPage } from "./underlay-tool";

// D-135: modely motora z nemenného archívu revízie (cca 5-krát menej egressu).
installArchiveSource();

/**
 * Produkčné závislosti `calibrate_underlay` (D-133): dokument a strany z DB, model z IFC
 * motora, zápis `_georef` do `objects.properties` (rovnako ako `PATCH /api/underlay`).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function document(ref: string): Promise<UnderlayDocument | null> {
  const db = getSupabaseAdmin();
  const q = db.from("objects").select("id, object_ref, name, properties").eq("object_type", "document").is("valid_until", null);
  const { data, error } = await (UUID_RE.test(ref) ? q.eq("id", ref) : q.eq("object_ref", ref)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: rels, error: rErr } = await db.from("rel_associates_document").select("from_id").eq("to_id", data.id).is("valid_until", null);
  if (rErr) throw new Error(rErr.message);
  const fromIds = (rels ?? []).map((r) => r.from_id as string);
  let floors: UnderlayDocument["floors"] = [];
  if (fromIds.length > 0) {
    const { data: fl, error: fErr } = await db.from("objects").select("ifc_guid, object_ref, name").in("id", fromIds).eq("object_type", "floor");
    if (fErr) throw new Error(fErr.message);
    floors = (fl ?? []).filter((f) => f.ifc_guid).map((f) => ({ guid: f.ifc_guid as string, name: (f.object_ref ?? f.name ?? f.ifc_guid) as string }));
  }
  return {
    id: data.id as string,
    object_ref: (data.object_ref as string | null) ?? null,
    name: (data.name as string | null) ?? null,
    georef: (data.properties as Record<string, unknown> | null)?._georef,
    floors,
  };
}

async function page(documentId: string, pageNo: number): Promise<UnderlayPage | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("document_pages")
    .select("blocks, lines, page_size")
    .eq("document_id", documentId)
    .eq("page", pageNo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    blocks: (data.blocks as UnderlayPage["blocks"]) ?? [],
    lines: (data.lines as UnderlayPage["lines"]) ?? null,
    pageSize: (data.page_size as UnderlayPage["pageSize"]) ?? null,
  };
}

interface TreeNode {
  expressId?: number;
  globalId?: string;
  type?: string;
  name?: string;
  children?: TreeNode[];
}

function findNode(n: TreeNode | undefined, guid: string): TreeNode | null {
  if (!n) return null;
  if (n.globalId === guid) return n;
  for (const c of n.children ?? []) {
    const hit = findNode(c, guid);
    if (hit) return hit;
  }
  return null;
}

async function model(opts: { model?: string; floor?: string }): Promise<UnderlayModel> {
  const ids = getIfcModels().map((m) => m.id);
  const id = opts.model ?? ids[0];
  // modelsFor potrebuje len zdroje modelov; prepojenie na AIM tu netreba.
  const { models } = await modelsFor([id], {} as EngineDeps);
  const m = models[0];
  const elements = [...(await meshModel(m)).values()];
  if (!opts.floor) return { id: m.id, elements };
  const session = await openEngineSession([m]);
  const guid = IFC_GUID_RE.test(opts.floor) ? opts.floor : await storeyGuid(session, m.id, opts.floor);
  const tree = structured<{ tree?: TreeNode }>(await session.call("spatial_hierarchy", {})).tree;
  const node = findNode(tree, guid);
  if (!node) throw new Error(`Podlažie ${opts.floor} nie je v modeli ${m.id}.`);
  const spaceGuids = (node.children ?? []).filter((c) => c.type === "IfcSpace" && c.globalId).map((c) => c.globalId!);
  // Výška podlažia z parsera (m), rovnaký zdroj ako `storeyElevations` vo vieweri.
  const elevations = (m.store as { spatialHierarchy?: { storeyElevations?: Map<number, number> } }).spatialHierarchy?.storeyElevations;
  const z = node.expressId !== undefined ? (elevations?.get(node.expressId) ?? null) : null;
  return { id: m.id, elements, storey: { guid, name: node.name ?? opts.floor, z, spaceGuids } };
}

async function write(documentId: string, apply: (stored: unknown) => MergeResult): Promise<MergeResult> {
  const db = getSupabaseAdmin();
  // Zlúčenie nad najnovšími properties, nie nad tými z čítania pred výpočtom.
  const { data, error } = await db.from("objects").select("properties").eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  const current = (data?.properties as Record<string, unknown> | null) ?? {};
  const merged = apply(current._georef);
  if (!merged.ok) return merged;
  const { error: uErr } = await db.from("objects").update({ properties: { ...current, _georef: merged.georef } }).eq("id", documentId);
  if (uErr) throw new Error(uErr.message);
  revalidateTag("aim", { expire: 0 });
  return merged;
}

export function defaultUnderlayDeps(): UnderlayDeps {
  return {
    document,
    page,
    model,
    refGuids: (refs) => resolveTargetsToGuids(refs),
    write,
    writeEnabled: process.env.UNDERLAY_WRITE_ENABLED === "true",
    now: () => new Date(),
  };
}
