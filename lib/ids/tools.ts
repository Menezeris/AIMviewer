import { createHash, randomUUID } from "node:crypto";

import { upstreamInputSchema } from "../engine/session";

import { describeDoc, diffDocs } from "./describe";
import { DEFAULT_IDS_AUTHOR, IDS_ACTIONS, type IdsAction } from "./tool-defs";
import { callIds, defaultIdsEngine, IdsEngineError, type IdsEngine } from "./engine";
import {
  IdsConflictError,
  type IdsDocumentRow,
  type IdsRunSummary,
  type IdsStore,
  type IdsVersionMeta,
  type IdsVersionRow,
} from "./types";

/**
 * Tool `ids_document` (D-162), len v MCP konektore. Nositeľ IDS je XML v DB; každé `apply_ops`
 * ide XML -> `ids_read` -> operácie (`ids_apply_ops`, brána voči IFC schéme) -> `ids_write`
 * (audit pred zápisom) -> nová nemenná verzia. Odmietnutá dávka nič neuloží. Upstream
 * `ids_apply_ops` nesie Studio JSON s id z obsahu; ten sa neukladá. Závislosti (DB, motor)
 * sú v `runtime.ts`.
 */

export interface IdsToolDeps {
  store: IdsStore;
  /** Relácia @ifc-lite/mcp bez modelov; predvolene čerstvá. */
  engine?: () => Promise<IdsEngine>;
}

export class IdsInputError extends Error {}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_XML_OUT = 256_000;
const LIST_MAX_CODES = 30;
const MAX_DIAGNOSTICS = 10;
const MAX_ISSUES = 20;

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};

function versionNo(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) throw new IdsInputError(`${field}: celé číslo od 1.`);
  return raw;
}

const sha256 = (xml: string) => createHash("sha256").update(xml).digest("hex");
const originLabel = (d: Pick<IdsDocumentRow, "origin">) => (d.origin === "library" ? "z knižnice (len na čítanie)" : "pracovné, nie je z knižnice");

async function loadDoc(deps: IdsToolDeps, raw: unknown): Promise<IdsDocumentRow> {
  const code = text(raw, 80);
  if (!code) throw new IdsInputError("Chýba ids (kód IDS, action=list ich ukáže).");
  const doc = await deps.store.byCode(code);
  if (doc) return doc;
  const codes = (await deps.store.listDocuments()).map((d) => d.code);
  throw new IdsInputError(
    `IDS '${code}' neexistuje. ${codes.length ? `V AIM sú: ${codes.slice(0, LIST_MAX_CODES).join(", ")}.` : "V AIM zatiaľ nie je žiadne IDS (action=create)."}`,
  );
}

async function loadVersion(deps: IdsToolDeps, doc: IdsDocumentRow, version: number | undefined): Promise<IdsVersionRow> {
  const row = await deps.store.version(doc.id, version);
  if (row) return row;
  throw new IdsInputError(version === undefined ? `IDS '${doc.code}' nemá žiadnu verziu.` : `IDS '${doc.code}' nemá verziu ${version}.`);
}

interface Engine {
  engine: IdsEngine;
}

/** XML -> Studio dokument (`ids_read`) s názvom a verziou z `ids:info`. */
async function readXml(e: Engine, xml: string) {
  const out = await callIds(e.engine, "ids_read", { ids_xml: xml });
  const described = describeDoc(out.doc);
  return { doc: out.doc, described };
}

function counts(v: unknown): Record<string, number> | null {
  return v && typeof v === "object" ? (v as Record<string, number>) : null;
}

interface Serialized {
  xml: string;
  audit: Record<string, unknown>;
}

/** `ids_write`: serializácia s auditom; dokument s chybami auditu nevznikne. */
async function writeDoc(e: Engine, doc: unknown, lint: unknown): Promise<Serialized> {
  const out = await callIds(e.engine, "ids_write", { doc });
  const audit = (out.audit ?? {}) as { status?: string; issues?: Array<{ severity?: string }> };
  const issueCounts = { error: 0, warning: 0, info: 0 };
  for (const i of audit.issues ?? []) if (i.severity && i.severity in issueCounts) issueCounts[i.severity as keyof typeof issueCounts]++;
  const lintCounts = counts((lint as { counts?: unknown } | undefined)?.counts);
  return {
    xml: String(out.xml ?? ""),
    audit: { status: audit.status ?? null, counts: issueCounts, ...(lintCounts ? { lint: lintCounts } : {}) },
  };
}

function withOpIds(ops: unknown): unknown {
  if (!Array.isArray(ops)) return ops;
  return ops.map((o) => (o && typeof o === "object" && !Array.isArray(o) && !("opId" in o) ? { ...o, opId: randomUUID() } : o));
}

function issuesView(details: Record<string, unknown> | null) {
  const list = Array.isArray(details?.issues) ? (details.issues as Array<Record<string, unknown>>) : [];
  return list.slice(0, MAX_ISSUES).map((i) => ({
    code: i.code,
    path: i.path,
    message: i.message,
    ...(Array.isArray(i.candidates) && i.candidates.length ? { candidates: (i.candidates as Array<{ value?: unknown }>).slice(0, 5).map((c) => c.value ?? c) } : {}),
  }));
}

/** Operácie do dokumentu (z `doc`, alebo do prázdneho). Odmietnutú dávku vráti ako chybu s kódmi brány. */
async function applyToDoc(e: Engine, base: { doc?: unknown; title?: string }, ops: unknown) {
  const out = await callIds(e.engine, "ids_apply_ops", {
    ...(base.doc !== undefined ? { doc: base.doc } : {}),
    ...(base.title ? { title: base.title } : {}),
    ops: withOpIds(ops),
  });
  return out as { doc: unknown; applied: number; lint?: { counts?: unknown; diagnostics?: Array<Record<string, unknown>> } };
}

function lintView(lint: { counts?: unknown; diagnostics?: Array<Record<string, unknown>> } | undefined) {
  if (!lint) return undefined;
  const diagnostics = (lint.diagnostics ?? [])
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => ({ severity: d.severity, code: d.code ?? d.rule, path: d.path, message: d.message }));
  return { counts: lint.counts, ...(diagnostics.length ? { diagnostics } : {}) };
}

const metaView = (v: IdsVersionMeta) => ({
  version: v.version,
  created_at: v.created_at,
  author: v.author,
  source: v.source,
  note: v.note,
  sha256: v.sha256,
  ids_version: v.ids_version,
  audit: v.audit,
});

function runView(r: IdsRunSummary) {
  return {
    version: r.version,
    model: r.model_label,
    checked_at: r.checked_at,
    engine: r.engine,
    trigger: r.trigger,
    specs: `${r.specs_passed}/${r.specs_total}`,
    results_failed: r.results_failed,
    binding: r.binding,
  };
}

async function list(deps: IdsToolDeps) {
  const docs = await deps.store.listDocuments();
  const ids = docs.map((d) => d.id);
  const [latest, runs] = await Promise.all([deps.store.latestVersions(ids), deps.store.lastRuns(ids)]);
  return {
    count: docs.length,
    items: docs.map((d) => {
      const v = latest.get(d.id);
      const r = runs.get(d.id);
      return {
        code: d.code,
        title: d.title,
        origin: d.origin,
        label: originLabel(d),
        status: d.status,
        version: v?.version ?? null,
        updated_at: d.updated_at,
        last_run: r ? runView(r) : null,
      };
    }),
    note: "Behy sú záznam kontroly, žiadny nie je záväzný (binding=false).",
  };
}

async function get(args: Record<string, unknown>, deps: IdsToolDeps, e: Engine) {
  const doc = await loadDoc(deps, args.ids);
  const row = await loadVersion(deps, doc, versionNo(args.version, "version"));
  const { described } = await readXml(e, row.xml);
  const origin = doc.derived_from ? await deps.store.versionById(doc.derived_from) : null;
  const originDoc = origin ? await deps.store.byId(origin.document_id) : null;
  const xmlOut = args.include_xml === true;
  return {
    code: doc.code,
    title: doc.title,
    origin: doc.origin,
    label: originLabel(doc),
    ...(doc.library_source ? { library_source: doc.library_source } : {}),
    ...(origin && originDoc ? { derived_from: { code: originDoc.code, version: origin.version } } : {}),
    ...metaView(row),
    ids: described,
    ...(xmlOut ? (row.xml.length > MAX_XML_OUT ? { xml_omitted: `XML má ${row.xml.length} znakov (strop ${MAX_XML_OUT}); použi export.` } : { xml: row.xml }) : {}),
  };
}

async function create(args: Record<string, unknown>, deps: IdsToolDeps, e: Engine) {
  const code = text(args.code, 80);
  if (!code || !CODE_RE.test(code)) throw new IdsInputError("code: písmená, čísla a . _ - (max 80), začína písmenom alebo číslom.");
  if (await deps.store.byCode(code)) throw new IdsInputError(`IDS '${code}' už existuje. Zvoľ iný kód alebo použi apply_ops.`);
  const hasOps = Array.isArray(args.ops) && args.ops.length > 0;
  const sources = [args.xml !== undefined, args.derived_from !== undefined, hasOps].filter(Boolean).length;
  if (sources !== 1) {
    throw new IdsInputError("create: pošli presne jedno z xml, derived_from alebo ops (prázdne IDS bez špecifikácie neprejde auditom).");
  }
  const author = text(args.author, 200) || DEFAULT_IDS_AUTHOR;
  let xml: string;
  let audit: Record<string, unknown>;
  let note = text(args.note, 2000) ?? null;
  let derivedFrom: string | null = null;
  let titleOverride = text(args.title, 200);

  if (args.derived_from !== undefined) {
    const src = await loadDoc(deps, args.derived_from);
    if (src.origin !== "library") throw new IdsInputError(`derived_from patrí knižničnému IDS; '${src.code}' je pracovné (použi export a create s xml).`);
    const ver = await loadVersion(deps, src, versionNo(args.derived_from_version, "derived_from_version"));
    xml = ver.xml;
    derivedFrom = ver.id;
    audit = ver.audit ?? {};
    note ??= `Odvodené z ${src.code} v${ver.version}`;
    titleOverride ??= src.title;
  } else if (args.xml !== undefined) {
    if (typeof args.xml !== "string" || !args.xml.trim()) throw new IdsInputError("xml: neprázdny reťazec s IDS XML.");
    const report = await callIds(e.engine, "ids_audit", { ids_xml: args.xml });
    const c = counts(report.counts);
    if ((c?.error ?? 0) > 0) {
      throw new IdsEngineError("ids_audit", `IDS neprešlo auditom (${c?.error} chýb); nič sa neuložilo.`, "AUDIT_FAILED", { issues: report.issues }, null);
    }
    xml = args.xml;
    audit = { status: report.status ?? null, counts: c };
  } else {
    const applied = await applyToDoc(e, { title: titleOverride ?? code }, args.ops);
    const written = await writeDoc(e, applied.doc, applied.lint);
    xml = written.xml;
    audit = written.audit;
  }

  const { described } = await readXml(e, xml);
  const title = (titleOverride && args.derived_from === undefined ? titleOverride : described.title || titleOverride || code).slice(0, 200);
  const doc = await deps.store.createDocument({ code, title, origin: "chat", derived_from: derivedFrom, created_by: author });
  try {
    const row = await deps.store.addVersion(
      doc.id,
      { xml, sha256: sha256(xml), title, ids_version: described.version, audit, author, source: "chat", note },
      null,
    );
    return { created: { code, title, origin: "chat", label: originLabel(doc), version: row.version, sha256: row.sha256, derived_from_id: derivedFrom }, ids: described };
  } catch (err) {
    await deps.store.deleteDocument(doc.id).catch(() => undefined);
    throw err;
  }
}

/** Najčastejšie operácie (celá schéma má ~40 kB, príklady stačia na väčšinu úprav). */
const OP_EXAMPLES = [
  { kind: "spec.add", payload: { specId: "<uuid>", name: "Steny majú požiarnu odolnosť", ifcVersions: ["IFC4"] } },
  { kind: "facet.add", payload: { specId: "<uuid>", section: "applicability", facetId: "<uuid>", facet: { type: "entity", name: { kind: "equals", value: "IFCWALL" } } } },
  {
    kind: "facet.add",
    payload: {
      specId: "<uuid>",
      section: "requirements",
      facetId: "<uuid>",
      facet: { type: "property", propertySet: { kind: "equals", value: "Pset_WallCommon" }, baseName: { kind: "equals", value: "FireRating" } },
    },
  },
  { kind: "doc.setInfo", payload: { field: "title", value: "Nový názov" } },
];

async function applyOps(args: Record<string, unknown>, deps: IdsToolDeps, e: Engine) {
  if (args.ops === undefined) {
    const schema = upstreamInputSchema("ids_apply_ops") as { properties?: { ops?: unknown }; $defs?: unknown };
    return {
      examples: OP_EXAMPLES,
      ops_schema: { ops: schema.properties?.ops, $defs: schema.$defs },
      hint: "Pošli ops (pole operácií). specId, facetId a opId sú UUID; chýbajúce opId doplním. ids špecifikácií a facetov dá action=get.",
    };
  }
  if (!Array.isArray(args.ops) || args.ops.length === 0) throw new IdsInputError("ops: neprázdne pole operácií IDS ops v1.");
  const doc = await loadDoc(deps, args.ids);
  if (doc.origin === "library") {
    throw new IdsInputError(
      `IDS '${doc.code}' je knižničná snímka, len na čítanie (D-162). Vytvor pracovnú kópiu: ids_document(action=create, code=<nový kód>, derived_from='${doc.code}') a ops pošli na nej.`,
    );
  }
  const latest = await loadVersion(deps, doc, undefined);
  const baseNo = versionNo(args.base_version, "base_version") ?? latest.version;
  if (baseNo !== latest.version) throw new IdsConflictError(latest.version, baseNo);
  const { doc: studio } = await readXml(e, latest.xml);
  const applied = await applyToDoc(e, { doc: studio }, args.ops);
  const written = await writeDoc(e, applied.doc, applied.lint);
  const { described } = await readXml(e, written.xml);
  const author = text(args.author, 200) || DEFAULT_IDS_AUTHOR;
  const row = await deps.store.addVersion(
    doc.id,
    {
      xml: written.xml,
      sha256: sha256(written.xml),
      title: described.title || doc.title,
      ids_version: described.version,
      audit: written.audit,
      author,
      source: "chat",
      note: text(args.note, 2000) ?? null,
    },
    baseNo,
  );
  return {
    saved: true,
    code: doc.code,
    version: row.version,
    previous_version: latest.version,
    applied: applied.applied,
    sha256: row.sha256,
    audit: written.audit,
    lint: lintView(applied.lint),
    ids: described,
  };
}

async function versions(args: Record<string, unknown>, deps: IdsToolDeps) {
  const doc = await loadDoc(deps, args.ids);
  const list = await deps.store.versions(doc.id);
  return { code: doc.code, origin: doc.origin, label: originLabel(doc), versions: list.map(metaView) };
}

async function diff(args: Record<string, unknown>, deps: IdsToolDeps, e: Engine) {
  const doc = await loadDoc(deps, args.ids);
  const latest = await loadVersion(deps, doc, undefined);
  const to = versionNo(args.to_version, "to_version") ?? latest.version;
  const from = versionNo(args.from_version, "from_version") ?? to - 1;
  if (from < 1) throw new IdsInputError(`IDS '${doc.code}' má len jednu verziu, nie je čo porovnať.`);
  if (from === to) throw new IdsInputError("from_version a to_version sú rovnaké.");
  const [a, b] = await Promise.all([loadVersion(deps, doc, from), loadVersion(deps, doc, to)]);
  const [da, db] = await Promise.all([readXml(e, a.xml), readXml(e, b.xml)]);
  return { code: doc.code, from_version: from, to_version: to, ...diffDocs(da.described, db.described) };
}

async function exportIds(args: Record<string, unknown>, deps: IdsToolDeps) {
  const doc = await loadDoc(deps, args.ids);
  const row = await loadVersion(deps, doc, versionNo(args.version, "version"));
  if (row.xml.length > MAX_XML_OUT) throw new IdsInputError(`XML má ${row.xml.length} znakov, nad stropom ${MAX_XML_OUT} sa cez konektor nevracia.`);
  return {
    code: doc.code,
    version: row.version,
    filename: `${doc.code}-v${row.version}.ids`,
    sha256: row.sha256,
    xml: row.xml,
    note: "XML priamo v odpovedi; odkaz na stiahnutie pribudne s route app/api/ids (D-162 host PR2).",
  };
}

const PENDING_PR2 =
  "zatiaľ nie je dostupná: otvorenie IDS vo vieweri a uloženie z viewera prídu s D-162 host PR2 (po D-161 Fork A). " +
  "Teraz: get, export a kontrola modelu cez ifc_ids_validate(ids=kód).";

export interface IdsToolResult {
  text: string;
  isError: boolean;
}

export async function execIdsTool(name: string, args: Record<string, unknown>, deps: IdsToolDeps): Promise<IdsToolResult> {
  if (name !== "ids_document") return { text: `Neznámy tool: ${name}`, isError: true };
  try {
    const action = args.action;
    if (typeof action !== "string" || !(IDS_ACTIONS as readonly string[]).includes(action)) {
      throw new IdsInputError(`action: ${IDS_ACTIONS.join(" | ")}.`);
    }
    const e: Engine = { engine: deps.engine ? await deps.engine() : await defaultIdsEngine() };
    let out: unknown;
    switch (action as IdsAction) {
      case "list":
        out = await list(deps);
        break;
      case "get":
        out = await get(args, deps, e);
        break;
      case "create":
        out = await create(args, deps, e);
        break;
      case "apply_ops":
        out = await applyOps(args, deps, e);
        break;
      case "versions":
        out = await versions(args, deps);
        break;
      case "diff":
        out = await diff(args, deps, e);
        break;
      case "export":
        out = await exportIds(args, deps);
        break;
      case "open":
      case "from_viewer":
        throw new IdsInputError(`action=${action} ${PENDING_PR2}`);
    }
    return { text: JSON.stringify(out), isError: false };
  } catch (err) {
    if (err instanceof IdsEngineError) {
      // Odmietnutá dávka alebo zlý dokument: kódy brány, cesty a kandidáti; nič sa neuložilo.
      const issues = issuesView(err.details);
      return {
        text: JSON.stringify({
          saved: false,
          refused: true,
          tool: err.tool,
          ...(err.code ? { code: err.code } : {}),
          message: issues.length ? "Brána odmietla dávku, nič sa neuložilo. Oprav názvy a pošli celú dávku znova." : err.message,
          ...(issues.length ? { issues } : {}),
          ...(err.hint ? { hint: err.hint } : {}),
        }),
        isError: true,
      };
    }
    if (err instanceof IdsInputError || err instanceof IdsConflictError) return { text: err.message, isError: true };
    return { text: `Chyba toolu: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
