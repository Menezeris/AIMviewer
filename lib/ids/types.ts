/**
  * IDS documents (D-162): rows of the tables `ids_documents` and `ids_document_versions`
  * and the store interface. The IDS carrier is XML; Studio JSON is not stored.
 */

export type IdsOrigin = "library" | "chat";
export type IdsVersionSource = "chat" | "viewer" | "import";

export interface IdsDocumentRow {
  id: string;
  code: string;
  title: string;
  origin: IdsOrigin;
  library_source: string | null;
  derived_from: string | null;
  status: "draft" | "active" | "archived";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdsVersionRow {
  id: string;
  document_id: string;
  version: number;
  xml: string;
  sha256: string;
  ids_version: string | null;
  audit: Record<string, unknown> | null;
  author: string | null;
  source: IdsVersionSource;
  note: string | null;
  created_at: string;
    /** Version origin from the library (D-182): repo, path, commit and file code at the time of assignment; null outside `import`. */
  library_repo?: string | null;
  library_path?: string | null;
  library_commit?: string | null;
  library_code?: string | null;
}

export type IdsVersionMeta = Omit<IdsVersionRow, "xml">;

export interface IdsDocumentWrite {
  code: string;
  title: string;
  origin: IdsOrigin;
  library_source?: string | null;
  derived_from?: string | null;
  created_by?: string | null;
}

export interface IdsVersionWrite {
  xml: string;
  sha256: string;
  title: string;
  ids_version: string | null;
  audit: Record<string, unknown> | null;
  author: string | null;
  source: IdsVersionSource;
  note: string | null;
    /** Origin in the library (D-182), only for `source = import`. */
  library_repo?: string;
  library_path?: string;
  library_commit?: string;
  library_code?: string;
}

/** Latest saved run over an IDS version (into `list`). */
export interface IdsRunSummary {
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
  trigger: string;
  binding: boolean;
}

export interface IdsRunWrite {
  ids_title: string;
  ids_version: string | null;
  ids_sha256: string;
  ids_source: string;
  ids_version_id: string;
  model_label: string;
  model_file: string | null;
  specs_total: number;
  specs_passed: number;
  results_total: number;
  results_failed: number;
  engine: "ifc-lite";
  trigger: "chat" | "viewer";
    /** Tool version (D-182), for a run from the viewer the `@ifc-lite/ids` version in the fork. */
  engine_version?: string | null;
    /** Who saved the run (name from the viewer dialog). */
  created_by?: string | null;
    /** Input signature (D-183): {model: archive revision} over which the run really ran; {} = unknown. */
  model_revisions: Record<string, number>;
}

export interface IdsResultWrite {
  spec_identifier: string | null;
  spec_name: string;
  spec_description: string | null;
  spec_instructions: string | null;
  object_id: string | null;
  ifc_guid: string | null;
  ifc_type: string | null;
  status: "pass" | "fail";
  reasons: string[];
}

/** The version write hit a newer version (409): the chat offers `diff`. */
export class IdsConflictError extends Error {
  constructor(public readonly latest: number, public readonly base: number | null) {
    super(
      `Konflikt verzie: IDS už má verziu ${latest}${base === null ? "" : `, zápis vychádzal z verzie ${base}`}. ` +
        "Porovnaj action=diff a zopakuj úpravu nad poslednou verziou.",
    );
  }
}

export interface IdsStore {
  listDocuments(): Promise<IdsDocumentRow[]>;
  byCode(code: string): Promise<IdsDocumentRow | null>;
  byId(id: string): Promise<IdsDocumentRow | null>;
    /** Latest version of each of the documents (without XML). */
  latestVersions(documentIds: string[]): Promise<Map<string, IdsVersionMeta>>;
    /** Latest run over any version of each of the documents. */
  lastRuns(documentIds: string[]): Promise<Map<string, IdsRunSummary>>;
  versions(documentId: string): Promise<IdsVersionMeta[]>;
    /** Version with XML; without a number the latest, null = does not exist. */
  version(documentId: string, version?: number): Promise<IdsVersionRow | null>;
  versionById(id: string): Promise<IdsVersionRow | null>;
  createDocument(row: IdsDocumentWrite): Promise<IdsDocumentRow>;
    /** Removes a document without versions (rollback of a failed `create`). */
  deleteDocument(id: string): Promise<void>;
  /**
      * New immutable version (latest + 1). `baseVersion` = the version the edit started from;
      * if it is not the latest, throws `IdsConflictError`. Aligns the document's title and `updated_at`.
   */
  addVersion(documentId: string, write: IdsVersionWrite, baseVersion: number | null): Promise<IdsVersionRow>;
    /** Check record (`ifc_ids_validate save=true`); returns the run id. */
  saveRun(run: IdsRunWrite, results: IdsResultWrite[]): Promise<string>;
}
