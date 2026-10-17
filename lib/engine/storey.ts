/**
 * Podlažie podľa štítku AIM (D-049) -> GlobalId podlažia v konkrétnom modeli.
 *
 * Modely federácie majú vlastné podlažia s vlastnými GUID (ASR `2NP`, VZT
 * `2NP_VZT`), DB nesie len GUID podlažia ASR. Motor preto podlažie hľadá v
 * samotnom modeli podľa normalizovaného mena: veľké písmená, bez medzier a
 * bodiek, bez prípony za podčiarkovníkom (`3. NP` = `3.NP` = `3NP` = `3NP_VZT`).
 */

export function normalizeStoreyLabel(raw: string): string {
  return raw.toUpperCase().split("_")[0].replace(/[\s.]/g, "");
}

export interface StoreyCandidate {
  globalId: string;
  name: string;
}

/** GlobalId podlažia s rovnakým normalizovaným menom, alebo null. */
export function resolveStorey(label: string, storeys: StoreyCandidate[]): string | null {
  const want = normalizeStoreyLabel(label);
  if (!want) return null;
  const hit = storeys.find((s) => normalizeStoreyLabel(s.name) === want);
  return hit?.globalId ?? null;
}
