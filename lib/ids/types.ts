/**
 * IDS dokumenty (D-162): riadky tabuliek `ids_documents` a `ids_document_versions`
 * a rozhranie úložiska. Nositeľ IDS je XML; Studio JSON sa neukladá.
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
}

/** Posledný uložený beh nad verziou IDS (do `list`). */
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
  trigger: "chat";
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

/** Zápis verzie narazil na novšiu verziu (409): chat ponúkne `diff`. */
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
  /** Posledná verzia každého z dokumentov (bez XML). */
  latestVersions(documentIds: string[]): Promise<Map<string, IdsVersionMeta>>;
  /** Posledný beh nad ktoroukoľvek verziou každého z dokumentov. */
  lastRuns(documentIds: string[]): Promise<Map<string, IdsRunSummary>>;
  versions(documentId: string): Promise<IdsVersionMeta[]>;
  /** Verzia s XML; bez čísla posledná, null = neexistuje. */
  version(documentId: string, version?: number): Promise<IdsVersionRow | null>;
  versionById(id: string): Promise<IdsVersionRow | null>;
  createDocument(row: IdsDocumentWrite): Promise<IdsDocumentRow>;
  /** Zruší dokument bez verzií (vrátenie neúspešného `create`). */
  deleteDocument(id: string): Promise<void>;
  /**
   * Nová nemenná verzia (posledná + 1). `baseVersion` = z ktorej verzie úprava vychádzala;
   * ak nie je posledná, hodí `IdsConflictError`. Zosúladí názov a `updated_at` dokumentu.
   */
  addVersion(documentId: string, write: IdsVersionWrite, baseVersion: number | null): Promise<IdsVersionRow>;
  /** Záznam kontroly (`ifc_ids_validate save=true`); vráti id behu. */
  saveRun(run: IdsRunWrite, results: IdsResultWrite[]): Promise<string>;
}
