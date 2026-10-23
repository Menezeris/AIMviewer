import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

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
const META = "id, document_id, version, sha256, ids_version, audit, author, source, note, created_at";
const IN_CHUNK = 100;
const RESULT_CHUNK = 500;
/** Strop počtu dokumentov v `list` (jedno IDS je jeden riadok, nie model). */
const LIST_CAP = 200;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";

export function supabaseIdsStore(): IdsStore {
  const db = () => getSupabaseAdmin();

  async function latestOf(documentId: string): Promise<number> {
    const { data, error } = await db().from(VERSIONS).select("version").eq("document_id", documentId).order("version", { ascending: false }).limit(1);
    if (error) fail("Čítanie verzií IDS zlyhalo", error);
    return ((data ?? [])[0] as { version: number } | undefined)?.version ?? 0;
  }

  return {
    async listDocuments() {
      const { data, error } = await db().from(DOCS).select("*").order("updated_at", { ascending: false }).limit(LIST_CAP);
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data ?? []) as IdsDocumentRow[];
    },
    async byCode(code) {
      const { data, error } = await db().from(DOCS).select("*").eq("code", code).maybeSingle();
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data as IdsDocumentRow | null) ?? null;
    },
    async byId(id) {
      const { data, error } = await db().from(DOCS).select("*").eq("id", id).maybeSingle();
      if (error) fail("Čítanie IDS zlyhalo", error);
      return (data as IdsDocumentRow | null) ?? null;
    },
    async latestVersions(documentIds) {
      const out = new Map<string, IdsVersionMeta>();
      for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
        const { data, error } = await db()
          .from(VERSIONS)
          .select(META)
          .in("document_id", documentIds.slice(i, i + IN_CHUNK))
          .order("version", { ascending: false });
        if (error) fail("Čítanie verzií IDS zlyhalo", error);
        for (const v of (data ?? []) as IdsVersionMeta[]) if (!out.has(v.document_id)) out.set(v.document_id, v);
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
      const { data, error } = await db().from(VERSIONS).select(META).eq("document_id", documentId).order("version", { ascending: false });
      if (error) fail("Čítanie verzií IDS zlyhalo", error);
      return (data ?? []) as IdsVersionMeta[];
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
      const { data, error } = await db().from(DOCS).insert(row).select("*").single();
      if (error || !data) fail("Vytvorenie IDS zlyhalo", error);
      return data as IdsDocumentRow;
    },
    async deleteDocument(id) {
      const { error } = await db().from(DOCS).delete().eq("id", id);
      if (error) fail("Zrušenie IDS zlyhalo", error);
    },
    async addVersion(documentId, write: IdsVersionWrite, baseVersion) {
      const latest = await latestOf(documentId);
      if (baseVersion !== null && baseVersion !== latest) throw new IdsConflictError(latest, baseVersion);
      const { title, ...row } = write;
      const { data, error } = await db().from(VERSIONS).insert({ ...row, document_id: documentId, version: latest + 1 }).select("*").single();
      // Súbežný zápis dostal rovnaké číslo: unikátny kľúč (document_id, version) ho odmietol.
      if (isUniqueViolation(error)) throw new IdsConflictError(await latestOf(documentId), baseVersion);
      if (error || !data) fail("Uloženie verzie IDS zlyhalo", error);
      const { error: upd } = await db().from(DOCS).update({ title, updated_at: new Date().toISOString() }).eq("id", documentId);
      if (upd) fail("Úprava IDS zlyhala", upd);
      return data as IdsVersionRow;
    },
    async saveRun(run: IdsRunWrite, results: IdsResultWrite[]) {
      const { data, error } = await db().from("ids_runs").insert({ ...run, binding: false }).select("id").single();
      if (error || !data) fail("Uloženie behu IDS zlyhalo", error);
      const runId = (data as { id: string }).id;
      for (let i = 0; i < results.length; i += RESULT_CHUNK) {
        const rows = results.slice(i, i + RESULT_CHUNK).map((r) => ({ ...r, run_id: runId }));
        const { error: err } = await db().from("ids_results").insert(rows);
        if (err) {
          await db().from("ids_runs").delete().eq("id", runId);
          fail("Uloženie výsledkov IDS zlyhalo", err);
        }
      }
      return runId;
    },
  };
}
