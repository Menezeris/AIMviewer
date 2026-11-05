import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import { isMissingSchema, SCHEMA_HINT } from "./schema";

import {
  IdsConflictError,
  type IdsDocumentRow,
  type IdsDocumentWrite,
  type IdsResultWrite,
  type IdsRunSummary,
  type IdsRunWrite,
  type IdsStore,
  type IdsVersionMeta,
  type IdsVersionRow,
  type IdsVersionWrite,
} from "./types";

/** Úložisko IDS dokumentov v DB (D-162, `service_role`); logika je v `tools.ts`. */

const DOCS = "ids_documents";
const VERSIONS = "ids_document_versions";
const BASE_META = "id, document_id, version, sha256, ids_version, audit, author, source, note, created_at";
/** Pôvod v knižnici (D-182); stĺpce pribudnú migráciou `20261102120000_ids_library_assign.sql`. */
const LIBRARY_META = "library_repo, library_path, library_commit, library_code";
const IN_CHUNK = 100;
const RESULT_CHUNK = 500;
/** Strop počtu dokumentov v `list` (jedno IDS je jeden riadok, nie model). */
const LIST_CAP = 200;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";

/** Stĺpce metadát verzie: s pôvodom v knižnici, kým DB nepovie, že ich nemá (pred migráciou D-182). */
let withLibrary = true;
const meta = () => (withLibrary ? `${BASE_META}, ${LIBRARY_META}` : BASE_META);
async function selectMeta<T>(run: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>) {
  let res = await run(meta());
  if (res.error && withLibrary && isMissingSchema(res.error)) {
    withLibrary = false;
    res = await run(meta());
  }
  return res;
}

/** D-189: IDS documents and runs of one project; codes are unique per project. */
export function supabaseIdsStore(projectId: string): IdsStore {
  const db = () => getSupabaseAdmin();

  async function latestOf(documentId: string): Promise<number> {
    const { data, error } = await db().from(VERSIONS).select("version").eq("document_id", documentId).order("version", { ascending: false }).limit(1);
    if (error) fail("Čítanie verzií IDS zlyhalo", error);
    return ((data ?? [])[0] as { version: number } | undefined)?.version ?? 0;
  }

  return {
    async listDocuments() {
      const { data, error } = await db().from(DOCS).select("*").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(LIST_CAP);
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data ?? []) as IdsDocumentRow[];
    },
    async byCode(code) {
      const { data, error } = await db().from(DOCS).select("*").eq("project_id", projectId).eq("code", code).maybeSingle();
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data as IdsDocumentRow | null) ?? null;
    },
    async byId(id) {
      const { data, error } = await db().from(DOCS).select("*").eq("project_id", projectId).eq("id", id).maybeSingle();
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data as IdsDocumentRow | null) ?? null;
    },
    async latestVersions(documentIds) {
      const out = new Map<string, IdsVersionMeta>();
      for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
        const { data, error } = await selectMeta((cols) =>
          db().from(VERSIONS).select(cols).in("document_id", documentIds.slice(i, i + IN_CHUNK)).order("version", { ascending: false }),
        );
        if (error) fail("Čítanie verzií IDS zlyhalo", error);
        for (const v of (data ?? []) as unknown as IdsVersionMeta[]) if (!out.has(v.document_id)) out.set(v.document_id, v);
      }
      return out;
    },
    async lastRuns(documentIds) {
      const out = new Map<string, IdsRunSummary>();
      for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
        const { data, error } = await db()
          .from("ids_runs")
          .select(
            "id, model_label, checked_at, specs_total, specs_passed, results_total, results_failed, engine, trigger, binding, " +
              `${VERSIONS}!inner(document_id, version)`,
          )
          .eq("project_id", projectId)
          .in(`${VERSIONS}.document_id`, documentIds.slice(i, i + IN_CHUNK))
          .order("checked_at", { ascending: false })
          .limit(500);
        if (error) fail("Čítanie behov IDS zlyhalo", error);
        for (const r of (data ?? []) as unknown as Array<Omit<IdsRunSummary, "document_id" | "version"> & { ids_document_versions: { document_id: string; version: number } }>) {
          const { ids_document_versions: v, ...run } = r;
          if (!out.has(v.document_id)) out.set(v.document_id, { ...run, document_id: v.document_id, version: v.version });
        }
      }
      return out;
    },
    async versions(documentId) {
      const { data, error } = await selectMeta((cols) => db().from(VERSIONS).select(cols).eq("document_id", documentId).order("version", { ascending: false }));
      if (error) fail("Čítanie verzií IDS zlyhalo", error);
      return (data ?? []) as unknown as IdsVersionMeta[];
    },
    async version(documentId, version) {
      let q = db().from(VERSIONS).select("*").eq("document_id", documentId);
      q = version === undefined ? q.order("version", { ascending: false }).limit(1) : q.eq("version", version);
      const { data, error } = await q;
      if (error) fail("Čítanie verzie IDS zlyhalo", error);
      return ((data ?? [])[0] as IdsVersionRow | undefined) ?? null;
    },
    async versionById(id) {
      const { data, error } = await db().from(VERSIONS).select("*").eq("id", id).maybeSingle();
      if (error) fail("Čítanie verzie IDS zlyhalo", error);
      return (data as IdsVersionRow | null) ?? null;
    },
    async createDocument(row: IdsDocumentWrite) {
      const { data, error } = await db().from(DOCS).insert({ ...row, project_id: projectId }).select("*").single();
      if (error || !data) fail("Vytvorenie IDS zlyhalo", error);
      return data as IdsDocumentRow;
    },
    async deleteDocument(id) {
      const { error } = await db().from(DOCS).delete().eq("project_id", projectId).eq("id", id);
      if (error) fail("Zrušenie IDS zlyhalo", error);
    },
    async addVersion(documentId, write: IdsVersionWrite, baseVersion) {
      const latest = await latestOf(documentId);
      if (baseVersion !== null && baseVersion !== latest) throw new IdsConflictError(latest, baseVersion);
      const { title, ...row } = write;
      const { data, error } = await db().from(VERSIONS).insert({ ...row, document_id: documentId, version: latest + 1 }).select("*").single();
      // Súbežný zápis dostal rovnaké číslo: unikátny kľúč (document_id, version) ho odmietol.
      if (isUniqueViolation(error)) throw new IdsConflictError(await latestOf(documentId), baseVersion);
      if (isMissingSchema(error)) fail(`Uloženie verzie IDS zlyhalo (${SCHEMA_HINT})`, error);
      if (error || !data) fail("Uloženie verzie IDS zlyhalo", error);
      const { error: upd } = await db().from(DOCS).update({ title, updated_at: new Date().toISOString() }).eq("project_id", projectId).eq("id", documentId);
      if (upd) fail("Úprava IDS zlyhala", upd);
      return data as IdsVersionRow;
    },
    async saveRun(run: IdsRunWrite, results: IdsResultWrite[]) {
      const { data, error } = await db().from("ids_runs").insert({ ...run, binding: false, project_id: projectId }).select("id").single();
      if (isMissingSchema(error)) fail(`Uloženie behu IDS zlyhalo (${SCHEMA_HINT})`, error);
      if (error || !data) fail("Uloženie behu IDS zlyhalo", error);
      const runId = (data as { id: string }).id;
      for (let i = 0; i < results.length; i += RESULT_CHUNK) {
        const rows = results.slice(i, i + RESULT_CHUNK).map((r) => ({ ...r, run_id: runId }));
        const { error: err } = await db().from("ids_results").insert(rows);
        if (err) {
          await db().from("ids_runs").delete().eq("project_id", projectId).eq("id", runId);
          fail("Uloženie výsledkov IDS zlyhalo", err);
        }
      }
      return runId;
    },
  };
}
