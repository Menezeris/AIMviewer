import type { IdsEngine } from "./engine";
import { resultRows, type ReportSpec } from "./runs";
import { text } from "./tools";
import type { IdsDocumentRow, IdsStore, IdsVersionMeta } from "./types";

/**
  * Requirements library in AIM (D-182, #351; addendum V30): a catalog of IDS that a library release wrote into AIM in the DB
  * (schema `library`, immutable versions `source = import`), assignment to a project = a manual link of the IDS to a federation model, and saving a check run from the viewer with a stamp of the
  * model revision, the IDS version and the tool version. The check runs once, in the viewer; the server does not repeat it.
 *
  * IDS writes go through `IdsStore` (D-162), links, revisions and per-model runs through `IdsLibraryStore`.
 */

export class LibraryInputError extends Error {}

/** Migration D-182 (`supabase/migrations/20261102120000_ids_library_assign.sql`) is not applied yet. */
export class LibrarySchemaMissingError extends Error {
  constructor(what: string) {
    super(`${what}: v DB chýba migrácia D-182 (supabase/migrations/20261102120000_ids_library_assign.sql), čaká na nasadenie.`);
  }
}

export interface IfcContainer {
  id: string;
  model: string;
  identification: string;
  name: string | null;
}

export interface ModelBinding {
  document_id: string;
  information_container_id: string;
  model: string;
  library_container: string | null;
  created_by: string;
  valid_from: string;
}

/** Latest IDS run on a model (any document version). */
export interface ModelRun {
  id: string;
  document_id: string;
  version: number;
  model_label: string;
  checked_at: string;
  specs_total: number;
  specs_passed: number;
  results_total: number;
  results_failed: number;
  engine: string;
  engine_version: string | null;
  trigger: string;
  created_by: string | null;
  model_revisions: Record<string, number>;
}

export interface IdsLibraryStore {
    /** Code change (rename in the library) and the last origin of the document; the code is unique (D-162). */
  updateDocument(id: string, patch: { code?: string; library_source?: string }): Promise<void>;
    /** Federation models (IFC containers, D-183 K1). */
  containers(): Promise<IfcContainer[]>;
    /** Active links of the IDS to models; null = migration D-182 is not applied. */
  models(documentIds: string[]): Promise<ModelBinding[] | null>;
  bindModel(row: { document_id: string; information_container_id: string; created_by: string; library_container: string | null }): Promise<void>;
    /** Closes an active link; false = there was none. */
  endModel(documentId: string, containerId: string, endedBy: string): Promise<boolean>;
    /** Current model revisions {model: revision} (`model_revisions.is_current`). */
  currentRevisions(): Promise<Record<string, number>>;
  revisionExists(model: string, revision: number): Promise<boolean>;
    /** Latest run on every model for the given documents. */
  lastRunsByModel(documentIds: string[]): Promise<ModelRun[]>;
}

export interface LibraryDeps {
  store: IdsStore;
  lib: IdsLibraryStore;
  engine?: () => Promise<IdsEngine>;
}

/** Who assigned / saved: the name from the viewer dialog (Samuel 2. 11.: the name in the dialog is enough). */
export function authorOf(raw: unknown): string {
  const name = text(raw, 120);
  if (!name) throw new LibraryInputError("Chýba meno (kto priraďuje alebo ukladá).");
  return name;
}

// ------------------------------------------------------------------------------------------------
// Library catalog (from the DB, D-182 addendum V30)
// ------------------------------------------------------------------------------------------------

/**
  * Origin of a version from a library release in the DB: `library_repo = db:library/<library code>`,
  * `library_commit = <release>@<manifest sha256>` (not a git SHA). Written by the library release (schema `library`,
  * `library.vydanie_ids`), AIM only reads it.
 */
export const DB_LIBRARY_PREFIX = "db:library/";

export interface LibraryRelease {
    /** Library code (`library.kniznica.kod`), e.g. `assetin`. */
  library: string | null;
    /** Release code, e.g. `2026.11.1`. */
  release: string | null;
  manifest_sha256: string | null;
}

export function parseLibraryOrigin(repo: string | null | undefined, commit: string | null | undefined): LibraryRelease {
  const library = repo?.startsWith(DB_LIBRARY_PREFIX) ? repo.slice(DB_LIBRARY_PREFIX.length) || null : null;
  const at = commit ? commit.lastIndexOf("@") : -1;
  const release = commit ? (at > 0 ? commit.slice(0, at) : commit) : null;
  const manifest = at > 0 && commit ? commit.slice(at + 1) : null;
  return { library, release, manifest_sha256: manifest && /^[0-9a-f]{64}$/.test(manifest) ? manifest : null };
}

export type LibraryItemState = "not_assigned" | "assigned";

export interface LibraryItem {
    /** Path of the ER note in the library (`library_path`); the card row key. */
  path: string;
  code: string;
  sha256: string;
    /** The XML size is not in the version meta; the card does not show it. */
  size: number;
    /** Release that wrote the version (the `last_change` shape stays because of the card in the fork). */
  last_change: { sha: string; date: string | null; author: string | null; message: string | null } | null;
  title: string | null;
  ids_version: string | null;
  specs: Array<{ identifier: string | null; name: string }>;
    /** `assigned` = the IDS has at least one active link to a project model (`ids_document_models`). */
  state: LibraryItemState;
  aim: { code: string; version: number | null; origin: string };
  release: LibraryRelease;
  models: string[];
    /** Summary of release diagnostics for this IDS (from `audit`), e.g. {E: 0, W: 14, I: 26}. */
  diagnostics: Record<string, number> | null;
}

export interface LibraryCatalog {
  repo: string;
  ref: string;
  dir: string;
    /** Origin of the latest version (`<release>@<manifest sha256>`), not a git SHA. */
  commit: string;
  commit_date: string | null;
  truncated: boolean;
  items: LibraryItem[];
  note?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Specifications from the release audit: `"IU-O-space (IU-O, IfcSpace)"` -> the identifier before the parenthesis. */
function specsOfAudit(audit: Record<string, unknown> | null): LibraryItem["specs"] {
  const list = isObj(audit) && Array.isArray(audit.specifikacie) ? audit.specifikacie : [];
  return list
    .filter((s): s is string => typeof s === "string")
    .map((s) => {
      const m = /^(\S+) \((.*)\)$/.exec(s);
      return { identifier: m ? m[1] : null, name: s };
    });
}

function diagnosticsOfAudit(audit: Record<string, unknown> | null): Record<string, number> | null {
  const d = isObj(audit) && isObj(audit.diagnostiky) ? audit.diagnostiky : null;
  if (!d) return null;
  return Object.fromEntries(Object.entries(d).filter((e): e is [string, number] => typeof e[1] === "number"));
}

/** Library IDS in AIM (`origin = library`, `status = active`) with the latest version from the library release in the DB. */
async function libraryDocuments(deps: LibraryDeps) {
  const docs = (await deps.store.listDocuments()).filter((d) => d.origin === "library" && d.status === "active");
  const latest = await deps.store.latestVersions(docs.map((d) => d.id));
  return docs
    .map((doc) => ({ doc, latest: latest.get(doc.id) }))
    .filter((x): x is { doc: IdsDocumentRow; latest: IdsVersionMeta } => !!x.latest && x.latest.source === "import" && !!x.latest.library_repo?.startsWith(DB_LIBRARY_PREFIX));
}

/**
  * "V knižnici" (in the library) catalog: IDS that a library release wrote into AIM (immutable versions, `source = import`).
  * The library repo and GitHub are not read. Assignment to a project = a link to a model (`ids_document_models`).
 */
export async function libraryCatalog(deps: LibraryDeps): Promise<LibraryCatalog> {
  const rows = await libraryDocuments(deps);
  const bindings = (await deps.lib.models(rows.map((r) => r.doc.id))) ?? [];
  const items: LibraryItem[] = rows
    .map(({ doc, latest }) => {
      const models = bindings.filter((b) => b.document_id === doc.id).map((b) => b.model);
      return {
        path: latest.library_path ?? doc.code,
        code: doc.code,
        sha256: latest.sha256,
        size: 0,
        last_change: latest.library_commit ? { sha: latest.library_commit, date: latest.created_at, author: latest.author, message: latest.note } : null,
        title: doc.title || null,
        ids_version: latest.ids_version,
        specs: specsOfAudit(latest.audit),
        state: (models.length > 0 ? "assigned" : "not_assigned") as LibraryItemState,
        aim: { code: doc.code, version: latest.version, origin: doc.origin },
        release: parseLibraryOrigin(latest.library_repo, latest.library_commit),
        models,
        diagnostics: diagnosticsOfAudit(latest.audit),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const newest = rows.map((r) => r.latest).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const rel = parseLibraryOrigin(newest?.library_repo, newest?.library_commit);
  return {
    repo: newest?.library_repo ?? `${DB_LIBRARY_PREFIX}?`,
    ref: rel.release ?? "",
    dir: "zadanie",
    commit: newest?.library_commit ?? "",
    commit_date: newest?.created_at ?? null,
    truncated: false,
    items,
    ...(items.length === 0 ? { note: "V AIM zatiaľ nie je žiadne IDS z vydania knižnice (ids_documents origin = library, status = active)." } : {}),
  };
}

// ------------------------------------------------------------------------------------------------
// IDS v projekte
// ------------------------------------------------------------------------------------------------

export interface ProjectItem {
  code: string;
  title: string;
  origin: string;
  status: string;
  derived_from: { code: string; version: number; newer_exists: boolean } | null;
  versions: Array<{
    version: number;
    sha256: string;
    ids_version: string | null;
    author: string | null;
    source: string;
    created_at: string;
    library_path: string | null;
    library_commit: string | null;
    library_code: string | null;
  }>;
  models: Array<{ model: string; library_container: string | null; created_by: string; valid_from: string }>;
  runs: Array<{
    model: string;
    version: number;
    checked_at: string;
    specs: string;
    results_failed: number;
    engine: string;
    engine_version: string | null;
    trigger: string;
    created_by: string | null;
    based_on: Record<string, number>;
        /** Model is at a newer revision (null = the run's revision is unknown). */
    stale: boolean | null;
        /** The IDS has a newer version in AIM than the one the run was made over. */
    ids_stale: boolean;
  }>;
}

export interface ProjectCatalog {
  items: ProjectItem[];
  containers: Array<{ model: string; identification: string; name: string | null }>;
  current_revisions: Record<string, number>;
    /** Migration D-182 is not applied: links and version origins are missing. */
  schema_missing?: boolean;
}

function revisionsStale(basedOn: Record<string, number>, current: Record<string, number>): boolean | null {
  const keys = Object.keys(basedOn);
  if (keys.length === 0) return null;
  return keys.some((k) => current[k] !== basedOn[k]);
}

export async function projectCatalog(deps: LibraryDeps): Promise<ProjectCatalog> {
  const docs = (await deps.store.listDocuments()).filter((d) => d.status !== "archived");
  const ids = docs.map((d) => d.id);
  const [containers, models, runs, current, latest] = await Promise.all([
    deps.lib.containers(),
    deps.lib.models(ids),
    deps.lib.lastRunsByModel(ids),
    deps.lib.currentRevisions(),
    deps.store.latestVersions(ids),
  ]);
  const items: ProjectItem[] = [];
  for (const d of docs) {
    const versions = await deps.store.versions(d.id);
    let derived: ProjectItem["derived_from"] = null;
    if (d.derived_from) {
      const v = await deps.store.versionById(d.derived_from);
      const src = v ? await deps.store.byId(v.document_id) : null;
      if (v && src) derived = { code: src.code, version: v.version, newer_exists: (latest.get(src.id)?.version ?? v.version) > v.version };
    }
    const latestNo = latest.get(d.id)?.version ?? 0;
    items.push({
      code: d.code,
      title: d.title,
      origin: d.origin,
      status: d.status,
      derived_from: derived,
      versions: versions.map((v) => ({
        version: v.version,
        sha256: v.sha256,
        ids_version: v.ids_version,
        author: v.author,
        source: v.source,
        created_at: v.created_at,
        library_path: v.library_path ?? null,
        library_commit: v.library_commit ?? null,
        library_code: v.library_code ?? null,
      })),
      models: (models ?? [])
        .filter((m) => m.document_id === d.id)
        .map((m) => ({ model: m.model, library_container: m.library_container, created_by: m.created_by, valid_from: m.valid_from })),
      runs: runs
        .filter((r) => r.document_id === d.id)
        .map((r) => ({
          model: r.model_label,
          version: r.version,
          checked_at: r.checked_at,
          specs: `${r.specs_passed}/${r.specs_total}`,
          results_failed: r.results_failed,
          engine: r.engine,
          engine_version: r.engine_version,
          trigger: r.trigger,
          created_by: r.created_by,
          based_on: r.model_revisions,
          stale: revisionsStale(r.model_revisions, current),
          ids_stale: r.version < latestNo,
        })),
    });
  }
  return {
    items,
    containers: containers.map((c) => ({ model: c.model, identification: c.identification, name: c.name })),
    current_revisions: current,
    ...(models === null ? { schema_missing: true } : {}),
  };
}

// ------------------------------------------------------------------------------------------------
// Assignment to a project (= link to a model)
// ------------------------------------------------------------------------------------------------

export interface AssignInput {
    /** `path` or a code from the catalog. */
  path: string;
    /** Origin of the version that the card showed (`<release>@<manifest sha256>`). */
  commit: string;
    /** Sha256 of the version that the card showed; a different latest version = refresh the catalog. */
  sha256: string;
  author: string;
    /** Federation model; without it the card says where the link is made. */
  model?: string;
}

export type AssignOutcome = { status: "created" | "unchanged"; code: string; version: number; model: string };

/**
  * "Priradiť k projektu" (assign to project): the IDS is in AIM since the library release, assignment is a link of the IDS to a federation model
  * (`ids_document_models`, manual, D-182 point 5). Verifies that the card showed the latest version.
 */
export async function assignFromLibrary(deps: LibraryDeps, input: AssignInput): Promise<AssignOutcome> {
  const author = authorOf(input.author);
  const rows = await libraryDocuments(deps);
  const hit = rows.find((r) => r.latest.library_path === input.path) ?? rows.find((r) => r.doc.code === input.path);
  if (!hit) throw new LibraryInputError(`'${input.path}' nie je medzi IDS z vydania knižnice v AIM; obnov knižnicu.`);
  if (hit.latest.sha256 !== input.sha256 || (hit.latest.library_commit ?? "") !== input.commit) {
    throw new LibraryInputError(`IDS ${hit.doc.code} má v AIM inú poslednú verziu (v${hit.latest.version}), než karta ukázala; obnov knižnicu.`);
  }
  const model = text(input.model, 80);
  if (!model) {
    throw new LibraryInputError(
      `IDS ${hit.doc.code} v${hit.latest.version} je v AIM z vydania knižnice. K projektu ho priradíš väzbou na model: v časti "V projekte" zaškrtni model pri ${hit.doc.code}.`,
    );
  }
  const out = await setModelBinding(deps, { code: hit.doc.code, model, bound: true, author });
  return { status: out.changed ? "created" : "unchanged", code: hit.doc.code, version: hit.latest.version, model: out.model };
}

// ------------------------------------------------------------------------------------------------
// Link IDS <-> model (manual)
// ------------------------------------------------------------------------------------------------

export interface ModelBindInput {
  code: string;
  model: string;
  bound: boolean;
  author: string;
  library_container?: string;
}

export async function setModelBinding(deps: LibraryDeps, input: ModelBindInput) {
  const author = authorOf(input.author);
  const doc = await deps.store.byCode(String(input.code ?? ""));
  if (!doc) throw new LibraryInputError(`IDS '${input.code}' v AIM neexistuje.`);
  const containers = await deps.lib.containers();
  const c = containers.find((x) => x.model === input.model);
  if (!c) throw new LibraryInputError(`Model '${input.model}' nie je v AIM (modely: ${containers.map((x) => x.model).join(", ") || "žiadne"}).`);
  const active = await deps.lib.models([doc.id]);
  if (active === null) throw new LibrarySchemaMissingError("Väzba IDS na model");
  const has = active.some((m) => m.information_container_id === c.id);
  if (input.bound) {
    if (has) return { code: doc.code, model: c.model, bound: true, changed: false };
    await deps.lib.bindModel({ document_id: doc.id, information_container_id: c.id, created_by: author, library_container: text(input.library_container, 80) ?? null });
    return { code: doc.code, model: c.model, bound: true, changed: true };
  }
  const ended = has ? await deps.lib.endModel(doc.id, c.id, author) : false;
  return { code: doc.code, model: c.model, bound: false, changed: ended };
}

// ------------------------------------------------------------------------------------------------
// Saving a run from the viewer
// ------------------------------------------------------------------------------------------------

/** Cap of rows element x specification (the same as `ifc_ids_validate save`). */
export const MAX_VIEWER_RUN_RESULTS = 50_000;

export interface ViewerRunInput {
  code: string;
  version: number;
  ids_sha256: string;
  model: string;
  revision: number | null;
  engine_version: string;
  author: string;
    /** Results per specification in the shape of the `@ifc-lite/ids` report (`specificationResults`). */
  specs: ReportSpec[];
}

export interface ViewerRunDeps extends LibraryDeps {
    /** IFC GlobalId -> objects.id (active GUID, D-010). */
  lookup: (guids: string[]) => Promise<Map<string, { object_id: string }>>;
}

export async function saveViewerRun(deps: ViewerRunDeps, input: ViewerRunInput) {
  const author = authorOf(input.author);
  const doc = await deps.store.byCode(String(input.code ?? ""));
  if (!doc) throw new LibraryInputError(`IDS '${input.code}' v AIM neexistuje; výsledok sa ukladá len pre IDS v AIM.`);
  if (!Number.isInteger(input.version) || input.version < 1) throw new LibraryInputError("version: celé číslo od 1.");
  const ver = await deps.store.version(doc.id, input.version);
  if (!ver) throw new LibraryInputError(`IDS '${doc.code}' nemá verziu ${input.version}.`);
  if (ver.sha256 !== input.ids_sha256) {
    throw new LibraryInputError(`IDS vo vieweri nie je verzia v${ver.version} z AIM (iný obsah). Ulož úpravu ako pracovnú kópiu a kontrolu spusti znova.`);
  }
  const model = text(input.model, 80);
  if (!model) throw new LibraryInputError("Chýba model, nad ktorým kontrola bežala.");
  if (input.revision === null || !Number.isInteger(input.revision) || input.revision < 0) {
    throw new LibraryInputError(`Revízia modelu ${model} vo vieweri nie je známa; výsledok bez revízie sa neukladá (D-183 bod 11).`);
  }
  if (!(await deps.lib.revisionExists(model, input.revision))) {
    throw new LibraryInputError(`Model ${model} nemá v AIM revíziu v${input.revision}; výsledok sa neuložil.`);
  }
  const engineVersion = text(input.engine_version, 120);
  if (!engineVersion) throw new LibraryInputError("Chýba verzia nástroja (engine_version).");
  if (!Array.isArray(input.specs) || input.specs.length === 0) throw new LibraryInputError("Beh nemá žiadne špecifikácie.");

  const guids = [...new Set(input.specs.flatMap((s) => (s.entityResults ?? []).map((x) => x.globalId ?? "")).filter(Boolean))];
  const refs = guids.length > 0 ? await deps.lookup(guids) : new Map<string, { object_id: string }>();
  const rows = resultRows(input.specs, (g) => refs.get(g)?.object_id ?? null);
  if (rows.length > MAX_VIEWER_RUN_RESULTS) throw new LibraryInputError(`Beh má ${rows.length} výsledkov (strop ${MAX_VIEWER_RUN_RESULTS}); neuložil sa.`);
  const failed = rows.filter((r) => r.status === "fail").length;
  const current = await deps.lib.currentRevisions();
  const runId = await deps.store.saveRun(
    {
      ids_title: doc.title,
      ids_version: ver.ids_version,
      ids_sha256: ver.sha256,
      ids_source: doc.library_source ?? `aim:${doc.code}@v${ver.version}`,
      ids_version_id: ver.id,
      model_label: model,
      model_file: null,
      specs_total: input.specs.length,
      specs_passed: input.specs.filter((s) => s.status === "pass").length,
      results_total: rows.length,
      results_failed: failed,
      engine: "ifc-lite",
      trigger: "viewer",
      engine_version: engineVersion,
      created_by: author,
      model_revisions: { [model]: input.revision },
    },
    rows,
  );
  const latest = (await deps.store.latestVersions([doc.id])).get(doc.id)?.version ?? ver.version;
  const oldRevision = current[model] !== undefined && current[model] !== input.revision;
  return {
    run_id: runId,
    code: doc.code,
    version: ver.version,
    model,
    revision: input.revision,
    results: rows.length,
    results_failed: failed,
    stale: oldRevision,
    ids_stale: latest > ver.version,
    ...(oldRevision ? { warning: `Výsledok je uložený k revízii v${input.revision}, aktuálna je v${current[model]} (zastaraný).` } : {}),
  };
}

/** Shape of the results from the viewer (subset of the `@ifc-lite/ids` report) after verification; texts trimmed. */
export function parseRunSpecs(raw: unknown): ReportSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const out: ReportSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const sp = (o.specification && typeof o.specification === "object" ? o.specification : {}) as Record<string, unknown>;
    if (o.entityResults !== undefined && !Array.isArray(o.entityResults)) return null;
    const entities = ((o.entityResults as unknown[] | undefined) ?? []).map((e) => {
      const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      const reqs = Array.isArray(x.requirementResults) ? (x.requirementResults as unknown[]) : [];
      return {
        globalId: s(x.globalId, 64),
        entityType: s(x.entityType, 80),
        passed: x.passed === true ? true : x.passed === false ? false : undefined,
        requirementResults: reqs.map((r) => {
          const rr = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          return { status: s(rr.status, 20), failureReason: s(rr.failureReason, 1000) };
        }),
      };
    });
    out.push({
      specification: {
        id: s(sp.id, 200),
        identifier: s(sp.identifier, 200),
        name: s(sp.name, 500),
        description: s(sp.description, 2000),
        instructions: s(sp.instructions, 2000),
      },
      status: s(o.status, 20),
      applicableCount: typeof o.applicableCount === "number" ? o.applicableCount : undefined,
      entityResults: entities,
    });
  }
  return out;
}
