/**
 * Storey by AIM label (D-049) -> GlobalId of the storey in a specific model.
 *
 * Federation models have their own storeys with their own GUIDs (ASR `2NP`, VZT
 * `2NP_VZT`), the DB carries only the GUID of the ASR storey. The engine therefore looks for the storey in
 * the model itself by the normalized name: upper case, without spaces and
 * dots, without the suffix after the underscore (`3. NP` = `3.NP` = `3NP` = `3NP_VZT`).
 */

export function normalizeStoreyLabel(raw: string): string {
  return raw.toUpperCase().split("_")[0].replace(/[\s.]/g, "");
}

export interface StoreyCandidate {
  globalId: string;
  name: string;
}

/** GlobalId of a storey with the same normalized name, or null. */
export function resolveStorey(label: string, storeys: StoreyCandidate[]): string | null {
  const want = normalizeStoreyLabel(label);
  if (!want) return null;
  const hit = storeys.find((s) => normalizeStoreyLabel(s.name) === want);
  return hit?.globalId ?? null;
}
