import { createHash } from "node:crypto";

/**
 * Register IDS, ktoré smie motor overovať (D-084). IDS sa do repa nekopíruje
 * (D-081) - server ho stiahne z URL v env `IDS_SOURCES`, JSON
 * `{"<id>": "<https URL>"}` (napr. publikovaný súbor knižnice na pevnom
 * commite). Bez premennej register je prázdny a `ifc_ids_validate` to povie.
 * Odkiaľ má IDS presne prichádzať, je otvorená otázka D-084.
 */

export interface IdsSource {
  id: string;
  url: string;
}

export function idsSources(env: Record<string, string | undefined> = process.env): IdsSource[] {
  const raw = env.IDS_SOURCES?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === "string" && /^https:\/\//.test(e[1]))
    .map(([id, url]) => ({ id, url }));
}

export interface LoadedIds {
  id: string;
  url: string;
  xml: string;
  sha256: string;
}

const cache = new Map<string, LoadedIds>();

export async function loadIds(src: IdsSource, fetchImpl: typeof fetch = fetch): Promise<LoadedIds> {
  const hit = cache.get(src.url);
  if (hit) return hit;
  const res = await fetchImpl(src.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`IDS ${src.id} sa nepodarilo stiahnuť (${res.status})`);
  const xml = await res.text();
  const loaded = { ...src, xml, sha256: createHash("sha256").update(xml).digest("hex") };
  cache.set(src.url, loaded);
  return loaded;
}
