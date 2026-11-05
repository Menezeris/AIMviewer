import type { RevisionSource } from "../engine/revisions";

/**
 * Signature of the clash run input (D-183 point 11, K1/K4): `{model: revision}` the run was actually
 * run over, and whether it is stale against the current revisions (`model_revisions.is_current`). The same
 * logic as the DB function `revisions_stale` in the `v_clash_*` views: unknown signature = `null`,
 * not `true` (staleness is not reported without evidence).
 */
export type RevisionStamp = Record<string, number>;

const asRevision = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const r = (v as { revision?: unknown } | null | undefined)?.revision;
  return typeof r === "number" && Number.isInteger(r) ? r : undefined;
};

/**
 * Run signature: the stored `model_revisions` (K1) takes precedence; otherwise from the engine `models`
 * (`{model: {etag, size, loaded_at, revision?}}` or `{model: number}`). Empty = null.
 */
export function stampOf(models: Record<string, unknown> | null | undefined, stored?: unknown): RevisionStamp | null {
  const out: RevisionStamp = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [m, v] of Object.entries(stored as Record<string, unknown>)) {
      const r = asRevision(v);
      if (r !== undefined) out[m] = r;
    }
  }
  if (Object.keys(out).length === 0) {
    for (const [m, v] of Object.entries(models ?? {})) {
      const r = asRevision(v);
      if (r !== undefined) out[m] = r;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Current model revisions; null when there is no source or it fails (the status is then not reported). */
export async function currentRevisions(models: string[], source: RevisionSource | undefined): Promise<RevisionStamp | null> {
  if (!source || models.length === 0) return null;
  try {
    const rows = await source(models, 1);
    const out: RevisionStamp = {};
    for (const r of rows) if (r.is_current) out[r.model] = r.revision;
    return out;
  } catch {
    return null;
  }
}

/** true = some model of the run has a different current revision today; null = signature or current state unknown. */
export function staleOf(basedOn: RevisionStamp | null, current: RevisionStamp | null): boolean | null {
  if (!basedOn || !current) return null;
  return Object.entries(basedOn).some(([m, r]) => current[m] !== r);
}

const vnnn = (n: number) => `v${String(n).padStart(3, "0")}`;

/** "ASR v078 -> v079, VZT v009 -> v011" for models whose revision differs. */
export function describeDrift(basedOn: RevisionStamp, current: RevisionStamp): string {
  return Object.entries(basedOn)
    .filter(([m, r]) => current[m] !== r)
    .map(([m, r]) => `${m} ${vnnn(r)} -> ${current[m] === undefined ? "bez aktuálnej revízie" : vnnn(current[m])}`)
    .join(", ");
}

/** Tool output fields: `based_on`, `stale` and, when stale, `stale_note`; nothing without a signature. */
export function revisionFields(basedOn: RevisionStamp | null, current: RevisionStamp | null): Record<string, unknown> {
  if (!basedOn) return {};
  const stale = staleOf(basedOn, current);
  return {
    based_on: basedOn,
    ...(stale === null ? {} : { stale }),
    ...(stale && current
      ? { stale_note: `Beh je nad staršou revíziou (${describeDrift(basedOn, current)}): výsledok platí pre ňu, nie pre aktuálny model. Spusti test znova (run save=true).` }
      : {}),
  };
}
