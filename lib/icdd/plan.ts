/**
 * Plán kontajnera ICDD zo stavu AIM (D-181, #350). Čistá funkcia nad riadkami DB, aby sa dala testovať;
 * načítanie robí `plan-fetch.ts` (server). Pravidlo D-129 a D-183: payload = kontajnery revízií (IFC z archívu,
 * PDF z bucketu, sha256), linkset = AIM vrstva (odvodené väzby, väzby dokument-prvok z AIM, párovanie podlaží)
 * a kvôli čitateľnosti bez parsovania IFC aj väzba dokument-prvok zo súboru (s pôvodom `ifc:ASR v79`).
 */

import { DEFAULT_AIM_NAMESPACE, LAYERS, type IcddLink, type IcddPayload, type IcddPlan, type Layer } from "./model";

export interface ModelRevisionRow {
  model: string;
  revision: number;
  sha256: string;
  size_bytes: number | null;
  archive_path: string | null;
}
export interface ContainerRevisionRow {
  model: string | null;
  document_id: string | null;
  name: string | null;
  revision: string | null;
  revision_no: number | null;
  status: string | null;
  approval: unknown;
}
export interface DocumentRow {
  id: string;
  object_type: "document" | "document_reference";
  object_ref: string | null;
  name: string | null;
  identification: string | null;
  description: string | null;
  location: string | null;
  revision: string | null;
  electronic_format: string | null;
  file_sha256: string | null;
  referenced_document_id: string | null;
}
export interface ObjectRow {
  id: string;
  ifc_guid: string | null;
  object_ref: string | null;
}
export interface DocLinkRow {
  from_id: string | null;
  to_id: string | null;
  source: string | null;
  global_id: string | null;
}
export interface SpatialLinkRow {
  from_id: string;
  to_id: string;
  role: string | null;
  source: string | null;
}
export interface StoreyMapRow {
  model: string;
  global_id: string;
  name: string | null;
  to_id: string | null;
  match_rule: string | null;
}
export interface DerivationRuleRow {
  id: string;
  source: string | null;
  /** `models` posledného úspešného behu pravidla (`derivation_runs`). */
  models: Record<string, number> | null;
}

export interface PlanRows {
  storageBase: string;
  modelRevisions: ModelRevisionRow[];
  /** Revízia kópie, z ktorej je mapa GlobalId -> model (`ifc_rev_current`). */
  copyRevisions: { model: string; revision: number }[];
  containerRevisions: ContainerRevisionRow[];
  documents: DocumentRow[];
  objects: ObjectRow[];
  /** GlobalId -> model, z kópie aktuálnej revízie (D-183 K2). */
  guidModel: Map<string, string>;
  docLinks: DocLinkRow[];
  spatialLinks: SpatialLinkRow[];
  storeyMap: StoreyMapRow[];
  rules: DerivationRuleRow[];
}

export interface PlanOptions {
  createdAt: string;
  publisher?: string;
  aimNamespace?: string;
  layers?: Layer[];
}

export const basedOnKey = (models: Record<string, number> | null | undefined): string | null =>
  models && Object.keys(models).length
    ? Object.entries(models)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([m, r]) => `${m}=${r}`)
        .join(";")
    : null;

const pad3 = (n: number) => String(n).padStart(3, "0");

function fileNameFromUrl(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split("/").pop();
    return seg ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

function pageOf(d: DocumentRow): number | null {
  const m = /page=(\d+)/.exec(`${d.identification ?? ""} ${d.location ?? ""}`);
  return m ? Number(m[1]) : null;
}

export function buildPlan(rows: PlanRows, opts: PlanOptions): IcddPlan {
  const warnings: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const layers = opts.layers ?? [...LAYERS];

  const crByModel = new Map(rows.containerRevisions.filter((c) => c.model).map((c) => [c.model!, c]));
  const crByDoc = new Map(rows.containerRevisions.filter((c) => c.document_id).map((c) => [c.document_id!, c]));
  const payloads: IcddPayload[] = [];
  const current: Record<string, number> = {};

  for (const m of [...rows.modelRevisions].sort((a, b) => (a.model < b.model ? -1 : 1))) {
    if (!m.archive_path) {
      warnings.push(`${m.model} v${m.revision}: revízia nemá archív, model sa nepribalí`);
      skip("model_without_archive");
      continue;
    }
    current[m.model] = m.revision;
    const cr = crByModel.get(m.model);
    payloads.push({
      id: `model:${m.model}`,
      kind: "model",
      filename: `${m.model}_v${pad3(m.revision)}.ifc`,
      name: cr?.name ?? m.model,
      filetype: "ifc",
      format: "application/x-step",
      versionID: String(m.revision),
      sha256: m.sha256,
      sizeBytes: m.size_bytes,
      url: `${rows.storageBase}/storage/v1/object/public/${m.archive_path}`,
      gzip: /\.gz$/i.test(m.archive_path),
      identification: m.model,
      model: m.model,
      status: cr?.status ?? null,
      approval: cr?.approval ?? null,
      revisionNo: cr?.revision_no ?? m.revision,
    });
  }
  for (const c of rows.copyRevisions) {
    if (current[c.model] !== undefined && current[c.model] !== c.revision)
      warnings.push(`${c.model}: kópia revízie v DB je v${c.revision}, aktuálna je v${current[c.model]}; GlobalId sa hľadá v staršej kópii`);
  }

  const docPayload = new Map<string, IcddPayload>();
  const usedNames = new Set(payloads.map((p) => p.filename));
  const docs = rows.documents.filter((d) => d.object_type === "document").sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const d of docs) {
    if (!d.file_sha256 || !d.location) {
      skip("document_without_file");
      continue;
    }
    let filename = fileNameFromUrl(d.location) ?? `${d.identification ?? d.id}.pdf`;
    if (usedNames.has(filename)) filename = `${d.id}_${filename}`;
    usedNames.add(filename);
    const cr = crByDoc.get(d.id);
    const ident = d.identification ?? d.object_ref ?? d.id;
    const p: IcddPayload = {
      id: `document:${d.id}`,
      kind: "document",
      filename,
      name: d.name ?? ident,
      filetype: /\.pdf$/i.test(filename) ? "pdf" : ((filename.split(".").pop() ?? "bin").toLowerCase() as "pdf"),
      format: d.electronic_format ?? "application/pdf",
      versionID: d.revision ?? cr?.revision ?? "1",
      sha256: d.file_sha256,
      description: d.description,
      url: d.location.split("#")[0],
      gzip: false,
      identification: ident,
      objectRef: d.object_ref,
      status: cr?.status ?? null,
      approval: cr?.approval ?? null,
      revisionNo: cr?.revision_no ?? null,
    };
    payloads.push(p);
    docPayload.set(d.id, p);
  }
  const refs = new Map(
    rows.documents.filter((d) => d.object_type === "document_reference").map((d) => [d.id, d] as const),
  );

  const objects = new Map(rows.objects.map((o) => [o.id, o]));
  const elementEnd = (guid: string | null | undefined, objectId?: string | null) => {
    const g = guid ?? (objectId ? objects.get(objectId)?.ifc_guid : null);
    if (!g) return null;
    const model = rows.guidModel.get(g);
    if (!model || current[model] === undefined) return null;
    return { payload: `model:${model}`, guid: g, objectRef: objectId ? (objects.get(objectId)?.object_ref ?? null) : null };
  };

  const links: IcddLink[] = [];
  if (layers.includes("documents-elements")) {
    for (const r of rows.docLinks) {
      if (!r.to_id) {
        skip("document_link_without_document");
        continue;
      }
      let target = docPayload.get(r.to_id);
      let page: number | null = null;
      const ref = refs.get(r.to_id);
      if (!target && ref?.referenced_document_id) {
        target = docPayload.get(ref.referenced_document_id);
        page = pageOf(ref);
      }
      if (!target) {
        skip("document_link_document_without_file");
        continue;
      }
      const from = elementEnd(r.global_id, r.from_id);
      if (!from) {
        skip("document_link_element_not_in_ifc");
        continue;
      }
      links.push({ kind: "IsElaboratedBy", from, to: { payload: target.id, page }, source: r.source });
    }
  }

  if (layers.includes("derived-spatial")) {
    const ruleBySource = new Map(rows.rules.filter((r) => r.source).map((r) => [r.source!, r]));
    const currentKey = basedOnKey(current);
    const stale = new Set<string>();
    for (const r of rows.spatialLinks) {
      const from = elementEnd(null, r.from_id);
      const to = elementEnd(null, r.to_id);
      if (!from || !to) {
        skip("derived_link_element_not_in_ifc");
        continue;
      }
      const rule = r.source ? ruleBySource.get(r.source) : undefined;
      const basedOn = basedOnKey(rule?.models);
      if (rule && basedOn && basedOn !== currentKey) stale.add(`${rule.id} (${basedOn})`);
      links.push({ kind: "IsReferencedInSpatialStructure", from, to, source: r.source, role: r.role, rule: rule?.id ?? null, basedOn });
    }
    for (const s of stale) warnings.push(`odvodenie ${s} bežalo nad inými revíziami, než sú aktuálne (${currentKey}); väzby sú zastarané`);
  }

  if (layers.includes("federation")) {
    const groups = new Map<string, StoreyMapRow[]>();
    for (const s of rows.storeyMap) {
      if (!s.to_id || current[s.model] === undefined) continue;
      groups.set(s.to_id, [...(groups.get(s.to_id) ?? []), s]);
    }
    for (const g of groups.values()) {
      const anchor = g.find((s) => s.match_rule === "guid");
      if (!anchor) {
        skip("storey_without_owner");
        continue;
      }
      for (const s of g) {
        if (s === anchor) continue;
        links.push({
          kind: "IsIdenticalTo",
          from: { payload: `model:${s.model}`, guid: s.global_id, label: s.name },
          to: { payload: `model:${anchor.model}`, guid: anchor.global_id, label: anchor.name },
          source: `ifc_storey_map:${s.match_rule ?? ""}`,
        });
      }
    }
  }

  const date = opts.createdAt.slice(0, 10);
  const modelSig = Object.entries(current)
    .map(([m, r]) => `${m}-v${pad3(r)}`)
    .join("_");
  const docCount = docPayload.size;
  return {
    versionID: `${date}_${modelSig}_D${docCount}`,
    versionDescription: `${Object.entries(current)
      .map(([m, r]) => `${m} v${r}`)
      .join(", ")}, ${docCount} dokumentov k ${date}; vrstvy ${layers.join(", ")}`,
    createdAt: opts.createdAt,
    description: "AIM: informačný model stavby (modely IFC, dokumenty PDF a väzby AIM), export ICDD podľa ISO 21597.",
    publisher: { name: opts.publisher ?? "AIM" },
    aimNamespace: opts.aimNamespace ?? DEFAULT_AIM_NAMESPACE,
    payloads,
    links,
    layers,
    skipped,
    warnings,
  };
}
