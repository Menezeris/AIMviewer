import { descriptionWithoutDocuments } from "./api";
import { documentWrite, MAX_TOPIC_DOCUMENTS, parseDocumentReferenceDto, stripOwnLabel, TopicDocumentError } from "./documents";
import { pageFromLocation } from "./store";
import type { BcfTopicRow, BcfTopicWrite, DocumentInfo, TopicDocumentRow, TopicDocumentWrite, TopicStatus } from "./store";
import { DEFAULT_AUTHOR, BcfInputError, MAX_COMPONENTS, type BcfDeps } from "./tools";
import { viewpointFromDto } from "./viewpoint";

import type { BCFDocumentReference, BCFProject, BCFTopic, BCFViewpoint } from "@ifc-lite/bcf";

/**
 * Import `.bcfzip` (BCF 2.1 a 3.0) do DB (D-158 krok 8, #199 bod 4): témy sa zapíšu do `model_tasks`,
 * odkazy na dokumenty do `model_task_documents`, komentáre cez `addComment` (s pôvodným dátumom), jediný pohľad témy
 * (D-099) a prvky do `components`. Idempotentné podľa guid témy: opakovaný import tej istej témy
 * nič nezdvojí a zapíše len zmenené polia. Rozhoduje čas zmeny: súbor novší než téma v DB ju
 * aktualizuje, inak ide o konflikt, ktorý sa len ohlási (nič sa nezapíše; `overwrite` ho prepíše).
 * Komentáre a nové odkazy sa len pridávajú, nikdy nemažú. Čistá logika nad `BcfStore`, bez servera.
 * Pôvodné dátumy a autori z BCF sa zachovajú: `created_at`/`updated_at` témy (creation/modified date),
 * dátum komentára (cez `model_task_import_comment`; kým migrácia nie je nasadená, komentár dostane čas zápisu).
 */

/** Strop počtu tém z jedného súboru (zvyšok sa neimportuje, ohlási sa). */
export const MAX_IMPORT_TOPICS = 500;
/** Strop veľkosti archívu (bajty) a rozbalených dát. */
export const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 300 * 1024 * 1024;
const MAX_ENTRIES = 20000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REV_RE = /\(rev\.\s*([^)]+)\)/i;

export type ImportResult = "created" | "updated" | "unchanged" | "conflict" | "skipped" | "failed";
export type ConflictPolicy = "keep" | "overwrite";

export interface ImportOptions {
  dryRun?: boolean;
  /** `keep` (predvolené): téma novšia v DB ostane, konflikt sa ohlási; `overwrite`: prepíše ju súbor. */
  conflict?: ConflictPolicy;
  /** Model federácie pre nové témy (súbor ho nenesie). */
  model?: string | null;
  /** Kto importuje (autor tém bez autora v súbore, `modified_by` pri zmene). */
  author?: string;
  /** Len tieto témy (guid z archívu). */
  guids?: string[];
}

export interface FieldDiff {
  field: string;
  db: unknown;
  incoming: unknown;
}

export interface TopicOutcome {
  guid: string;
  number?: number;
  title: string;
  result: ImportResult;
  /** created/updated: čo sa zapísalo (alebo by sa zapísalo pri dry_run). */
  changes?: string[];
  conflicts?: FieldDiff[];
  comments_added?: number;
  documents_added?: number;
  documents_updated?: number;
  /** Odkaz na dokument, ktorý sa nepodarilo priradiť k dokumentu AIM (ostal ako url). */
  documents_foreign?: number;
  reason?: string;
  warnings?: string[];
}

export interface ImportSummary {
  dry_run: boolean;
  bcf_version: string;
  topics_in_file: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  failed: number;
  topics: TopicOutcome[];
  warnings: string[];
}

/** BCF stav z ľubovoľného nástroja -> náš stav; neznámy = open + upozornenie. */
const STATUS_MAP: Record<string, TopicStatus> = {
  open: "open",
  new: "open",
  active: "open",
  reopened: "open",
  todo: "open",
  assigned: "in_progress",
  inprogress: "in_progress",
  started: "in_progress",
  resolved: "resolved",
  fixed: "resolved",
  done: "resolved",
  closed: "closed",
  conflict: "conflict",
  failed: "failed",
};

export function importStatus(raw: string | undefined): { status: TopicStatus; unknown: boolean } {
  const key = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return { status: "open", unknown: false };
  const hit = STATUS_MAP[key];
  return hit ? { status: hit, unknown: false } : { status: "open", unknown: true };
}

/** guid témy z archívu -> naše uuid: uuid ostáva, 22-znakový IFC guid sa prevedie, iné sa nedá. */
export function topicIdFromGuid(guid: string, ifcGuidToUuid: (g: string) => string, isValidIfcGuid: (g: string) => boolean): string | null {
  const g = guid.trim();
  if (UUID_RE.test(g)) return g.toLowerCase();
  if (g.length === 22 && isValidIfcGuid(g)) {
    const u = ifcGuidToUuid(g);
    return UUID_RE.test(u) ? u.toLowerCase() : null;
  }
  return null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

const dateOnly = (v: string | undefined): string | null => {
  const s = clean(v, 40);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** ISO čas z BCF dátumu; budúci čas (zlé hodiny zdroja) sa orezá na teraz, neplatný = null. */
const isoMs = (v: string | undefined, now: number): number | null => {
  const t = Date.parse(v ?? "");
  return Number.isNaN(t) ? null : Math.min(t, now);
};
const iso = (ms: number) => new Date(ms).toISOString();

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

interface IncomingRef {
  id: string | null;
  row: Omit<TopicDocumentWrite, "task_id">;
  foreign: boolean;
}

interface IncomingComment {
  author: string | null;
  comment: string;
  /** Pôvodný dátum komentára (ISO, nie v budúcnosti); undefined = súbor ho nemá. */
  date?: string;
}

interface Incoming {
  id: string;
  fields: Required<Pick<BcfTopicWrite, "title" | "description" | "topic_type" | "status" | "priority" | "assigned_to" | "due_date" | "labels">> & { stage: string | null };
  author: string | null;
  modifiedBy: string | null;
  modifiedAt: number | null;
  createdAt: number | null;
  viewpoint: Record<string, unknown> | null;
  components: string[];
  comments: IncomingComment[];
  refs: IncomingRef[];
  warnings: string[];
}

/** Kandidáti na kód dokumentu (Identification) z url a opisu cudzieho odkazu. */
export function identificationCandidates(url: string, description: string | null): string[] {
  const out: string[] = [];
  const base = url.split("#")[0].split("?")[0];
  const last = base.split("/").filter(Boolean).pop();
  if (last) {
    let v = last;
    try {
      v = decodeURIComponent(last);
    } catch {
      // nechaj surové
    }
    out.push(v, v.replace(/\.[A-Za-z0-9]{2,5}$/, ""));
  }
  if (description) {
    const head = description.split(/\s+\(rev\.|,|:|\n/)[0];
    out.push(head);
  }
  return [...new Set(out.map((c) => c.trim()).filter((c) => c.length >= 2 && c.length <= 200))];
}

/** DocumentReference z archívu -> riadok odkazu (dokument AIM podľa adresy, kódu; inak ostane url). */
export async function referenceFromBcf(deps: BcfDeps, ref: BCFDocumentReference, author: string): Promise<IncomingRef | null> {
  const url = clean(ref.url ?? ref.referencedDocument, 2000);
  const description = clean(ref.description, 2000);
  if (!url && !description) return null;
  const id = ref.guid && UUID_RE.test(ref.guid) ? ref.guid.toLowerCase() : null;
  let info: DocumentInfo | null = null;
  let page: number | null = null;
  let region: TopicDocumentRow["region"] = null;
  if (url) {
    let origin = "https://aim.invalid";
    try {
      origin = new URL(url, origin).origin;
    } catch {
      // chybná adresa: parse ju vyhodnotí ako cudziu
    }
    const parsed = parseDocumentReferenceDto({ url, description: description ?? undefined }, origin);
    if (parsed.document_id) {
      info = await deps.store.findDocument(parsed.document_id);
      page = parsed.page;
      region = parsed.region;
    }
  }
  if (!info) {
    // Cudzí nástroj: dokument podľa kódu (Identification) v adrese alebo opise.
    for (const c of identificationCandidates(url ?? "", description)) {
      info = await deps.store.findDocument(c);
      if (info) break;
    }
    if (info) page = (url ? pageFromLocation(url) : null) ?? null;
  }
  if (!info) {
    return {
      id,
      foreign: true,
      row: {
        document_id: null,
        document_ref: null,
        document_name: null,
        document_revision: null,
        page: null,
        region: null,
        markup: null,
        url: url ?? null,
        description,
        author,
        document_sha256: null,
      },
    };
  }
  let row: Omit<TopicDocumentWrite, "task_id">;
  try {
    const w: Partial<TopicDocumentWrite> = documentWrite(info, { page: page ?? undefined, region: region ?? undefined }, "", author);
    delete w.task_id;
    row = w as Omit<TopicDocumentWrite, "task_id">;
  } catch (e) {
    if (!(e instanceof TopicDocumentError)) throw e;
    // Strana mimo dokumentu: odkaz ostane na dokumente bez strany a oblasti.
    const w: Partial<TopicDocumentWrite> = documentWrite(info, {}, "", author);
    delete w.task_id;
    row = w as Omit<TopicDocumentWrite, "task_id">;
  }
  // Revízia z nášho opisu: odkaz vznikol nad staršou revíziou, nepripíše sa potichu k aktuálnej (D-158 krok 6).
  const rev = description ? REV_RE.exec(description.split(": ")[0])?.[1]?.trim() : undefined;
  const extra: Partial<TopicDocumentWrite> = {};
  if (rev && rev !== (info.revision ?? "")) {
    row = { ...row, document_revision: rev, document_sha256: null };
    extra.anchor_pages = null;
    extra.anchor_page_size = null;
  }
  return { id, foreign: false, row: { ...row, ...extra, description: stripOwnLabel(description, row) } };
}

/** Pohľady témy: pohľady odkazov na dokumenty (AIM) sú odvodené a neukladajú sa; prvý ostatný je pohľad témy. */
function splitViewpoints(topic: BCFTopic): { main: BCFViewpoint | null; rest: BCFViewpoint[] } {
  const refGuids = new Set((topic.documentReferences ?? []).map((r) => r.guid?.toLowerCase()).filter((g): g is string => !!g));
  const own = (topic.viewpoints ?? []).filter((v) => !refGuids.has(v.guid.toLowerCase()));
  const has = (v: BCFViewpoint) => v.perspectiveCamera || v.orthogonalCamera || v.clippingPlanes?.length || v.components?.selection?.length;
  const main = own.find(has) ?? own[0] ?? null;
  return { main, rest: own.filter((v) => v !== main) };
}

async function incomingFrom(
  topic: BCFTopic,
  id: string,
  deps: BcfDeps,
  author: string,
  viewpointToApi: (v: BCFViewpoint) => unknown,
): Promise<Incoming> {
  const warnings: string[] = [];
  const st = importStatus(topic.topicStatus);
  if (st.unknown) warnings.push(`Neznámy stav '${topic.topicStatus}', téma je 'open'.`);
  const { main, rest } = splitViewpoints(topic);
  let viewpoint: Record<string, unknown> | null = null;
  const selection = new Set<string>();
  if (main) {
    const dto = { ...(viewpointToApi(main) as Record<string, unknown>), guid: main.guid };
    const vp = viewpointFromDto(dto);
    viewpoint = vp.viewpoint;
    for (const g of vp.selection) selection.add(g);
  }
  for (const v of rest) for (const c of v.components?.selection ?? []) if (c.ifcGuid) selection.add(c.ifcGuid);
  if (rest.length) warnings.push(`${rest.length} ďalších pohľadov sa neuložilo (téma má jeden pohľad, D-099); ich prvky sú v téme.`);
  const refs: IncomingRef[] = [];
  for (const r of (topic.documentReferences ?? []).slice(0, MAX_TOPIC_DOCUMENTS)) {
    const ir = await referenceFromBcf(deps, r, author);
    if (ir) refs.push(ir);
    else warnings.push("Odkaz na dokument bez adresy a opisu sa vynechal.");
  }
  if ((topic.documentReferences ?? []).length > MAX_TOPIC_DOCUMENTS) warnings.push(`Odkazov na dokumenty je viac než ${MAX_TOPIC_DOCUMENTS}, zvyšok sa vynechal.`);
  const date = Date.parse(topic.modifiedDate ?? topic.creationDate ?? "");
  const created = Date.parse(topic.creationDate ?? "");
  const now = Date.now();
  return {
    id,
    fields: {
      title: clean(topic.title, 200) ?? "(bez názvu)",
      description: descriptionWithoutDocuments(clean(topic.description, 8000)),
      topic_type: clean(topic.topicType, 60) ?? "Issue",
      status: st.status,
      priority: clean(topic.priority, 60),
      assigned_to: clean(topic.assignedTo, 200),
      due_date: dateOnly(topic.dueDate),
      labels: [...new Set((topic.labels ?? []).map((l) => clean(l, 60)).filter((l): l is string => !!l))].slice(0, 20),
      stage: clean(topic.stage, 60),
    },
    author: clean(topic.creationAuthor, 200),
    modifiedBy: clean(topic.modifiedAuthor, 200),
    modifiedAt: Number.isNaN(date) ? null : date,
    createdAt: Number.isNaN(created) ? null : created,
    viewpoint,
    components: [...selection].slice(0, MAX_COMPONENTS),
    comments: (topic.comments ?? [])
      .map((c) => {
        const t = isoMs(c.date, now);
        return { author: clean(c.author, 200), comment: clean(c.comment, 8000) ?? "", ...(t !== null ? { date: iso(t) } : {}) };
      })
      .filter((c) => c.comment),
    refs,
    warnings,
  };
}

/** Rozdiely poľa po poli (normalizované: biele znaky, poradie štítkov a prvkov). */
export function fieldDiffs(db: BcfTopicRow, inc: Incoming): FieldDiff[] {
  const out: FieldDiff[] = [];
  const text = (field: keyof Incoming["fields"]) => {
    const a = norm(db[field as keyof BcfTopicRow] as string | null);
    const b = norm(inc.fields[field] as string | null);
    if (a !== b) out.push({ field, db: db[field as keyof BcfTopicRow], incoming: inc.fields[field] });
  };
  for (const f of ["title", "description", "topic_type", "priority", "assigned_to", "stage"] as const) text(f);
  if (db.status !== inc.fields.status) out.push({ field: "status", db: db.status, incoming: inc.fields.status });
  if ((db.due_date ?? null) !== inc.fields.due_date) out.push({ field: "due_date", db: db.due_date, incoming: inc.fields.due_date });
  if (!sameSet(db.labels ?? [], inc.fields.labels)) out.push({ field: "labels", db: db.labels, incoming: inc.fields.labels });
  if (inc.components.length && !sameSet(db.components ?? [], inc.components)) {
    out.push({ field: "components", db: (db.components ?? []).length, incoming: inc.components.length });
  }
  const dbVp = typeof db.viewpoint?.guid === "string" ? db.viewpoint.guid.toLowerCase() : null;
  const inVp = typeof inc.viewpoint?.guid === "string" ? inc.viewpoint.guid.toLowerCase() : null;
  if (inVp && dbVp !== inVp) out.push({ field: "viewpoint", db: dbVp, incoming: inVp });
  return out;
}

const regionKey = (r: TopicDocumentRow["region"]) => (r ? [r.x, r.y, r.width, r.height].join("_") : "");

/** Existujúci odkaz zodpovedajúci prichádzajúcemu: podľa guid, inak podľa dokumentu+strany+oblasti, alebo url. */
function matchRef(existing: TopicDocumentRow[], inc: IncomingRef): TopicDocumentRow | undefined {
  if (inc.id) {
    const byId = existing.find((e) => e.id === inc.id);
    if (byId) return byId;
  }
  return existing.find((e) =>
    inc.row.document_id
      ? e.document_id === inc.row.document_id && (e.page ?? null) === (inc.row.page ?? null) && regionKey(e.region) === regionKey(inc.row.region)
      : !e.document_id && !!inc.row.url && e.url === inc.row.url,
  );
}

/** Zmena existujúceho odkazu (značky `markup` sa nikdy nemenia: BCF ich nenesie). */
function refPatch(e: TopicDocumentRow, inc: IncomingRef): Partial<TopicDocumentWrite> {
  const patch: Partial<TopicDocumentWrite> = {};
  if (norm(e.description) !== norm(inc.row.description)) patch.description = inc.row.description;
  if (inc.id && inc.row.document_id && e.document_id === inc.row.document_id) {
    if ((e.page ?? null) !== (inc.row.page ?? null)) patch.page = inc.row.page;
    if (regionKey(e.region) !== regionKey(inc.row.region)) patch.region = inc.row.region;
  }
  return patch;
}

const commentKey = (author: string | null, comment: string) => `${norm(author).toLowerCase()}\u0000${norm(comment)}`;

async function importTopic(topic: BCFTopic, deps: BcfDeps, opts: Required<Pick<ImportOptions, "conflict" | "author">> & ImportOptions, lib: Lib): Promise<TopicOutcome> {
  const title = clean(topic.title, 200) ?? "(bez názvu)";
  const id = topicIdFromGuid(topic.guid ?? "", lib.ifcGuidToUuid, lib.isValidIfcGuid);
  if (!id) return { guid: topic.guid ?? "", title, result: "skipped", reason: "guid témy nie je UUID ani IFC GUID, nedá sa uložiť bez zmeny identity" };
  const inc = await incomingFrom(topic, id, deps, opts.author, lib.viewpointToApi);
  const warnings = inc.warnings;
  const existing = await deps.store.get({ id });
  const dry = opts.dryRun === true;
  const foreign = inc.refs.filter((r) => r.foreign).length;

  if (!existing) {
    const comments = dedupeComments(inc.comments, []);
    let number: number | undefined;
    if (!dry) {
      const author = inc.author ?? opts.author;
      // Pôvodné dátumy témy: vznik = creation_date (bez neho dátum zmeny), zmena = modified_date (nie skôr než vznik).
      const now = Date.now();
      const createdMs = inc.createdAt !== null ? Math.min(inc.createdAt, now) : inc.modifiedAt !== null ? Math.min(inc.modifiedAt, now) : null;
      const updatedMs = createdMs === null ? null : Math.max(createdMs, inc.modifiedAt !== null ? Math.min(inc.modifiedAt, now) : createdMs);
      const row = await deps.store.create({
        id,
        ...inc.fields,
        model: opts.model ?? null,
        author,
        modified_by: inc.modifiedBy ?? author,
        components: inc.components,
        viewpoint: inc.viewpoint,
        ...(createdMs !== null && updatedMs !== null ? { created_at: iso(createdMs), updated_at: iso(updatedMs) } : {}),
      });
      number = row.number;
      for (const r of inc.refs) await deps.store.addDocument({ ...r.row, ...(r.id ? { id: r.id } : {}), task_id: row.id });
      for (const c of comments) await deps.store.addComment(row.id, c.author ?? author, c.comment, c.date);
      // Komentár bez novej funkcie v DB posunie updated_at a modified_by na čas zápisu: vráť ich na hodnoty zo súboru.
      if (comments.length && updatedMs !== null) await deps.store.update(row.id, { updated_at: iso(updatedMs), modified_by: inc.modifiedBy ?? author });
    }
    return {
      guid: id,
      ...(number !== undefined ? { number } : {}),
      title,
      result: "created",
      changes: ["nová téma"],
      comments_added: comments.length,
      documents_added: inc.refs.length,
      documents_foreign: foreign,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  const docs = await deps.store.documents([id]);
  const newComments = dedupeComments(inc.comments, existing.comments ?? []);
  const toAdd = inc.refs.filter((r) => !matchRef(docs, r));
  const toPatch = inc.refs.flatMap((r) => {
    const e = matchRef(docs, r);
    const patch = e ? refPatch(e, r) : {};
    return e && Object.keys(patch).length ? [{ e, patch }] : [];
  });
  const room = MAX_TOPIC_DOCUMENTS - docs.length;
  if (toAdd.length > Math.max(room, 0)) warnings.push(`Téma má už ${docs.length} odkazov, ${toAdd.length - Math.max(room, 0)} sa nepridalo (strop ${MAX_TOPIC_DOCUMENTS}).`);
  const adding = toAdd.slice(0, Math.max(room, 0));
  const diffs = fieldDiffs(existing, inc);
  const refDiffs: FieldDiff[] = toPatch.map(({ e, patch }) => ({ field: `document:${e.id.slice(0, 8)}`, db: pickKeys(e, patch), incoming: patch }));
  const allDiffs = [...diffs, ...refDiffs];
  const base = { guid: id, number: existing.number, title: existing.title, ...(warnings.length ? { warnings } : {}) };
  if (allDiffs.length === 0 && newComments.length === 0 && adding.length === 0) return { ...base, result: "unchanged" };

  if (allDiffs.length > 0 && opts.conflict !== "overwrite") {
    const newer = inc.modifiedAt !== null && inc.modifiedAt > Date.parse(existing.updated_at);
    if (!newer) {
      return {
        ...base,
        result: "conflict",
        conflicts: allDiffs,
        reason:
          inc.modifiedAt === null
            ? "súbor nemá dátum zmeny a téma v DB sa líši"
            : "téma v DB je novšia než súbor a líši sa; nič sa nezapísalo (conflict=overwrite ju prepíše súborom)",
      };
    }
  }

  const changes = [...allDiffs.map((d) => d.field), ...(newComments.length ? [`+${newComments.length} komentárov`] : []), ...(adding.length ? [`+${adding.length} odkazov`] : [])];
  if (!dry) {
    const patch: BcfTopicWrite = {};
    for (const d of diffs) {
      if (d.field === "components") patch.components = inc.components;
      else if (d.field === "viewpoint") patch.viewpoint = inc.viewpoint;
      else (patch as Record<string, unknown>)[d.field] = (inc.fields as Record<string, unknown>)[d.field];
    }
    for (const { e, patch: p } of toPatch) await deps.store.updateDocument(id, e.id, p);
    for (const r of adding) await deps.store.addDocument({ ...r.row, ...(r.id ? { id: r.id } : {}), task_id: id });
    for (const c of newComments) await deps.store.addComment(id, c.author ?? opts.author, c.comment, c.date);
    // Jedna úprava témy nakoniec. updated_at: novší dátum zmeny zo súboru; inak zmena polí = teraz (zapísali sme ju),
    // len komentáre a odkazy ho nechajú, ako bol (komentár bez novej funkcie v DB by ho posunul na čas zápisu).
    if (Object.keys(patch).length || toPatch.length || newComments.length) {
      patch.modified_by = inc.modifiedBy ?? opts.author;
      const stamp = inc.modifiedAt !== null ? Math.min(inc.modifiedAt, Date.now()) : null;
      if (stamp !== null && stamp > Date.parse(existing.updated_at)) patch.updated_at = iso(stamp);
      else if (diffs.length === 0) patch.updated_at = existing.updated_at;
      await deps.store.update(id, patch);
    }
  }
  return {
    ...base,
    result: "updated",
    changes,
    comments_added: newComments.length,
    documents_added: adding.length,
    documents_updated: toPatch.length,
    documents_foreign: foreign,
  };
}

function pickKeys(e: TopicDocumentRow, patch: Partial<TopicDocumentWrite>) {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, (e as unknown as Record<string, unknown>)[k]]));
}

function dedupeComments(incoming: IncomingComment[], existing: { author: string | null; comment: string }[]) {
  const seen = new Set(existing.map((c) => commentKey(c.author, c.comment)));
  const out: IncomingComment[] = [];
  for (const c of incoming) {
    const k = commentKey(c.author, c.comment);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

interface Lib {
  ifcGuidToUuid: (g: string) => string;
  isValidIfcGuid: (g: string) => boolean;
  viewpointToApi: (v: BCFViewpoint) => unknown;
}

/** Importuje už prečítaný projekt BCF (testy a `importBcfArchive`). */
export async function importBcfProject(project: BCFProject, deps: BcfDeps, options: ImportOptions = {}, warnings: string[] = []): Promise<ImportSummary> {
  const [{ ifcGuidToUuid, isValidIfcGuid }, { viewpointToApi }] = await Promise.all([import("@ifc-lite/bcf"), import("@ifc-lite/bcf-api")]);
  const lib: Lib = { ifcGuidToUuid, isValidIfcGuid, viewpointToApi };
  const opts = { ...options, conflict: options.conflict ?? ("keep" as const), author: options.author?.trim() || DEFAULT_AUTHOR };
  const all = [...project.topics.values()];
  const wanted = options.guids?.length ? new Set(options.guids.map((g) => g.trim().toLowerCase())) : null;
  const chosen = wanted ? all.filter((t) => wanted.has((t.guid ?? "").toLowerCase())) : all;
  const topics: TopicOutcome[] = [];
  if (chosen.length > MAX_IMPORT_TOPICS) warnings.push(`Súbor má ${chosen.length} tém, importuje sa prvých ${MAX_IMPORT_TOPICS}; zvyšok importuj znova s guids.`);
  for (const t of chosen.slice(0, MAX_IMPORT_TOPICS)) {
    try {
      topics.push(await importTopic(t, deps, opts, lib));
    } catch (e) {
      topics.push({ guid: t.guid ?? "", title: clean(t.title, 200) ?? "", result: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const n = (r: ImportResult) => topics.filter((t) => t.result === r).length;
  return {
    dry_run: options.dryRun === true,
    bcf_version: project.version,
    topics_in_file: all.length,
    created: n("created"),
    updated: n("updated"),
    unchanged: n("unchanged"),
    conflicts: n("conflict"),
    skipped: n("skipped"),
    failed: n("failed"),
    topics,
    warnings,
  };
}

/** `.bcfzip` (bajty) -> import; chyba archívu je `BcfInputError`. */
export async function importBcfArchive(bytes: Uint8Array, deps: BcfDeps, options: ImportOptions = {}): Promise<ImportSummary> {
  if (bytes.byteLength === 0) throw new BcfInputError("Súbor je prázdny.");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new BcfInputError(`Súbor je väčší než ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`);
  const { readBCF } = await import("@ifc-lite/bcf");
  const warnings: string[] = [];
  let project: BCFProject;
  try {
    project = await readBCF(bytes, {
      maxArchiveBytes: MAX_ARCHIVE_BYTES,
      maxExpandedBytes: MAX_EXPANDED_BYTES,
      maxEntries: MAX_ENTRIES,
      onWarning: (m) => {
        if (warnings.length < 20) warnings.push(m);
      },
    });
  } catch (e) {
    throw new BcfInputError(`Súbor nie je platný .bcfzip: ${e instanceof Error ? e.message : String(e)}`);
  }
  return importBcfProject(project, deps, options, warnings);
}
