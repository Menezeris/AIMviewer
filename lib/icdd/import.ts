/**
  * Import of an ICDD container into AIM (D-181 addendum "import", Samuel 1. 11.: "go ahead"). Pure functions:
  * - `importRequestFromContents`: the browser picks from the checked container what the server needs (payloads with sha256,
  *   linksets with the marker, links). The container (~63 MB) does not go to the server (function limit ~4.5 MB), only this JSON does.
  * - `previewImport`: preview (dry-run) over the AIM state: what is added, closed, what is unchanged, and findings. The same computation
  *   runs at write; when the AIM state changed between the preview and the write (`aimStateSha256`), the write is rejected (409).
 *
  * Rules: only an element -> document or page link goes both ways (`IMPORTABLE_KINDS`, AIM layer
  * `rel_associates_document`); the other layers are export only (`EXCHANGE`) and their change is a finding, never a write. The marker
  * `aim:exchange` in the container is informational and the import can only restrict. The AIM layer is not overwritten (D-183): a link change =
  * close the old row + insert a new one. A link that is missing in the container is only a finding (Samuel 1. 11.: close nothing).
 */

import { linkKey } from "./build";
import { EXCHANGE, IMPORTABLE_KINDS, LAYERS, type IcddPlan, type Layer } from "./model";
import { compareStates, containerLinkKey, readContainerLinks, readContainerLinksets, type ContainerLink, type ContainerLinkset, type RoundtripDiff } from "./roundtrip";
import { sha256 } from "./sha256";
import type { IcddContents, ValidationReport } from "./validate";

/** Telo `POST /api/icdd/import` (bez obsahu payloadov). */
export interface ImportRequest {
  versionID: string | null;
    /** sha256 of the whole `.icdd`, computed by the browser. */
  containerSha256: string;
  fileName: string | null;
  payloads: { filename: string; sha256: string; filetype: string | null }[];
  linksets: ContainerLinkset[];
  links: ContainerLink[];
    /** Result of the ISO 21597 check in the browser (errors block the write). */
  validation: { ok: boolean; errors: number; warnings: number; issues: { level: string; code: string; where: string; message: string }[] };
}

export function importRequestFromContents(
  contents: IcddContents,
  report: ValidationReport,
  containerSha256: string,
  fileName: string | null,
  aimNamespace: string,
  versionID: string | null,
): ImportRequest {
  const payloads = [...contents.documents.values()]
    .filter((d) => d.filename && d.internal && !d.generated)
    .map((d) => ({ filename: d.filename!, sha256: d.checksum ?? "", filetype: d.filetype ?? null }))
    .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  const errors = report.issues.filter((i) => i.level === "error");
  return {
    versionID,
    containerSha256,
    fileName,
    payloads,
    linksets: readContainerLinksets(contents, aimNamespace),
    links: readContainerLinks(contents, aimNamespace)
      .map((l) => [containerLinkKey(l), l] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, l]) => l),
    validation: {
      ok: report.ok,
      errors: errors.length,
      warnings: report.issues.length - errors.length,
      issues: report.issues.slice(0, 50),
    },
  };
}

/** AIM state against which the import is computed (loaded by `import-fetch.ts`, read-only). */
export interface ImportContext {
    /** Current model revisions `{ASR: 79, VZT: 11}`. */
  current: Record<string, number>;
    /** All model revisions (sha256 of the uncompressed IFC). */
  modelRevisions: { model: string; revision: number; sha256: string }[];
    /** Live documents and their parts (`documents` + `objects.valid_until is null`). */
  documents: { id: string; object_type: string; file_sha256: string | null; referenced_document_id: string | null; page: number | null }[];
    /** GlobalId -> AIM node (`ifc_guid_node`) for the GlobalIds from the request. */
  guidNodes: Map<string, { object_id: string; object_type: string }>;
    /** GlobalId -> model in the copy of the current revision (`ifc_rev_objects`) for the GlobalIds from the request. */
  copyGuids: Map<string, string>;
    /** AIM layer `rel_associates_document`: live rows and closed rows with the id from the request. */
  aimLinks: { id: string; from_id: string; to_id: string; source: string | null; valid_until: string | null }[];
    /** Element -> document links from the IFC files (`source ifc:*`) as `from_id|to_id`. */
  ifcDocPairs: Set<string>;
    /** Allowed node types on the element side (manifest `relationship_types.from_object_types`). */
  fromObjectTypes: string[];
    /** Export plan from the same state (comparison of the export-only layers). */
  plan: IcddPlan | null;
}

export type FindingCode =
  | "validation_failed"
  | "unknown_payload"
  | "unknown_model_revision"
  | "stale_revision"
  | "unknown_document"
  | "ambiguous_document"
  | "invalid_end_type"
  | "unknown_global_id"
  | "element_not_in_aim"
  | "page_without_reference"
  | "based_on_other_revision"
  | "relationship_closed"
  | "duplicate_relationship_id"
  | "duplicate_in_container"
  | "already_in_ifc"
  | "unknown_relationship_id"
  | "missing_in_container"
  | "no_importable_linkset"
  | "export_only_changed"
  | "layer_absent"
  | "unsupported_class"
  | "exchange_mark_mismatch"
  | "exchange_mark_restricts";

export interface Finding {
  code: FindingCode;
  level: "error" | "warning" | "info";
    /** Canonical link key or file / linkset name. */
  key: string;
  detail: string;
}

export type ImportChange =
  | { op: "add"; key: string; from_id: string; to_id: string; container_relationship_id: string | null; replaces: string | null }
  | { op: "close"; key: string; id: string; reason: "modify" };

export interface ImportPreview {
  versionID: string | null;
  containerSha256: string;
    /** Fingerprint of the AIM state over which the preview was created (current revisions + live AIM element-document layer). */
  aimStateSha256: string;
  modelRevisions: Record<string, number>;
  payloads: Record<string, string>;
  counts: {
    links: number;
    importable: number;
    unchanged: number;
    add: number;
    close: number;
    findings: Partial<Record<FindingCode, number>>;
    layers: Record<string, number>;
  };
  changes: ImportChange[];
  findings: Finding[];
  /** Roundtrip vrstiev len na export (ako `checkIcdd`). */
  diff: RoundtripDiff | null;
    /** The write is possible: the ISO check passed and there is something to write. */
  applicable: boolean;
}

/** Fingerprint of the AIM state for the write gate (409 on a change between preview and write). */
export function aimStateSha256(ctx: Pick<ImportContext, "current" | "aimLinks">): string {
  const revs = Object.entries(ctx.current)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([m, r]) => `${m}=${r}`)
    .join(";");
  const rows = ctx.aimLinks
    .filter((l) => !l.valid_until)
    .map((l) => `${l.id}|${l.from_id}|${l.to_id}|${l.source ?? ""}`)
    .sort();
  return sha256(`v1\n${revs}\n${rows.join("\n")}`);
}

export function parseBasedOn(s: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (s ?? "").split(";")) {
    const m = /^\s*([^=\s]+)\s*=\s*(\d+)\s*$/.exec(part);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

const MAX_EXPORT_ONLY_FINDINGS = 200;

export function previewImport(req: ImportRequest, ctx: ImportContext): ImportPreview {
  const findings: Finding[] = [];
  const add = (code: FindingCode, level: Finding["level"], key: string, detail: string) => findings.push({ code, level, key, detail });
  const changes: ImportChange[] = [];
  const layerCounts: Record<string, number> = {};
  for (const l of req.links) layerCounts[l.layer] = (layerCounts[l.layer] ?? 0) + 1;

  if (!req.validation.ok) add("validation_failed", "error", req.fileName ?? "", `kontrola ISO 21597 našla ${req.validation.errors} chýb; zápis nie je možný`);

  // payloads: model by the revision sha256, document by the file sha256
  const payloadSha = new Map(req.payloads.map((p) => [p.filename, p.sha256]));
  const revBySha = new Map(ctx.modelRevisions.map((r) => [r.sha256, r]));
  const docsBySha = new Map<string, ImportContext["documents"]>();
  for (const d of ctx.documents) {
    if (d.object_type !== "document" || !d.file_sha256) continue;
    docsBySha.set(d.file_sha256, [...(docsBySha.get(d.file_sha256) ?? []), d]);
  }
  type PayloadInfo =
    | { kind: "model"; model: string; revision: number; current: boolean }
    | { kind: "document"; docs: ImportContext["documents"] }
    | { kind: "unknown" };
  const payloadInfo = new Map<string, PayloadInfo>();
  for (const p of req.payloads) {
    const rev = revBySha.get(p.sha256);
    const docs = docsBySha.get(p.sha256);
    if (rev) {
      const current = ctx.current[rev.model] === rev.revision;
      payloadInfo.set(p.filename, { kind: "model", model: rev.model, revision: rev.revision, current });
    } else if (docs?.length) payloadInfo.set(p.filename, { kind: "document", docs });
    else payloadInfo.set(p.filename, { kind: "unknown" });
  }

    // linkset policy: the code decides (EXCHANGE), the marker can only restrict the import
  const markOf = new Map(req.linksets.map((l) => [l.layer, l.exchange]));
  const policyOf = (layer: string) => ((LAYERS as readonly string[]).includes(layer) ? EXCHANGE[layer as Layer] : null);
  for (const ls of req.linksets) {
    const policy = policyOf(ls.layer);
    if (policy && ls.exchange && ls.exchange !== policy)
      add("exchange_mark_mismatch", "warning", ls.layer, `značka aim:exchange "${ls.exchange}", AIM vrstvu ${ls.layer} berie ako "${policy}"`);
    if (!policy && ls.exchange === "export-only" && req.links.some((l) => l.layer === ls.layer && IMPORTABLE_KINDS.includes(l.kind)))
      add("exchange_mark_restricts", "info", ls.layer, `linkset je označený export-only, jeho väzby sa nezapíšu`);
  }

  const importable: ContainerLink[] = [];
  const exportOnly: ContainerLink[] = [];
  for (const l of req.links) {
    const policy = policyOf(l.layer);
    const mark = markOf.get(l.layer) ?? null;
    if (policy) {
      if (policy === "import" && IMPORTABLE_KINDS.includes(l.kind) && mark !== "export-only") importable.push(l);
      else exportOnly.push(l);
    } else if (IMPORTABLE_KINDS.includes(l.kind)) {
      if (mark !== "export-only") importable.push(l);
    } else add("unsupported_class", "warning", containerLinkKey(l), `väzba ${l.kind} v cudzom linksete ${l.layer} sa neimportuje`);
  }

    // AIM layer links
  const live = ctx.aimLinks.filter((l) => !l.valid_until);
  const liveById = new Map(live.map((l) => [l.id, l]));
  const closedById = new Map(ctx.aimLinks.filter((l) => l.valid_until).map((l) => [l.id, l]));
  const liveByPair = new Map<string, (typeof live)[number]>();
  for (const l of live) if (!liveByPair.has(`${l.from_id}|${l.to_id}`)) liveByPair.set(`${l.from_id}|${l.to_id}`, l);
  const matched = new Set<string>();
  const closing = new Set<string>();
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  const fromTypes = new Set(ctx.fromObjectTypes);
  let unchanged = 0;

  for (const l of importable) {
    const key = containerLinkKey(l);
    // strana prvku
    const fp = payloadInfo.get(l.from.file);
    if (!payloadSha.has(l.from.file) || !fp) {
      add("unknown_payload", "warning", key, `súbor ${l.from.file} nie je v indexe kontajnera`);
      continue;
    }
    if (fp.kind === "unknown") {
      add("unknown_model_revision", "warning", key, `${l.from.file}: sha256 nezodpovedá žiadnej revízii modelu v AIM (nová revízia ide len cez model_publish)`);
      continue;
    }
    if (fp.kind !== "model" || !l.from.guid) {
      add("invalid_end_type", "warning", key, `začiatok väzby musí byť prvok v IFC (GlobalId)`);
      continue;
    }
    if (!fp.current) {
      add("stale_revision", "warning", key, `${l.from.file} je ${fp.model} v${fp.revision}, aktuálna je v${ctx.current[fp.model]}`);
      continue;
    }
    const based = parseBasedOn(l.basedOn);
    if (based[fp.model] !== undefined && based[fp.model] !== ctx.current[fp.model]) {
      add("based_on_other_revision", "warning", key, `aim:basedOnRevision ${l.basedOn}, aktuálna ${fp.model} v${ctx.current[fp.model]}`);
      continue;
    }
    const node = ctx.guidNodes.get(l.from.guid);
    if (!node) {
      if (ctx.copyGuids.has(l.from.guid)) add("element_not_in_aim", "warning", key, `${l.from.guid} je v ${fp.model} v${fp.revision}, ale nemá uzol AIM`);
      else add("unknown_global_id", "warning", key, `${l.from.guid} nie je v ${fp.model} v${fp.revision}`);
      continue;
    }
    if (!fromTypes.has(node.object_type)) {
      add("invalid_end_type", "warning", key, `${l.from.guid} je ${node.object_type}, väzba na dokument ho nepripúšťa`);
      continue;
    }
    // strana dokumentu
    const tp = payloadInfo.get(l.to.file);
    if (!payloadSha.has(l.to.file) || !tp) {
      add("unknown_payload", "warning", key, `súbor ${l.to.file} nie je v indexe kontajnera`);
      continue;
    }
    if (tp.kind === "model" || l.to.guid || l.to.ident) {
      add("invalid_end_type", "warning", key, `koniec väzby musí byť dokument alebo jeho strana`);
      continue;
    }
    if (tp.kind === "unknown") {
      add("unknown_document", "warning", key, `${l.to.file}: sha256 nezodpovedá žiadnemu dokumentu v AIM (nový súbor sa importom nenahráva)`);
      continue;
    }
    if (tp.docs.length > 1) {
      add("ambiguous_document", "warning", key, `${l.to.file}: rovnaký sha256 má ${tp.docs.length} dokumentov v AIM`);
      continue;
    }
    const doc = tp.docs[0];
    let toId = doc.id;
    if (l.to.page != null) {
      const refs = ctx.documents.filter((d) => d.object_type === "document_reference" && d.referenced_document_id === doc.id && d.page === l.to.page);
      if (refs.length !== 1) {
        add("page_without_reference", "warning", key, `${l.to.file} strana ${l.to.page}: v AIM ${refs.length ? "viac častí" : "nie je časť dokumentu"} s touto stranou`);
        continue;
      }
      toId = refs[0].id;
    }
    const pair = `${node.object_id}|${toId}`;
    if (seenPairs.has(pair)) {
      add("duplicate_in_container", "info", key, `rovnaká väzba prvok-dokument je v kontajneri viackrát`);
      continue;
    }
    seenPairs.add(pair);
    if (ctx.ifcDocPairs.has(pair)) {
      add("already_in_ifc", "info", key, `väzba je IfcRelAssociatesDocument v súbore IFC, ostáva len tam`);
      continue;
    }
    const rid = l.relationshipId;
    if (rid) {
      if (seenIds.has(rid)) {
        add("duplicate_relationship_id", "warning", key, `aim:relationshipId ${rid} má v kontajneri viac väzieb`);
        continue;
      }
      seenIds.add(rid);
      if (closedById.has(rid) && !liveById.has(rid)) {
        add("relationship_closed", "warning", key, `väzba ${rid} je v AIM už ukončená (${closedById.get(rid)!.valid_until})`);
        continue;
      }
      const cur = liveById.get(rid);
      if (cur) {
        matched.add(rid);
        if (`${cur.from_id}|${cur.to_id}` === pair) {
          unchanged++;
          continue;
        }
                // link change: the old row is closed, the new one inserted (D-183: the AIM layer is not overwritten)
        changes.push({ op: "close", key, id: rid, reason: "modify" });
        closing.add(rid);
        const other = liveByPair.get(pair);
        if (other && !closing.has(other.id)) {
          matched.add(other.id);
          continue;
        }
        changes.push({ op: "add", key, from_id: node.object_id, to_id: toId, container_relationship_id: rid, replaces: rid });
        continue;
      }
      add("unknown_relationship_id", "info", key, `aim:relationshipId ${rid} AIM nepozná; väzba sa páruje podľa obsahu`);
    }
    const other = liveByPair.get(pair);
    if (other && !closing.has(other.id)) {
      matched.add(other.id);
      unchanged++;
      continue;
    }
    changes.push({ op: "add", key, from_id: node.object_id, to_id: toId, container_relationship_id: rid ?? null, replaces: null });
  }

    // AIM links missing from the container: only a finding (Samuel 1. 11.: close nothing)
  const hasImportLinkset = req.linksets.some((ls) => {
    const policy = policyOf(ls.layer);
    return (policy === "import" || (!policy && req.links.some((l) => l.layer === ls.layer && IMPORTABLE_KINDS.includes(l.kind)))) && ls.exchange !== "export-only";
  });
  const missing = live.filter((l) => !matched.has(l.id) && !closing.has(l.id));
  if (!hasImportLinkset) {
    if (missing.length) add("no_importable_linkset", "info", "", `kontajner nemá importovateľný linkset; ${missing.length} väzieb AIM prvok-dokument sa neporovnáva`);
  } else for (const l of missing) add("missing_in_container", "warning", l.id, `väzba AIM ${l.id} (${l.source ?? ""}) v kontajneri chýba; neuzatvára sa`);

    // export-only layers: a difference against the plan is a finding, never a write
  let diff: RoundtripDiff | null = null;
  if (ctx.plan) {
    const plan = ctx.plan;
    const present = new Set(exportOnly.map((l) => l.layer));
    for (const ls of req.linksets) if (policyOf(ls.layer) === "export-only") present.add(ls.layer);
    for (const layer of plan.layers)
      if (EXCHANGE[layer] === "export-only" && !present.has(layer)) add("layer_absent", "info", layer, `vrstva ${layer} v kontajneri nie je, neporovnáva sa`);
    const containerKeys = new Map(exportOnly.map((l) => [containerLinkKey(l), { key: containerLinkKey(l), kind: l.kind, layer: l.layer }]));
    const aimKeys = new Map(
      plan.links
        .filter((l) => present.has(layerOfKind(l.kind)) && EXCHANGE[layerOfKind(l.kind)] === "export-only")
        .map((l) => {
          const key = linkKey(plan, l);
          return [key, { key, kind: l.kind, layer: layerOfKind(l.kind) }] as const;
        }),
    );
    diff = compareStates(
      { versionID: req.versionID, payloads: new Map(req.payloads.map((p) => [p.filename, p.sha256])), links: containerKeys },
      { versionID: plan.versionID, payloads: new Map(plan.payloads.map((p) => [p.filename, p.sha256])), links: aimKeys },
    );
    const changed = [
      ...diff.linksOnlyInContainer.map((k) => [k, "len v kontajneri"] as const),
      ...diff.linksOnlyInAim.map((k) => [k, "len v AIM"] as const),
    ];
    for (const [k, where] of changed.slice(0, MAX_EXPORT_ONLY_FINDINGS)) add("export_only_changed", "warning", k, `väzba vrstvy len na export ${where}; nezapisuje sa`);
    if (changed.length > MAX_EXPORT_ONLY_FINDINGS)
      add("export_only_changed", "warning", "", `a ďalších ${changed.length - MAX_EXPORT_ONLY_FINDINGS} rozdielov vo vrstvách len na export (diff)`);
  }

  const counts: ImportPreview["counts"]["findings"] = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;
  const writes = changes.length;
  return {
    versionID: req.versionID,
    containerSha256: req.containerSha256,
    aimStateSha256: aimStateSha256(ctx),
    modelRevisions: { ...ctx.current },
    payloads: Object.fromEntries(req.payloads.map((p) => [p.filename, p.sha256])),
    counts: {
      links: req.links.length,
      importable: importable.length,
      unchanged,
      add: changes.filter((c) => c.op === "add").length,
      close: changes.filter((c) => c.op === "close").length,
      findings: counts,
      layers: layerCounts,
    },
    changes,
    findings,
    diff,
    applicable: req.validation.ok && writes > 0,
  };
}

function layerOfKind(kind: ContainerLink["kind"]): Layer {
  switch (kind) {
    case "IsElaboratedBy":
      return "documents-elements";
    case "IsReferencedInSpatialStructure":
      return "derived-spatial";
    case "IsIdenticalTo":
      return "federation";
    case "DocumentIsIdenticalTo":
      return "documents-identity";
  }
}

/** Request body check (server); returns an error or null. */
export function checkImportRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") return "telo nie je objekt";
  const b = body as Partial<ImportRequest>;
  if (typeof b.containerSha256 !== "string" || !/^[0-9a-f]{64}$/.test(b.containerSha256)) return "containerSha256: 64 hex";
  if (!Array.isArray(b.payloads) || !Array.isArray(b.linksets) || !Array.isArray(b.links)) return "payloads, linksets, links: polia";
  if (!b.validation || typeof b.validation.ok !== "boolean") return "validation.ok chýba";
  const end = (e: unknown) =>
    !!e && typeof e === "object" && typeof (e as { file?: unknown }).file === "string";
  for (const l of b.links) {
    if (!l || typeof l !== "object" || typeof l.layer !== "string" || typeof l.kind !== "string" || !end(l.from) || !end(l.to)) return "neplatná väzba v links";
  }
  for (const p of b.payloads) if (!p || typeof p.filename !== "string" || typeof p.sha256 !== "string") return "neplatný payload";
  return null;
}
