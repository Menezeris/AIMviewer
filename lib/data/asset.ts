import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cachedProjectRead } from "@/lib/data/revalidate";

/**
 * Data-access layer for the asset card (S2) - the core of interlinking.
 *
 * Type->occurrence inheritance (D-021) is encapsulated in `v_asset_effective`
 * (predefined_type, user_defined_type, type link). However, the view returns
 * `properties` already merged - the origin (own / inherited / overridden) would be lost,
 * so besides the view we load the raw `properties` of the type and the occurrence and
 * compute provenance in TS (decision D-028). Classifications are read from `v_asset_classifications`
 * (facet union of type+occurrence, D-023). All server-side via `service_role` (D-026).
 */

export type Provenance = "own" | "inherited" | "overridden";

/** One property set item + where its value comes from. */
export interface PropertyEntry {
  key: string;
  value: unknown;
  provenance: Provenance;
  /** Original value from the type - only when `overridden`. */
  typeValue?: unknown;
}

/** Property set grouped by name; `standard` = name is `Pset_`/`Qto_` (D-022). */
export interface PropertySetGroup {
  name: string;
  standard: boolean;
  entries: PropertyEntry[];
}

/** One classification facet + level (type = inherited, occurrence = own). */
export interface ClassificationFacet {
  refId: string;
  identification: string;
  name: string | null;
  location: string | null;
  systemName: string;
  level: "type" | "occurrence";
}

export interface TypeRef {
  id: string;
  name: string | null;
  object_ref: string | null;
}

export interface AssetDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  /** Effective PredefinedType + whether it was inherited from the type (D-021). */
  predefinedType: { value: string | null; inherited: boolean };
  userDefinedType: string | null;
  /** Reference to asset_type (link `rel_defines_by_type`) or `null`. */
  type: TypeRef | null;
  propertySets: PropertySetGroup[];
  classifications: ClassificationFacet[];
}

export interface AssetTypeDetail {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefinedType: string | null;
  userDefinedType: string | null;
  /** Shared psets of the type - all `own` (provenance is not shown on the type page). */
  propertySets: PropertySetGroup[];
  /** Own classifications of the type (each is inherited by its occurrence). */
  classifications: ClassificationFacet[];
  /** Occurrence assets defined by this type. */
  occurrences: TypeRef[];
}

type PropertyBag = Record<string, unknown>;

/** Psets never start with `_` (reserved meta keys, D-022). */
const isPsetName = (n: string) => !n.startsWith("_");
/** A standard buildingSMART pset has the prefix `Pset_`/`Qto_` (D-022). */
const isStandardPset = (n: string) => n.startsWith("Pset_") || n.startsWith("Qto_");

const asBag = (v: unknown): PropertyBag =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as PropertyBag) : {};

/**
 * Builds property sets from the raw `properties` of the type and the occurrence and marks the origin
 * of each value. For the type page it is called with empty `typeProps` -> all `own`.
 */
function buildPropertySets(
  typeProps: PropertyBag,
  occProps: PropertyBag
): PropertySetGroup[] {
  const psetNames = new Set<string>();
  for (const n of Object.keys(typeProps)) if (isPsetName(n)) psetNames.add(n);
  for (const n of Object.keys(occProps)) if (isPsetName(n)) psetNames.add(n);

  const groups: PropertySetGroup[] = [];
  for (const pset of psetNames) {
    const t = asBag(typeProps[pset]);
    const o = asBag(occProps[pset]);
    const keys = [...new Set([...Object.keys(t), ...Object.keys(o)])].sort((a, b) =>
      a.localeCompare(b)
    );

    const entries: PropertyEntry[] = keys.map((k) => {
      const inType = k in t;
      const inOcc = k in o;
      if (inOcc && inType) {
        const same = JSON.stringify(o[k]) === JSON.stringify(t[k]);
        return same
          ? { key: k, value: o[k], provenance: "inherited" }
          : { key: k, value: o[k], provenance: "overridden", typeValue: t[k] };
      }
      if (inOcc) return { key: k, value: o[k], provenance: "own" };
      return { key: k, value: t[k], provenance: "inherited" };
    });

    groups.push({ name: pset, standard: isStandardPset(pset), entries });
  }

  // Standard psets first, then custom; alphabetical within a group.
  groups.sort((a, b) => {
    if (a.standard !== b.standard) return a.standard ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return groups;
}

interface RefRow {
  id: string;
  identification: string;
  name: string | null;
  location: string | null;
  system_id: string;
}

/** Loads classification references + system names for the given ref ids. */
async function loadRefs(
  supabase: SupabaseClient,
  refIds: string[]
): Promise<Map<string, Omit<ClassificationFacet, "level">>> {
  const out = new Map<string, Omit<ClassificationFacet, "level">>();
  if (refIds.length === 0) return out;

  const { data: refs, error } = await supabase
    .from("classification_references")
    .select("id, identification, name, location, system_id")
    .in("id", refIds);
  if (error) throw new Error(error.message);

  const refRows = (refs ?? []) as RefRow[];
  const systemIds = [...new Set(refRows.map((r) => r.system_id))];

  const { data: systems, error: sysErr } = await supabase
    .from("classification_systems")
    .select("id, name")
    .in("id", systemIds);
  if (sysErr) throw new Error(sysErr.message);

  const sysName = new Map<string, string>(
    (systems ?? []).map((s) => [s.id as string, (s.name as string | null) ?? "—"])
  );

  for (const r of refRows) {
    out.set(r.id, {
      refId: r.id,
      identification: r.identification,
      name: r.name ?? null,
      location: r.location ?? null,
      systemName: sysName.get(r.system_id) ?? "—",
    });
  }
  return out;
}

/** Effective classifications of an occurrence (union of own + inherited, D-023). */
async function fetchAssetClassifications(
  projectId: string,
  supabase: SupabaseClient,
  id: string
): Promise<ClassificationFacet[]> {
  const { data: rows, error } = await supabase
    .from("v_asset_classifications")
    .select("classification_ref_id, level")
    .eq("project_id", projectId)
    .eq("object_id", id);
  if (error) throw new Error(error.message);

  const clsRows = (rows ?? []) as { classification_ref_id: string; level: "type" | "occurrence" }[];
  const refMap = await loadRefs(supabase, [
    ...new Set(clsRows.map((r) => r.classification_ref_id)),
  ]);

  const facets: ClassificationFacet[] = [];
  for (const row of clsRows) {
    const ref = refMap.get(row.classification_ref_id);
    if (ref) facets.push({ ...ref, level: row.level });
  }

  // Own (occurrence) on top, inherited (type) below; by code within each.
  facets.sort((a, b) => {
    if (a.level !== b.level) return a.level === "occurrence" ? -1 : 1;
    return a.identification.localeCompare(b.identification);
  });
  return facets;
}

interface EffRow {
  id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  predefined_type: string | null;
  user_defined_type: string | null;
  type_id: string | null;
  type_name: string | null;
}

/**
 * Asset (occurrence) detail: effective attributes, property sets with provenance,
 * type link and union of classifications. `null` if `id` is not `object_type='asset'`.
 */
async function fetchAssetImpl(projectId: string, id: string): Promise<AssetDetail | null> {
  const supabase = getSupabaseAdmin();

  // The effective view, raw occurrence and classifications are independent of each other ->
  // run them in parallel (one round-trip instead of three in a row).
  const [effRes, occRes, classifications] = await Promise.all([
    supabase
      .from("v_asset_effective")
      .select(
        "id, object_ref, name, ifc_type, predefined_type, user_defined_type, type_id, type_name"
      )
      .eq("project_id", projectId)
      .eq("id", id)
      .limit(1),
    supabase
      .from("objects")
      .select("ifc_guid, predefined_type, properties")
      .eq("project_id", projectId)
      .eq("id", id)
      .limit(1),
    fetchAssetClassifications(projectId, supabase, id),
  ]);

  // Effective view - encapsulates inheritance (D-021). No row = not an asset.
  if (effRes.error) throw new Error(effRes.error.message);
  const eff = (effRes.data?.[0] ?? null) as EffRow | null;
  if (!eff) return null;

  // Raw occurrence - ifc_guid (not in the view) + raw properties for provenance.
  if (occRes.error) throw new Error(occRes.error.message);
  const occ = (occRes.data?.[0] ?? null) as {
    ifc_guid: string | null;
    predefined_type: string | null;
    properties: PropertyBag | null;
  } | null;

  // Raw type - shared properties (depends on eff.type_id -> only after the effective view).
  let typeProps: PropertyBag = {};
  let typeRef: TypeRef | null = null;
  if (eff.type_id) {
    const { data: typeRows, error: typeErr } = await supabase
      .from("objects")
      .select("id, object_ref, name, properties")
      .eq("project_id", projectId)
      .eq("id", eff.type_id)
      .limit(1);
    if (typeErr) throw new Error(typeErr.message);
    const t = (typeRows?.[0] ?? null) as {
      id: string;
      object_ref: string | null;
      name: string | null;
      properties: PropertyBag | null;
    } | null;
    if (t) {
      typeProps = asBag(t.properties);
      typeRef = { id: t.id, name: t.name ?? null, object_ref: t.object_ref ?? null };
    }
  }

  const propertySets = buildPropertySets(typeProps, asBag(occ?.properties));

  // PredefinedType: effective value from the view; inherited if the occurrence has none of its own.
  const occPredef = occ?.predefined_type ?? null;
  const predefinedInherited =
    !!eff.type_id &&
    eff.predefined_type != null &&
    (occPredef == null || occPredef === "NOTDEFINED");

  return {
    id: eff.id,
    object_ref: eff.object_ref,
    name: eff.name,
    ifc_type: eff.ifc_type,
    ifc_guid: occ?.ifc_guid ?? null,
    predefinedType: { value: eff.predefined_type, inherited: predefinedInherited },
    userDefinedType: eff.user_defined_type,
    type: typeRef,
    propertySets,
    classifications,
  };
}

/**
 * Asset_type detail: shared attributes/psets, own classifications and the list of
 * occurrences that use it. `null` if `id` is not `object_type='asset_type'`.
 */
async function fetchAssetTypeImpl(projectId: string, id: string): Promise<AssetTypeDetail | null> {
  const supabase = getSupabaseAdmin();

  // The main row, classification links and occurrence links depend only on `id`
  // -> one parallel wave instead of three sequential round-trips.
  const [rowsRes, clsRes, occRelsRes] = await Promise.all([
    supabase
      .from("objects")
      .select(
        "id, object_ref, name, ifc_type, ifc_guid, predefined_type, user_defined_type, properties"
      )
      .eq("project_id", projectId)
      .eq("id", id)
      .eq("object_type", "asset_type")
      .limit(1),
    supabase
      .from("rel_associates_classification")
      .select("to_id")
      .eq("project_id", projectId)
      .eq("from_id", id)
      .is("valid_until", null)
      .not("to_id", "is", null),
    supabase
      .from("rel_defines_by_type")
      .select("from_id")
      .eq("project_id", projectId)
      .eq("to_id", id)
      .is("valid_until", null)
      .not("from_id", "is", null), // occurrence without an AIM node (D-183 K3)
  ]);
  if (rowsRes.error) throw new Error(rowsRes.error.message);
  const t = (rowsRes.data?.[0] ?? null) as {
    id: string;
    object_ref: string | null;
    name: string | null;
    ifc_type: string | null;
    ifc_guid: string | null;
    predefined_type: string | null;
    user_defined_type: string | null;
    properties: PropertyBag | null;
  } | null;
  if (!t) return null;

  if (clsRes.error) throw new Error(clsRes.error.message);
  if (occRelsRes.error) throw new Error(occRelsRes.error.message);

  // The type has no layer above it -> all `own` (typeProps empty).
  const propertySets = buildPropertySets({}, asBag(t.properties));

  const occIds = [...new Set((occRelsRes.data ?? []).map((r) => r.from_id as string))];

  // Reference details (classifications) and occurrence objects - second parallel wave.
  const [refMap, occObjs] = await Promise.all([
    loadRefs(supabase, [
      ...new Set((clsRes.data ?? []).map((r) => r.to_id as string)),
    ]),
    occIds.length
      ? supabase
          .from("objects")
          .select("id, object_ref, name")
          .eq("project_id", projectId)
          .in("id", occIds)
          .then(({ data, error: e }) => {
            if (e) throw new Error(e.message);
            return data ?? [];
          })
      : Promise.resolve([]),
  ]);

  // Own classifications of the type (level 'type' - each occurrence inherits them).
  const classifications: ClassificationFacet[] = [...refMap.values()]
    .map((r) => ({ ...r, level: "type" as const }))
    .sort((a, b) => a.identification.localeCompare(b.identification));

  // Occurrences defined by this type (active links).
  const occurrences: TypeRef[] = occObjs
    .map((o) => ({
      id: o.id as string,
      name: (o.name as string | null) ?? null,
      object_ref: (o.object_ref as string | null) ?? null,
    }))
    .sort((a, b) =>
      (a.object_ref ?? a.name ?? "").localeCompare(b.object_ref ?? b.name ?? "")
    );

  return {
    id: t.id,
    object_ref: t.object_ref ?? null,
    name: t.name ?? null,
    ifc_type: t.ifc_type ?? null,
    ifc_guid: t.ifc_guid ?? null,
    predefinedType: t.predefined_type ?? null,
    userDefinedType: t.user_defined_type ?? null,
    propertySets,
    classifications,
    occurrences,
  };
}

/** Asset (occurrence) detail - cached per id (ISR, D-029 perf). */
export const fetchAsset = cachedProjectRead("fetch-asset", fetchAssetImpl);

/** Asset_type detail - cached per id (ISR, D-029 perf). */
export const fetchAssetType = cachedProjectRead("fetch-asset-type", fetchAssetTypeImpl);
