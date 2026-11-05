/**
 * Import of `.bcfzip` from the viewer's BCF panel into the DB (D-158 step 8, addendum 1 Nov): wire format of messages
 * `BCF_IMPORT` (viewer -> host) and `BCF_IMPORTED` (host -> viewer), mirror of `apps/viewer/src/aim/` in the fork.
 * The viewer has no token of its own: it sends the file to the host via the bridge and the host writes it through `/api/bcf/viewer-import`
 * (env gate, origin guard, rate limit), the same way as `bcf_topic action=import` (#372).
 */

/** Function body limit on Vercel; a larger file goes via chat (`bcf_topic action=import` with url). */
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

/** `BCF_IMPORT` message after shape validation; null = invalid (nothing is sent). */
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

/** Import summary (ImportSummary from lib/bcf/import) narrowed to what the viewer shows; topics are not sent individually. */
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
