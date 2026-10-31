import type { RevisionSource } from "../engine/revisions";

/**
 * Podpis vstupu behu clash (D-183 bod 11, K1/K4): `{model: revízia}`, nad ktorými beh naozaj
 * bežal, a či je zastaraný voči aktuálnym revíziám (`model_revisions.is_current`). Rovnaká
 * logika ako DB funkcia `revisions_stale` v pohľadoch `v_clash_*`: neznámy podpis = `null`,
 * nie `true` (zastaranie sa nehlási bez dôkazu).
 */
export type RevisionStamp = Record<string, number>;

const asRevision = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const r = (v as { revision?: unknown } | null | undefined)?.revision;
  return typeof r === "number" && Number.isInteger(r) ? r : undefined;
};

/**
 * Podpis behu: uložený `model_revisions` (K1) má prednosť; inak z `models` motora
 * (`{model: {etag, size, loaded_at, revision?}}` alebo `{model: číslo}`). Prázdny = null.
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

/** Aktuálne revízie modelov; null, keď zdroj nie je alebo zlyhá (stav sa potom nehlási). */
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

/** true = niektorý model behu má dnes inú aktuálnu revíziu; null = podpis alebo aktuálny stav neznámy. */
export function staleOf(basedOn: RevisionStamp | null, current: RevisionStamp | null): boolean | null {
  if (!basedOn || !current) return null;
  return Object.entries(basedOn).some(([m, r]) => current[m] !== r);
}

const vnnn = (n: number) => `v${String(n).padStart(3, "0")}`;

/** "ASR v078 -> v079, VZT v009 -> v011" pre modely, ktorých revízia sa líši. */
export function describeDrift(basedOn: RevisionStamp, current: RevisionStamp): string {
  return Object.entries(basedOn)
    .filter(([m, r]) => current[m] !== r)
    .map(([m, r]) => `${m} ${vnnn(r)} -> ${current[m] === undefined ? "bez aktuálnej revízie" : vnnn(current[m])}`)
    .join(", ");
}

/** Polia výstupu toolu: `based_on`, `stale` a pri zastaraní `stale_note`; bez podpisu nič. */
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
