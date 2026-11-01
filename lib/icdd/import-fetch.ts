import "server-only";

import { fetchAllPages } from "@/lib/data/pagination";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { previewImport, type ImportContext, type ImportPreview, type ImportRequest } from "./import";
import { fetchIcddPlan } from "./plan-fetch";

/**
 * Stav AIM pre import ICDD (D-181 dodatok "import"): len čítanie cez service_role (D-026). Zápis robí
 * `applyIcddImport` cez RPC `icdd_apply_import` (pripravená migrácia `20261101140000_icdd_imports.sql`).
 */

const AIM_LAYER = (source: string | null) => !/^etl(:|$)/.test(source ?? ""); // = rel_is_aim_layer v DB

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data as T;
}

const chunks = <T>(xs: T[], n = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

function pageOf(identification: string | null, location: string | null): number | null {
  const m = /page=(\d+)/.exec(`${identification ?? ""} ${location ?? ""}`);
  return m ? Number(m[1]) : null;
}

export async function fetchImportContext(req: ImportRequest): Promise<ImportContext> {
  const sb = getSupabaseAdmin();
  const guids = [...new Set(req.links.flatMap((l) => [l.from.guid, l.to.guid]).filter((g): g is string => !!g))];
  const relIds = [...new Set(req.links.map((l) => l.relationshipId).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];

  const [revs, docsRaw, manifest, liveRaw, ifcPairsRaw, copies, plan] = await Promise.all([
    sb.from("model_revisions").select("model, revision, sha256, is_current").then((r) => must("model_revisions", r)),
    fetchAllPages((from, to) =>
      sb
        .from("documents")
        .select("id, identification, location, file_sha256, referenced_document_id, objects!documents_id_fkey!inner(object_type, valid_until)")
        .is("objects.valid_until", null)
        .order("id")
        .range(from, to),
    ),
    sb.from("relationship_types").select("from_object_types").eq("rel_type", "rel_associates_document").single().then((r) => must("relationship_types", r)),
    fetchAllPages((from, to) =>
      sb
        .from("relationships")
        .select("id, from_id, to_id, source, valid_until")
        .eq("rel_type", "rel_associates_document")
        .is("valid_until", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      sb.from("rel_associates_document").select("id, from_id, to_id, source").like("source", "ifc:%").order("id").range(from, to),
    ),
    sb.from("ifc_rev_current").select("model, revision").then((r) => must("ifc_rev_current", r)),
    fetchIcddPlan(),
  ]);

  const modelRevisions = revs as { model: string; revision: number; sha256: string; is_current: boolean }[];
  const current: Record<string, number> = {};
  for (const r of modelRevisions) if (r.is_current) current[r.model] = r.revision;

  const documents = (docsRaw as Record<string, unknown>[]).map((d) => {
    const o = (Array.isArray(d.objects) ? d.objects[0] : d.objects) as { object_type: string };
    return {
      id: d.id as string,
      object_type: o.object_type,
      file_sha256: (d.file_sha256 as string | null) ?? null,
      referenced_document_id: (d.referenced_document_id as string | null) ?? null,
      page: pageOf(d.identification as string | null, d.location as string | null),
    };
  });

  const aimLinks = (liveRaw as ImportContext["aimLinks"]).filter((l) => AIM_LAYER(l.source));
  const known = new Set(aimLinks.map((l) => l.id));
  for (const ids of chunks(relIds.filter((id) => !known.has(id)))) {
    const rows = must(
      "relationships",
      await sb.from("relationships").select("id, from_id, to_id, source, valid_until").eq("rel_type", "rel_associates_document").in("id", ids),
    ) as ImportContext["aimLinks"];
    aimLinks.push(...rows.filter((l) => AIM_LAYER(l.source)));
  }

  const guidNodes: ImportContext["guidNodes"] = new Map();
  for (const ids of chunks(guids)) {
    const rows = must("ifc_guid_node", await sb.from("ifc_guid_node").select("ifc_guid, object_id, object_type").in("ifc_guid", ids)) as {
      ifc_guid: string;
      object_id: string;
      object_type: string;
    }[];
    for (const r of rows) guidNodes.set(r.ifc_guid, { object_id: r.object_id, object_type: r.object_type });
  }
  const copyGuids: ImportContext["copyGuids"] = new Map();
  for (const c of copies as { model: string; revision: number }[]) {
    for (const ids of chunks(guids)) {
      const rows = must(
        "ifc_rev_objects",
        await sb.from("ifc_rev_objects").select("global_id").eq("model", c.model).eq("revision", c.revision).in("global_id", ids),
      ) as { global_id: string }[];
      for (const r of rows) if (!copyGuids.has(r.global_id)) copyGuids.set(r.global_id, c.model);
    }
  }

  return {
    current,
    modelRevisions: modelRevisions.map(({ model, revision, sha256 }) => ({ model, revision, sha256 })),
    documents,
    guidNodes,
    copyGuids,
    aimLinks,
    ifcDocPairs: new Set(
      (ifcPairsRaw as { from_id: string | null; to_id: string | null }[]).filter((r) => r.from_id && r.to_id).map((r) => `${r.from_id}|${r.to_id}`),
    ),
    fromObjectTypes: ((manifest as { from_object_types: string[] | null }).from_object_types ?? []) as string[],
    plan,
  };
}

export async function computeImportPreview(req: ImportRequest): Promise<ImportPreview> {
  return previewImport(req, await fetchImportContext(req));
}

const row = (req: ImportRequest, p: ImportPreview) => ({
  version_id: req.versionID ?? "?",
  container_sha256: req.containerSha256,
  file_name: req.fileName,
  same_as_aim: p.diff ? p.diff.same : null,
  payloads: p.payloads,
  counts: p.counts,
  diff: p.diff,
  issues: req.validation.issues,
  findings: p.findings,
  changes: p.changes,
  model_revisions: p.modelRevisions,
  aim_state_sha256: p.aimStateSha256,
  imported_by: process.env.ICDD_IMPORT_USER?.trim() || "aim",
});

/** Uloží náhľad (`checked`) do `icdd_imports`; vráti id záznamu. */
export async function saveImportPreview(req: ImportRequest, p: ImportPreview): Promise<string> {
  const sb = getSupabaseAdmin();
  const r = must("icdd_imports", await sb.from("icdd_imports").insert(row(req, p)).select("id").single()) as { id: string };
  return r.id;
}

export class ImportConflictError extends Error {}

/**
 * Zápis importu za bránou (volá route len pri `ICDD_IMPORT_ENABLED=true`): prepočíta náhľad z tej istej požiadavky,
 * overí, že kontajner a stav AIM sú tie isté ako pri uloženom náhľade, a zapíše zmeny cez RPC v jednej transakcii.
 */
export async function applyIcddImport(importId: string, aimState: string, req: ImportRequest) {
  const sb = getSupabaseAdmin();
  const saved = must(
    "icdd_imports",
    await sb.from("icdd_imports").select("id, status, container_sha256, aim_state_sha256").eq("id", importId).maybeSingle(),
  ) as { id: string; status: string; container_sha256: string; aim_state_sha256: string } | null;
  if (!saved) throw new ImportConflictError("náhľad importu neexistuje");
  if (saved.status !== "checked") throw new ImportConflictError(`import má stav ${saved.status}`);
  if (saved.container_sha256 !== req.containerSha256) throw new ImportConflictError("kontajner sa líši od náhľadu");
  const preview = await computeImportPreview(req);
  const reject = async (message: string) => {
    await sb.from("icdd_imports").update({ status: "rejected", message }).eq("id", importId);
    throw new ImportConflictError(message);
  };
  if (preview.aimStateSha256 !== saved.aim_state_sha256 || aimState !== saved.aim_state_sha256)
    await reject("stav AIM sa od náhľadu zmenil, sprav nový náhľad");
  if (!preview.applicable) await reject(req.validation.ok ? "nie je čo zapísať" : "kontrola ISO 21597 kontajnera neprešla");
  const { data, error } = await sb.rpc("icdd_apply_import", { p_import: importId, p_aim_state: saved.aim_state_sha256, p_changes: preview.changes });
  if (error) {
    await sb.from("icdd_imports").update({ status: "failed", message: error.message }).eq("id", importId);
    throw new Error(`zápis importu zlyhal: ${error.message}`);
  }
  return { preview, record: data as { id: string; written_ids: string[]; closed_ids: string[]; applied_at: string } };
}
