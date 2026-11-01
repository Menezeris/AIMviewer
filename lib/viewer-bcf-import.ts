/**
 * Import `.bcfzip` z BCF panela viewera do DB (D-158 krok 8, dodatok 1. 11.): wire formát správ
 * `BCF_IMPORT` (viewer -> host) a `BCF_IMPORTED` (host -> viewer), zrkadlo `apps/viewer/src/aim/` vo forku.
 * Viewer nemá vlastný token: súbor pošle hostu cez most a host ho zapíše cez `/api/bcf/viewer-import`
 * (env brána, origin guard, rate limit), tou istou cestou ako `bcf_topic action=import` (#372).
 */

/** Limit tela funkcie na Verceli; väčší súbor ide cez chat (`bcf_topic action=import` s url). */
export const BCF_VIEWER_IMPORT_MAX_BYTES = 4_400_000;

export interface BcfImportRequest {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  dry_run: boolean;
}

export interface BcfImportSummaryWire {
  dry_run: boolean;
  bcf_version: string;
  topics_in_file: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
  failed: number;
  warnings: string[];
}

export type BcfImportResult = { ok: true; summary: BcfImportSummaryWire } | { ok: false; error: string };

/** Správa `BCF_IMPORT` po overení tvaru; null = neplatná (nič sa neodošle). */
export function parseBcfImport(raw: unknown): BcfImportRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "BCF_IMPORT") return null;
  if (typeof m.id !== "string" || m.id.length === 0 || m.id.length > 200) return null;
  if (!(m.bytes instanceof ArrayBuffer)) return null;
  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 200) : "import.bcfzip";
  return { id: m.id, name, bytes: m.bytes, dry_run: m.dry_run === true };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Súhrn importu (ImportSummary z lib/bcf/import) zúžený na to, čo viewer ukáže; témy jednotlivo neposiela. */
export function summaryToWire(s: Record<string, unknown>): BcfImportSummaryWire {
  return {
    dry_run: s.dry_run === true,
    bcf_version: typeof s.bcf_version === "string" ? s.bcf_version : "",
    topics_in_file: num(s.topics_in_file),
    created: num(s.created),
    updated: num(s.updated),
    unchanged: num(s.unchanged),
    conflicts: num(s.conflicts),
    skipped: num(s.skipped),
    failed: num(s.failed),
    warnings: Array.isArray(s.warnings) ? s.warnings.filter((w): w is string => typeof w === "string").slice(0, 50).map((w) => w.slice(0, 500)) : [],
  };
}

export function bcfImportedMessage(id: string, result: BcfImportResult): Record<string, unknown> {
  return result.ok
    ? { type: "BCF_IMPORTED", id, ok: true, summary: result.summary }
    : { type: "BCF_IMPORTED", id, ok: false, error: result.error.slice(0, 2000) };
}
