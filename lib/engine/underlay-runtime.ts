import "server-only";

import { revalidateTag } from "next/cache";

import { toGeorefV2, type MergeResult } from "../data/georef";
import { getIfcModels } from "../data/ifc-models";
import { getSupabaseAdmin } from "../supabase/server";

import { installArchiveSource } from "./archive-source";
import { meshModel } from "./measure";
import { openEngineSession } from "./session";
import { resolveTargetsToGuids } from "./aim-lookup";
import { IFC_GUID_RE, modelsFor, storeyGuid, structured, type EngineDeps } from "./tools";
import { cropToRegion, type Affine, type P2, type PageRegion } from "./underlay-calibrate";
import type { PlanSheet } from "./underlay-section-mark";
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
  const elevations = (m.store as { spatialHierarchy?: { storeyElevations?: Map<number, number> } }).spatialHierarchy?.storeyElevations;
  // Rez (D-179): výšky podlaží na spárovanie výškových kót; mená netreba, kľúč je expressId.
  if (!opts.floor) return { id: m.id, elements, storeys: [...(elevations ?? new Map<number, number>())].map(([id, z]) => ({ name: `#${id}`, z })) };
  const session = await openEngineSession([m]);
  const guid = IFC_GUID_RE.test(opts.floor) ? opts.floor : await storeyGuid(session, m.id, opts.floor);
  const tree = structured<{ tree?: TreeNode }>(await session.call("spatial_hierarchy", {})).tree;
  const node = findNode(tree, guid);
  if (!node) throw new Error(`Podlažie ${opts.floor} nie je v modeli ${m.id}.`);
  const spaceGuids = (node.children ?? []).filter((c) => c.type === "IfcSpace" && c.globalId).map((c) => c.globalId!);
  // Výška podlažia z parsera (m), rovnaký zdroj ako `storeyElevations` vo vieweri.
  const z = node.expressId !== undefined ? (elevations?.get(node.expressId) ?? null) : null;
  return { id: m.id, elements, storey: { guid, name: node.name ?? opts.floor, z, spaceGuids } };
}

/**
 * Kalibrované pôdorysy pre rovinu rezu zo značky (D-179): kalibrácie strán s `plane: null` (pôdorys) a
 * affine, k nim text a čiary strany. Len čítanie; filter na `_georef` robí DB, kalibrácie sa čítajú v2.
 */
async function planSheets(): Promise<PlanSheet[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("objects")
    .select("id, object_ref, properties")
    .eq("object_type", "document")
    .is("valid_until", null)
    .not("properties->_georef", "is", null);
  if (error) throw new Error(error.message);
  const wanted: { id: string; ref: string; page: number; affine: Affine; pageSize: P2; region: PageRegion | null }[] = [];
  for (const d of data ?? []) {
    for (const c of toGeorefV2((d.properties as Record<string, unknown> | null)?._georef).calibrations) {
      // Affine je z bodov strany v rozmere `page_size` kalibrácie (D-133), ten istý rámec ako čiary ETL.
      if (!c.plane) wanted.push({ id: d.id as string, ref: (d.object_ref as string | null) ?? (d.id as string), page: c.page, affine: c.affine, pageSize: c.page_size, region: c.region ?? null });
    }
  }
  if (wanted.length === 0) return [];
  const { data: pages, error: pErr } = await db
    .from("document_pages")
    .select("document_id, page, blocks, lines")
    .in("document_id", [...new Set(wanted.map((w) => w.id))]);
  if (pErr) throw new Error(pErr.message);
  const out: PlanSheet[] = [];
  for (const w of wanted) {
    const pg = (pages ?? []).find((x) => x.document_id === w.id && x.page === w.page);
    if (!pg) continue;
    const lines = pg.lines as UnderlayPage["lines"] | null;
    const blocks = (pg.blocks as UnderlayPage["blocks"]) ?? [];
    // Hárok s viac pôdorysmi (D-180): text a čiary len z výrezu kalibrácie, inak by osi a značky iného pôdorysu išli cez zlý affine.
    const crop = w.region ? cropToRegion(blocks, lines?.segs ?? [], w.region, w.pageSize) : null;
    out.push({ ref: w.ref, page: w.page, affine: w.affine, pageSize: w.pageSize, blocks: crop?.blocks ?? blocks, lines: crop ? crop.lines : lines?.segs, region: w.region });
  }
  return out;
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
    planSheets,
    write,
    writeEnabled: process.env.UNDERLAY_WRITE_ENABLED === "true",
    now: () => new Date(),
  };
}
