import "server-only";

import { fetchAllPages } from "@/lib/data/pagination";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { LAYERS, type IcddPlan, type Layer } from "./model";
import { buildPlan, type DerivationRuleRow, type DocLinkRow, type PlanRows, type SpatialLinkRow } from "./plan";

/**
 * Načíta stav AIM pre export ICDD (D-181): len čítanie cez service_role (D-026). Payloady sa tu nesťahujú;
 * plán nesie ich verejné URL a sha256, kontajner skladá prehliadač (Vercel nevráti ~85 MB odpoveď).
 */
export async function fetchIcddPlan(opts: { layers?: Layer[]; createdAt?: string } = {}): Promise<IcddPlan> {
  const sb = getSupabaseAdmin();
  const must = <T>(label: string, r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(`${label}: ${r.error.message}`);
    return r.data as T;
  };
  const layers = opts.layers ?? [...LAYERS];

  const [modelRevisions, copyRevisions, containerRevisions, documentsRaw, storeyMap, rulesRaw, runsRaw] = await Promise.all([
    sb.from("model_revisions").select("model, revision, sha256, size_bytes, archive_path").eq("is_current", true).then((r) => must("model_revisions", r)),
    sb.from("ifc_rev_current").select("model, revision").then((r) => must("ifc_rev_current", r)),
    sb
      .from("v_container_revisions")
      .select("model, document_id, name, revision, revision_no, status, approval")
      .eq("is_latest", true)
      .then((r) => must("v_container_revisions", r)),
    fetchAllPages((from, to) =>
      sb
        .from("documents")
        .select("id, identification, description, location, revision, electronic_format, file_sha256, referenced_document_id, objects!inner(object_type, object_ref, name, valid_until)")
        .is("objects.valid_until", null)
        .order("id")
        .range(from, to),
    ),
    sb.from("ifc_storey_map").select("model, global_id, name, to_id, match_rule").then((r) => must("ifc_storey_map", r)),
    sb.from("derivation_rules").select("id, source").then((r) => must("derivation_rules", r)),
    sb
      .from("derivation_runs")
      .select("rule_id, models, finished_at")
      .eq("status", "ok")
      .order("finished_at", { ascending: false })
      .limit(200)
      .then((r) => must("derivation_runs", r)),
  ]);

  const documents = (documentsRaw as Record<string, unknown>[]).map((d) => {
    const o = (Array.isArray(d.objects) ? d.objects[0] : d.objects) as { object_type: string; object_ref: string | null; name: string | null };
    return {
      id: d.id as string,
      object_type: o.object_type as "document" | "document_reference",
      object_ref: o.object_ref,
      name: o.name,
      identification: d.identification as string | null,
      description: d.description as string | null,
      location: d.location as string | null,
      revision: d.revision as string | null,
      electronic_format: d.electronic_format as string | null,
      file_sha256: d.file_sha256 as string | null,
      referenced_document_id: d.referenced_document_id as string | null,
    };
  });

  const docLinks: DocLinkRow[] = layers.includes("documents-elements")
    ? await fetchAllPages((from, to) =>
        sb.from("rel_associates_document").select("id, from_id, to_id, source, global_id").order("id").range(from, to),
      )
    : [];
  const spatialLinks: SpatialLinkRow[] = layers.includes("derived-spatial")
    ? await fetchAllPages((from, to) =>
        sb
          .from("rel_referenced_in_spatial_structure")
          .select("id, from_id, to_id, role, source")
          .like("source", "derive:%")
          .is("valid_until", null)
          .order("id")
          .range(from, to),
      )
    : [];

  const ids = [...new Set([...docLinks.flatMap((l) => [l.from_id]), ...spatialLinks.flatMap((l) => [l.from_id, l.to_id])])].filter(
    (x): x is string => !!x,
  );
  const objects: PlanRows["objects"] = [];
  for (let i = 0; i < ids.length; i += 200) {
    objects.push(...must("objects", await sb.from("objects").select("id, ifc_guid, object_ref").in("id", ids.slice(i, i + 200))));
  }

  const guids = [...new Set([...objects.map((o) => o.ifc_guid), ...docLinks.map((l) => l.global_id)].filter((g): g is string => !!g))];
  const guidModel = new Map<string, string>();
  const copies = copyRevisions as { model: string; revision: number }[];
  for (const c of copies) {
    for (let i = 0; i < guids.length; i += 200) {
      const rows = must(
        "ifc_rev_objects",
        await sb.from("ifc_rev_objects").select("global_id").eq("model", c.model).eq("revision", c.revision).in("global_id", guids.slice(i, i + 200)),
      ) as { global_id: string }[];
      for (const r of rows) if (!guidModel.has(r.global_id)) guidModel.set(r.global_id, c.model);
    }
  }

  const latestRun = new Map<string, Record<string, number>>();
  for (const r of runsRaw as { rule_id: string; models: Record<string, number> | null }[]) {
    if (!latestRun.has(r.rule_id) && r.models) latestRun.set(r.rule_id, r.models);
  }
  const rules: DerivationRuleRow[] = (rulesRaw as { id: string; source: string | null }[]).map((r) => ({
    ...r,
    models: latestRun.get(r.id) ?? null,
  }));

  return buildPlan(
    {
      storageBase: process.env.SUPABASE_URL ?? "",
      modelRevisions: modelRevisions as PlanRows["modelRevisions"],
      copyRevisions: copies,
      containerRevisions: containerRevisions as PlanRows["containerRevisions"],
      documents,
      objects,
      guidModel,
      docLinks,
      spatialLinks,
      storeyMap: storeyMap as PlanRows["storeyMap"],
      rules,
    },
    {
      createdAt: opts.createdAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      publisher: process.env.ICDD_PUBLISHER || undefined,
      aimNamespace: process.env.ICDD_AIM_NAMESPACE || undefined,
      layers,
    },
  );
}
