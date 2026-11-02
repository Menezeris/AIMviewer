/** Pomôcky testov IDS dokumentov (D-162): úložisko v pamäti so správaním DB (jedinečný kód, nové číslo verzie). */

import type { IdsLibraryStore, ModelRun } from "./library";
import {
  IdsConflictError,
  type IdsDocumentRow,
  type IdsResultWrite,
  type IdsRunSummary,
  type IdsRunWrite,
  type IdsStore,
  type IdsVersionRow,
} from "./types";

export interface MemoryIdsStore extends IdsStore {
  docs: IdsDocumentRow[];
  rows: IdsVersionRow[];
  runs: Array<IdsRunWrite & { id: string }>;
  results: Array<IdsResultWrite & { run_id: string }>;
}

export function memoryIdsStore(): MemoryIdsStore {
  const docs: IdsDocumentRow[] = [];
  const rows: IdsVersionRow[] = [];
  const runs: Array<IdsRunWrite & { id: string }> = [];
  const results: Array<IdsResultWrite & { run_id: string }> = [];
  let n = 0;
  const stamp = () => `2026-10-23T12:00:${String(n).padStart(2, "0")}Z`;
  const meta = ({ xml, ...rest }: IdsVersionRow) => {
    void xml;
    return rest;
  };
  const latestRow = (documentId: string) => rows.filter((r) => r.document_id === documentId).sort((a, b) => b.version - a.version)[0];
  return {
    docs,
    rows,
    runs,
    results,
    async listDocuments() {
      return [...docs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    async byCode(code) {
      return docs.find((d) => d.code === code) ?? null;
    },
    async byId(id) {
      return docs.find((d) => d.id === id) ?? null;
    },
    async latestVersions(ids) {
      return new Map(ids.flatMap((id) => (latestRow(id) ? [[id, meta(latestRow(id))] as const] : [])));
    },
    async lastRuns(ids) {
      const out = new Map<string, IdsRunSummary>();
      for (const run of [...runs].reverse()) {
        const v = rows.find((r) => r.id === run.ids_version_id);
        if (!v || !ids.includes(v.document_id) || out.has(v.document_id)) continue;
        out.set(v.document_id, { ...run, document_id: v.document_id, version: v.version, checked_at: stamp(), binding: false });
      }
      return out;
    },
    async versions(documentId) {
      return rows.filter((r) => r.document_id === documentId).sort((a, b) => b.version - a.version).map(meta);
    },
    async version(documentId, version) {
      return (version === undefined ? latestRow(documentId) : rows.find((r) => r.document_id === documentId && r.version === version)) ?? null;
    },
    async versionById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async createDocument(row) {
      if (docs.some((d) => d.code === row.code)) throw new Error(`Vytvorenie IDS zlyhalo: duplicate key value violates unique constraint (code ${row.code})`);
      n += 1;
      const doc: IdsDocumentRow = {
        id: `doc-${n}`,
        status: "active",
        library_source: null,
        derived_from: null,
        created_by: null,
        ...row,
        created_at: stamp(),
        updated_at: stamp(),
      };
      docs.push(doc);
      return doc;
    },
    async deleteDocument(id) {
      const i = docs.findIndex((d) => d.id === id);
      if (i >= 0) docs.splice(i, 1);
      for (let j = rows.length - 1; j >= 0; j--) if (rows[j].document_id === id) rows.splice(j, 1);
    },
    async addVersion(documentId, write, baseVersion) {
      const doc = docs.find((d) => d.id === documentId);
      if (!doc) throw new Error("dokument neexistuje");
      // Rovnaké pravidlá ako trigger v DB: knižnica len importom, chat len chat a viewer.
      if (doc.origin === "library" && write.source !== "import") throw new Error("knižničná snímka IDS je len na čítanie (create derived_from)");
      if (doc.origin === "chat" && write.source === "import") throw new Error("import patrí len knižničnej snímke IDS");
      const latest = latestRow(documentId)?.version ?? 0;
      if (baseVersion !== null && baseVersion !== latest) throw new IdsConflictError(latest, baseVersion);
      n += 1;
      const { title, ...rest } = write;
      const row: IdsVersionRow = { ...rest, id: `ver-${n}`, document_id: documentId, version: latest + 1, created_at: stamp() };
      rows.push(row);
      doc.title = title;
      doc.updated_at = stamp();
      return row;
    },
    async saveRun(run, res) {
      n += 1;
      const id = `run-${n}`;
      runs.push({ ...run, id });
      for (const r of res) results.push({ ...r, run_id: id });
      return id;
    },
  };
}

/** Úložisko knižnice (D-182) v pamäti nad `MemoryIdsStore`: modely, väzby, revízie, behy po modeloch. */
export interface MemoryLibraryOptions {
  containers?: Array<{ id: string; model: string; identification?: string; name?: string | null }>;
  /** Všetky revízie modelov {model: [revízie]}, aktuálna je posledná. */
  revisions?: Record<string, number[]>;
  /** Simulácia DB pred migráciou D-182: väzby nie sú. */
  schemaMissing?: boolean;
}

export interface MemoryLibraryStore extends IdsLibraryStore {
  bindings: Array<{ document_id: string; information_container_id: string; library_container: string | null; created_by: string; valid_from: string; valid_until: string | null; ended_by: string | null }>;
  revisions: Record<string, number[]>;
}

export function memoryIdsLibraryStore(store: MemoryIdsStore, opts: MemoryLibraryOptions = {}): MemoryLibraryStore {
  const containers = (opts.containers ?? [
    { id: "c-asr", model: "ASR" },
    { id: "c-vzt", model: "VZT" },
  ]).map((c) => ({ identification: c.model, name: null, ...c }));
  const revisions = opts.revisions ?? { ASR: [78, 79], VZT: [11] };
  const bindings: MemoryLibraryStore["bindings"] = [];
  const modelOf = (id: string) => containers.find((c) => c.id === id)?.model ?? "?";
  return {
    bindings,
    revisions,
    async updateDocument(id, patch) {
      const doc = store.docs.find((d) => d.id === id);
      if (!doc) throw new Error("dokument neexistuje");
      if (patch.code && store.docs.some((d) => d.code === patch.code && d.id !== id)) throw new Error("duplicate key value violates unique constraint (code)");
      Object.assign(doc, patch);
    },
    async containers() {
      return containers;
    },
    async models(documentIds) {
      if (opts.schemaMissing) return null;
      return bindings
        .filter((b) => documentIds.includes(b.document_id) && b.valid_until === null)
        .map((b) => ({ document_id: b.document_id, information_container_id: b.information_container_id, model: modelOf(b.information_container_id), library_container: b.library_container, created_by: b.created_by, valid_from: b.valid_from }));
    },
    async bindModel(row) {
      if (opts.schemaMissing) throw new Error("relation ids_document_models does not exist");
      if (bindings.some((b) => b.document_id === row.document_id && b.information_container_id === row.information_container_id && b.valid_until === null)) return;
      bindings.push({ ...row, valid_from: "2026-11-02T12:00:00Z", valid_until: null, ended_by: null });
    },
    async endModel(documentId, containerId, endedBy) {
      const b = bindings.find((x) => x.document_id === documentId && x.information_container_id === containerId && x.valid_until === null);
      if (!b) return false;
      b.valid_until = "2026-11-02T13:00:00Z";
      b.ended_by = endedBy;
      return true;
    },
    async currentRevisions() {
      return Object.fromEntries(Object.entries(revisions).map(([m, list]) => [m, list[list.length - 1]]));
    },
    async revisionExists(model, revision) {
      return (revisions[model] ?? []).includes(revision);
    },
    async lastRunsByModel(documentIds) {
      const out: ModelRun[] = [];
      const seen = new Set<string>();
      for (const run of [...store.runs].reverse()) {
        const v = store.rows.find((r) => r.id === run.ids_version_id);
        if (!v || !documentIds.includes(v.document_id)) continue;
        const key = `${v.document_id}|${run.model_label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: run.id,
          document_id: v.document_id,
          version: v.version,
          model_label: run.model_label,
          checked_at: "2026-11-02T12:00:00Z",
          specs_total: run.specs_total,
          specs_passed: run.specs_passed,
          results_total: run.results_total,
          results_failed: run.results_failed,
          engine: run.engine,
          engine_version: run.engine_version ?? null,
          trigger: run.trigger,
          created_by: run.created_by ?? null,
          model_revisions: run.model_revisions,
        });
      }
      return out;
    },
  };
}
