import { defaultIdsEngine, type IdsEngine } from "./engine";
import { codeOfPath, type LibraryChange, type LibrarySource } from "./library-source";
import { resultRows, type ReportSpec } from "./runs";
import { auditXml, CODE_RE, readXml, sha256, text, type Engine } from "./tools";
import type { IdsDocumentRow, IdsStore, IdsVersionMeta } from "./types";

/**
 * Knižnica požiadaviek v AIM (D-182, #351): katalóg hotových IDS v knižnici, vedomé priradenie k projektu
 * (nemenná kópia s pôvodom), ručná väzba IDS na model federácie a uloženie behu kontroly z viewera s pečiatkou
 * revízie modelu, verzie IDS a verzie nástroja. Kontrola beží raz, vo vieweri; server ju neopakuje.
 *
 * Zápis IDS ide cez `IdsStore` (D-162), väzby, revízie a behy po modeloch cez `IdsLibraryStore`.
 */

export class LibraryInputError extends Error {}

/** Migrácia D-182 (`supabase/pending/20261102120000_ids_library_assign.sql`) ešte nie je aplikovaná. */
export class LibrarySchemaMissingError extends Error {
  constructor(what: string) {
    super(`${what}: v DB chýba migrácia D-182 (supabase/pending/20261102120000_ids_library_assign.sql), čaká na nasadenie.`);
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

/** Posledný beh IDS na modeli (ktorákoľvek verzia dokumentu). */
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
  /** Zmena kódu (premenovanie v knižnici) a posledného pôvodu dokumentu; kód je unikátny (D-162). */
  updateDocument(id: string, patch: { code?: string; library_source?: string }): Promise<void>;
  /** Modely federácie (IFC kontajnery, D-183 K1). */
  containers(): Promise<IfcContainer[]>;
  /** Aktívne väzby IDS na modely; null = migrácia D-182 nie je aplikovaná. */
  models(documentIds: string[]): Promise<ModelBinding[] | null>;
  bindModel(row: { document_id: string; information_container_id: string; created_by: string; library_container: string | null }): Promise<void>;
  /** Ukončí aktívnu väzbu; false = nebola. */
  endModel(documentId: string, containerId: string, endedBy: string): Promise<boolean>;
  /** Aktuálne revízie modelov {model: revízia} (`model_revisions.is_current`). */
  currentRevisions(): Promise<Record<string, number>>;
  revisionExists(model: string, revision: number): Promise<boolean>;
  /** Posledný beh na každom modeli pre dané dokumenty. */
  lastRunsByModel(documentIds: string[]): Promise<ModelRun[]>;
}

export interface LibraryDeps {
  store: IdsStore;
  lib: IdsLibraryStore;
  engine?: () => Promise<IdsEngine>;
}

const engineOf = async (deps: LibraryDeps): Promise<Engine> => ({ engine: deps.engine ? await deps.engine() : await defaultIdsEngine() });

/** Kto priradil / uložil: meno z dialógu viewera (Samuel 2. 11.: meno v dialógu stačí). */
export function authorOf(raw: unknown): string {
  const name = text(raw, 120);
  if (!name) throw new LibraryInputError("Chýba meno (kto priraďuje alebo ukladá).");
  return name;
}

// ------------------------------------------------------------------------------------------------
// Katalóg knižnice
// ------------------------------------------------------------------------------------------------

export type LibraryItemState = "not_assigned" | "assigned" | "differs" | "collision" | "invalid";

export interface LibraryItem {
  path: string;
  code: string;
  sha256: string | null;
  size: number;
  last_change: LibraryChange | null;
  title: string | null;
  ids_version: string | null;
  specs: Array<{ identifier: string | null; name: string }>;
  state: LibraryItemState;
  /** IDS v AIM, ku ktorému súbor patrí (rovnaká cesta v knižnici, inak rovnaký kód). */
  aim?: { code: string; version: number | null; origin: string };
  error?: string;
}

export interface LibraryCatalog {
  repo: string;
  ref: string;
  dir: string;
  commit: string;
  commit_date: string | null;
  truncated: boolean;
  items: LibraryItem[];
  /** Prázdny priečinok: karta povie, že knižnica zatiaľ nemá hotové IDS. */
  note?: string;
}

/** Opis IDS podľa sha256 obsahu (obsah sa pod rovnakým sha nemení). */
const described = new Map<string, { title: string; version: string | null; specs: LibraryItem["specs"] }>();

interface AimIndex {
  byPath: Map<string, { doc: IdsDocumentRow; latest: IdsVersionMeta | undefined }>;
  byCode: Map<string, { doc: IdsDocumentRow; latest: IdsVersionMeta | undefined }>;
}

async function aimIndex(store: IdsStore): Promise<AimIndex> {
  const docs = await store.listDocuments();
  const latest = await store.latestVersions(docs.map((d) => d.id));
  const byPath = new Map<string, { doc: IdsDocumentRow; latest: IdsVersionMeta | undefined }>();
  const byCode = new Map<string, { doc: IdsDocumentRow; latest: IdsVersionMeta | undefined }>();
  for (const doc of docs) {
    const entry = { doc, latest: latest.get(doc.id) };
    byCode.set(doc.code, entry);
    const path = entry.latest?.library_path;
    if (doc.origin === "library" && path && !byPath.has(path)) byPath.set(path, entry);
  }
  return { byPath, byCode };
}

function stateOf(code: string, path: string, hash: string, index: AimIndex): Pick<LibraryItem, "state" | "aim"> {
  const hit = index.byPath.get(path) ?? index.byCode.get(code);
  if (!hit) return { state: "not_assigned" };
  const aim = { code: hit.doc.code, version: hit.latest?.version ?? null, origin: hit.doc.origin };
  if (hit.doc.origin !== "library") return { state: "collision", aim };
  return { state: hit.latest?.sha256 === hash ? "assigned" : "differs", aim };
}

/** Hotové IDS v knižnici na aktuálnom commite `ref` so stavom voči AIM. */
export async function libraryCatalog(src: LibrarySource, deps: LibraryDeps): Promise<LibraryCatalog> {
  const head = await src.head();
  const { files, truncated } = await src.files(head.sha);
  const index = await aimIndex(deps.store);
  let e: Engine | null = null;
  const items: LibraryItem[] = [];
  for (const f of files) {
    const code = codeOfPath(f.path);
    const base = { path: f.path, code, size: f.size, specs: [] as LibraryItem["specs"], title: null, ids_version: null };
    try {
      const [xml, change] = await Promise.all([src.blob(f.blob), src.lastChange(f.path, head.sha).catch(() => null)]);
      const hash = sha256(xml);
      if (!CODE_RE.test(code)) {
        items.push({ ...base, sha256: hash, last_change: change, state: "invalid", error: "Meno súboru nie je platný kód IDS (písmená, čísla a . _ -)." });
        continue;
      }
      let d = described.get(hash);
      if (!d) {
        e ??= await engineOf(deps);
        const r = await readXml(e, xml);
        d = { title: r.described.title, version: r.described.version, specs: r.described.specifications.map((s) => ({ identifier: s.identifier, name: s.name })) };
        described.set(hash, d);
      }
      items.push({ ...base, sha256: hash, last_change: change, title: d.title || null, ids_version: d.version, specs: d.specs, ...stateOf(code, f.path, hash, index) });
    } catch (err) {
      items.push({ ...base, sha256: null, last_change: null, state: "invalid", error: err instanceof Error ? err.message.slice(0, 500) : "súbor sa nedal prečítať" });
    }
  }
  return {
    repo: src.repo,
    ref: src.ref,
    dir: src.dir,
    commit: head.sha,
    commit_date: head.date,
    truncated,
    items,
    ...(items.length === 0 ? { note: `V knižnici zatiaľ nie sú hotové IDS (priečinok ${src.dir}/ na vetve ${src.ref} je prázdny alebo chýba).` } : {}),
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
    /** Model je v novšej revízii (null = revízia behu neznáma). */
    stale: boolean | null;
    /** IDS má v AIM novšiu verziu, než nad ktorou beh bežal. */
    ids_stale: boolean;
  }>;
}

export interface ProjectCatalog {
  items: ProjectItem[];
  containers: Array<{ model: string; identification: string; name: string | null }>;
  current_revisions: Record<string, number>;
  /** Migrácia D-182 nie je aplikovaná: väzby a pôvod verzií chýbajú. */
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
// Priradenie k projektu
// ------------------------------------------------------------------------------------------------

export interface AssignInput {
  path: string;
  /** Commit, na ktorom používateľ súbor videl (z katalógu). */
  commit: string;
  /** Sha256 obsahu, ktorý používateľ videl; iný obsah = obnov katalóg. */
  sha256: string;
  author: string;
  /** Premenovaný kód v knižnici: pokračovať históriou tohto knižničného IDS v AIM. */
  continue_code?: string;
  /** Kód súboru nie je v AIM a iné knižničné IDS áno: výslovne nové IDS. */
  as_new?: boolean;
}

export type AssignOutcome =
  | { status: "created"; code: string; version: number }
  | { status: "new_version"; code: string; version: number; previous_version: number; renamed_from?: string }
  | { status: "unchanged"; code: string; version: number }
  | { status: "choice_required"; code: string; candidates: string[]; message: string };

export async function assignFromLibrary(src: LibrarySource, deps: LibraryDeps, input: AssignInput): Promise<AssignOutcome> {
  const author = authorOf(input.author);
  const head = { sha: input.commit };
  const { files } = await src.files(head.sha);
  const file = files.find((f) => f.path === input.path);
  if (!file) throw new LibraryInputError(`Súbor '${input.path}' nie je medzi hotovými IDS knižnice na commite ${input.commit.slice(0, 7)}.`);
  const xml = await src.blob(file.blob);
  const hash = sha256(xml);
  if (hash !== input.sha256) throw new LibraryInputError("Obsah súboru sa nezhoduje s tým, čo karta ukázala; obnov knižnicu a priraď znova.");
  const fileCode = codeOfPath(file.path);
  if (!CODE_RE.test(fileCode)) throw new LibraryInputError(`Meno súboru '${fileCode}' nie je platný kód IDS (písmená, čísla a . _ -).`);

  const index = await aimIndex(deps.store);
  let target: { doc: IdsDocumentRow; latest: IdsVersionMeta | undefined } | undefined;
  if (input.continue_code) {
    target = index.byCode.get(input.continue_code);
    if (!target) throw new LibraryInputError(`IDS '${input.continue_code}' v AIM neexistuje.`);
    if (target.doc.origin !== "library") throw new LibraryInputError(`IDS '${input.continue_code}' je pracovné, nie z knižnice; históriu knižničného IDS nesie len knižničné IDS.`);
  } else if (!input.as_new) {
    target = index.byPath.get(file.path) ?? index.byCode.get(fileCode);
    if (target && target.doc.origin !== "library") {
      throw new LibraryInputError(`Kód '${fileCode}' už v AIM má pracovné IDS (nie z knižnice). Premenuj súbor v knižnici alebo pracovné IDS.`);
    }
    if (!target) {
      const candidates = [...index.byCode.values()].filter((x) => x.doc.origin === "library" && x.doc.status !== "archived").map((x) => x.doc.code);
      if (candidates.length > 0) {
        return {
          status: "choice_required",
          code: fileCode,
          candidates,
          message: `IDS '${fileCode}' v AIM ešte nie je. Je to nové IDS, alebo nová verzia premenovaného IDS (história pokračuje)?`,
        };
      }
    }
  } else if (index.byCode.has(fileCode)) {
    throw new LibraryInputError(`Kód '${fileCode}' už v AIM existuje; nové IDS s rovnakým kódom nejde.`);
  }

  const e = await engineOf(deps);
  const audit = await auditXml(e, xml);
  const { described: d } = await readXml(e, xml);
  const title = (d.title || fileCode).slice(0, 200);
  const librarySource = `${src.repo}@${input.commit}:${file.path}`;
  const write = {
    xml,
    sha256: hash,
    title,
    ids_version: d.version,
    audit,
    author,
    source: "import" as const,
    note: `Priradené z knižnice ${src.repo}@${input.commit.slice(0, 7)}:${file.path}`,
    library_repo: src.repo,
    library_path: file.path,
    library_commit: input.commit,
    library_code: fileCode,
  };

  if (target) {
    const latest = target.latest;
    if (latest && latest.sha256 === hash) return { status: "unchanged", code: target.doc.code, version: latest.version };
    const previousCode = target.doc.code;
    const renamed = previousCode !== fileCode;
    if (renamed && index.byCode.has(fileCode)) throw new LibraryInputError(`Kód '${fileCode}' už v AIM patrí inému IDS; premenovanie nejde.`);
    const row = await deps.store.addVersion(target.doc.id, write, null);
    await deps.lib.updateDocument(target.doc.id, { library_source: librarySource, ...(renamed ? { code: fileCode } : {}) });
    return {
      status: "new_version",
      code: fileCode,
      version: row.version,
      previous_version: latest?.version ?? 0,
      ...(renamed ? { renamed_from: previousCode } : {}),
    };
  }

  const doc = await deps.store.createDocument({ code: fileCode, title, origin: "library", library_source: librarySource, created_by: author });
  try {
    const row = await deps.store.addVersion(doc.id, write, null);
    return { status: "created", code: fileCode, version: row.version };
  } catch (err) {
    await deps.store.deleteDocument(doc.id).catch(() => undefined);
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------
// Väzba IDS <-> model (ručne)
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
// Uloženie behu z viewera
// ------------------------------------------------------------------------------------------------

/** Strop riadkov prvok x špecifikácia (rovnaký ako `ifc_ids_validate save`). */
export const MAX_VIEWER_RUN_RESULTS = 50_000;

export interface ViewerRunInput {
  code: string;
  version: number;
  ids_sha256: string;
  model: string;
  revision: number | null;
  engine_version: string;
  author: string;
  /** Výsledky po špecifikáciách v tvare reportu `@ifc-lite/ids` (`specificationResults`). */
  specs: ReportSpec[];
}

export interface ViewerRunDeps extends LibraryDeps {
  /** IFC GlobalId -> objects.id (aktívny GUID, D-010). */
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

/** Tvar výsledkov z viewera (podmnožina reportu `@ifc-lite/ids`) po overení; texty orezané. */
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
