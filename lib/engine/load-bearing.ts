/**
 * Load-bearing property of an element (`Pset_*Common.LoadBearing`) for the clash test side filter (D-164, addendum 2026-10-31, #292).
 * The value is taken from the occurrence and if the occurrence lacks it, from its type (IfcRelDefinesByType, inheritance as D-021). An element without a value
 * on both the occurrence and the type is "unknown" (`null`), it is never considered load-bearing or non-load-bearing.
 */
import { extractPropertiesOnDemand, extractTypePropertiesOnDemand, type IfcDataStore } from "@ifc-lite/parser";

export const LOAD_BEARING_FILTERS = ["true", "false", "unknown"] as const;
/** true = only load-bearing, false = only explicitly non-load-bearing, unknown = no value (neither occurrence nor type has it). */
export type LoadBearingFilter = (typeof LOAD_BEARING_FILTERS)[number];

export type LoadBearingSource = "occurrence" | "type";
export interface LoadBearingInfo {
  value: boolean | null;
  source: LoadBearingSource | null;
}

type Sets = Array<{ name: string; properties: Array<{ name: string; value: unknown }> }>;

/** IFC boolean in various parser shapes: true, ".T.", "TRUE", "True", 1; unrecognized = unknown. */
export function parseBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  if (s === "true" || s === "t" || s === "yes") return true;
  if (s === "false" || s === "f" || s === "no") return false;
  return null;
}

/** `LoadBearing` from sets: standard `Pset_*Common` take precedence over custom ones (e.g. AIM_StairFlight). */
export function loadBearingFromSets(sets: Sets): boolean | null {
  const hits = sets
    .map((s) => ({ common: /^Pset_.*Common$/.test(s.name), value: parseBoolean(s.properties.find((p) => p.name === "LoadBearing")?.value) }))
    .filter((h) => h.value !== null);
  return (hits.find((h) => h.common) ?? hits[0])?.value ?? null;
}

/** Occurrence, then type; a pset read error = unknown (the filter neither lets the element through nor drops it). */
export function loadBearingOf(store: IfcDataStore, expressId: number): LoadBearingInfo {
  try {
    const own = loadBearingFromSets(extractPropertiesOnDemand(store, expressId) as Sets);
    if (own !== null) return { value: own, source: "occurrence" };
    const type = extractTypePropertiesOnDemand(store, expressId);
    const inherited = type ? loadBearingFromSets(type.properties as Sets) : null;
    return inherited !== null ? { value: inherited, source: "type" } : { value: null, source: null };
  } catch {
    return { value: null, source: null };
  }
}

export function matchesLoadBearing(value: boolean | null, filter: LoadBearingFilter): boolean {
  return filter === "true" ? value === true : filter === "false" ? value === false : value === null;
}

export function parseLoadBearingFilter(raw: unknown): LoadBearingFilter | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = typeof raw === "boolean" ? String(raw) : typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if ((LOAD_BEARING_FILTERS as readonly string[]).includes(s)) return s as LoadBearingFilter;
  return undefined;
}
