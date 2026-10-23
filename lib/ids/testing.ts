/** Pomôcky testov IDS dokumentov (D-162): úložisko v pamäti so správaním DB (jedinečný kód, nové číslo verzie). */

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
