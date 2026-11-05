import "server-only";

import { getSupabaseAdmin } from "../supabase/server";

import type { IdsLibraryStore, ModelBinding, ModelRun } from "./library";
import { isMissingSchema, SCHEMA_HINT } from "./schema";

/** Úložisko väzieb, revízií a behov po modeloch pre knižnicu požiadaviek (D-182, `service_role`). */

const IN_CHUNK = 100;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "neznáma chyba"}`);
}

export function supabaseIdsLibraryStore(): IdsLibraryStore {
  const db = () => getSupabaseAdmin();

  async function containersById(): Promise<Map<string, string>> {
    const { data, error } = await db().from("information_containers").select("id, model").eq("container_type", "IFC");
    if (error) fail("Čítanie modelov zlyhalo", error);
    return new Map(((data ?? []) as Array<{ id: string; model: string }>).map((c) => [c.id, c.model]));
  }

  return {
    async updateDocument(id, patch) {
      const { error } = await db()
        .from("ids_documents")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail("Úprava IDS zlyhala", error);
    },
    async containers() {
      const { data, error } = await db()
        .from("information_containers")
        .select("id, model, identification, name")
        .eq("container_type", "IFC")
        .order("model");
      if (error) fail("Čítanie modelov zlyhalo", error);
      return (data ?? []) as Array<{ id: string; model: string; identification: string; name: string | null }>;
    },
    async models(documentIds) {
      if (documentIds.length === 0) return [];
      const byId = await containersById();
      const out: ModelBinding[] = [];
      for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
        const { data, error } = await db()
          .from("ids_document_models")
          .select("document_id, information_container_id, library_container, created_by, valid_from")
          .in("document_id", documentIds.slice(i, i + IN_CHUNK))
          .is("valid_until", null);
        if (isMissingSchema(error)) return null;
        if (error) fail("Čítanie väzieb IDS zlyhalo", error);
        for (const r of (data ?? []) as Array<Omit<ModelBinding, "model">>) {
          out.push({ ...r, model: byId.get(r.information_container_id) ?? "?" });
        }
      }
      return out;
    },
    async bindModel(row) {
      const { error } = await db().from("ids_document_models").insert(row);
      if (isMissingSchema(error)) fail(`Väzba IDS na model zlyhala (${SCHEMA_HINT})`, error);
      // Súbežné zaškrtnutie: jedinečný index aktívnej dvojice, väzba už je.
      if (error && error.code !== "23505") fail("Väzba IDS na model zlyhala", error);
    },
    async endModel(documentId, containerId, endedBy) {
      const { data, error } = await db()
        .from("ids_document_models")
        .update({ valid_until: new Date().toISOString(), ended_by: endedBy })
        .eq("document_id", documentId)
        .eq("information_container_id", containerId)
        .is("valid_until", null)
        .select("id");
      if (isMissingSchema(error)) fail(`Zrušenie väzby zlyhalo (${SCHEMA_HINT})`, error);
      if (error) fail("Zrušenie väzby zlyhalo", error);
      return (data ?? []).length > 0;
    },
    async currentRevisions() {
      const { data, error } = await db().from("model_revisions").select("model, revision").eq("is_current", true);
      if (error) fail("Čítanie revízií zlyhalo", error);
      return Object.fromEntries(((data ?? []) as Array<{ model: string; revision: number }>).map((r) => [r.model, r.revision]));
    },
    async revisionExists(model, revision) {
      const { data, error } = await db().from("model_revisions").select("id").eq("model", model).eq("revision", revision).limit(1);
      if (error) fail("Čítanie revízií zlyhalo", error);
      return (data ?? []).length > 0;
    },
    async lastRunsByModel(documentIds) {
      if (documentIds.length === 0) return [];
      const out: ModelRun[] = [];
      const seen = new Set<string>();
      let extra = true;
      for (let i = 0; i < documentIds.length; i += IN_CHUNK) {
        const cols = (withExtra: boolean) =>
          "id, model_label, checked_at, specs_total, specs_passed, results_total, results_failed, engine, trigger, model_revisions, " +
          (withExtra ? "engine_version, created_by, " : "") +
          "ids_document_versions!inner(document_id, version)";
        const query = (withExtra: boolean) =>
          db()
            .from("ids_runs")
            .select(cols(withExtra))
            .in("ids_document_versions.document_id", documentIds.slice(i, i + IN_CHUNK))
            .order("checked_at", { ascending: false })
            .limit(1000);
        let res = await query(extra);
        if (res.error && extra && isMissingSchema(res.error)) {
          extra = false;
          res = await query(false);
        }
        if (res.error) fail("Čítanie behov IDS zlyhalo", res.error);
        type Row = Omit<ModelRun, "document_id" | "version" | "engine_version" | "created_by"> & {
          engine_version?: string | null;
          created_by?: string | null;
          ids_document_versions: { document_id: string; version: number };
        };
        for (const r of (res.data ?? []) as unknown as Row[]) {
          const { ids_document_versions: v, ...run } = r;
          const key = `${v.document_id}|${run.model_label}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            ...run,
            engine_version: run.engine_version ?? null,
            created_by: run.created_by ?? null,
            model_revisions: (run.model_revisions ?? {}) as Record<string, number>,
            document_id: v.document_id,
            version: v.version,
          });
        }
      }
      return out;
    },
  };
}
