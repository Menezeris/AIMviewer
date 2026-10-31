import "server-only";

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";

/**
 * Data-access vrstva pre asset kartu (S2) — jadro previazanosti.
 *
 * Dedičnosť type→occurrence (D-021) je zapuzdrená vo `v_asset_effective`
 * (predefined_type, user_defined_type, type väzba). `properties` ale view
 * vracia už zmergované — pôvod (vlastné / zdedené / prepísané) by sa stratil,
 * preto popri view načítame raw `properties` typu aj occurrence a provenance
 * dopočítame v TS (rozhodnutie D-028). Klasifikácie čítame z `v_asset_classifications`
 * (union faset type+occurrence, D-023). Všetko server-side cez `service_role` (D-026).
 */

export type Provenance = "own" | "inherited" | "overridden";

/** Jedna položka property setu + odkiaľ jej hodnota pochádza. */
export interface PropertyEntry {
  key: string;
  value: unknown;
  provenance: Provenance;
  /** Pôvodná hodnota z typu — len pri `overridden`. */
  typeValue?: unknown;
}

/** Property set zoskupený podľa názvu; `standard` = názov `Pset_`/`Qto_` (D-022). */
export interface PropertySetGroup {
  name: string;
  standard: boolean;
  entries: PropertyEntry[];
}

/** Jedna klasifikačná faseta + úroveň (type = zdedená, occurrence = vlastná). */
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
  /** Efektívny PredefinedType + či bol zdedený z typu (D-021). */
  predefinedType: { value: string | null; inherited: boolean };
  userDefinedType: string | null;
  /** Odkaz na asset_type (väzba `rel_defines_by_type`) alebo `null`. */
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
  /** Zdieľané psety typu — všetko `own` (provenance sa na type stránke neukazuje). */
  propertySets: PropertySetGroup[];
  /** Vlastné klasifikácie typu (každú zdedí jeho occurrence). */
  classifications: ClassificationFacet[];
  /** Occurrence assety definované týmto typom. */
  occurrences: TypeRef[];
}

type PropertyBag = Record<string, unknown>;

/** Psety nikdy nezačínajú `_` (rezervované meta kľúče, D-022). */
const isPsetName = (n: string) => !n.startsWith("_");
/** Štandardný buildingSMART pset má prefix `Pset_`/`Qto_` (D-022). */
const isStandardPset = (n: string) => n.startsWith("Pset_") || n.startsWith("Qto_");

const asBag = (v: unknown): PropertyBag =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as PropertyBag) : {};

/**
 * Zostaví property sety z raw `properties` typu a occurrence a označí pôvod
 * každej hodnoty. Pre type stránku sa volá s prázdnym `typeProps` → všetko `own`.
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

  // Štandardné psety prv, custom potom; v rámci skupiny abecedne.
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

/** Načíta klasifikačné referencie + názvy systémov pre dané ref id. */
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

/** Efektívne klasifikácie occurrence (union vlastných + zdedených, D-023). */
async function fetchAssetClassifications(
  supabase: SupabaseClient,
  id: string
): Promise<ClassificationFacet[]> {
  const { data: rows, error } = await supabase
    .from("v_asset_classifications")
    .select("classification_ref_id, level")
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

  // Vlastné (occurrence) hore, zdedené (type) dole; v rámci podľa kódu.
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
 * Detail assetu (occurrence): efektívne atribúty, property sety s provenance,
 * väzba na type a union klasifikácií. `null`, ak `id` nie je `object_type='asset'`.
 */
async function fetchAssetImpl(id: string): Promise<AssetDetail | null> {
  const supabase = getSupabaseAdmin();

  // Effective view, raw occurrence a klasifikácie sú navzájom nezávislé →
  // spustíme ich paralelne (jeden round-trip namiesto troch za sebou).
  const [effRes, occRes, classifications] = await Promise.all([
    supabase
      .from("v_asset_effective")
      .select(
        "id, object_ref, name, ifc_type, predefined_type, user_defined_type, type_id, type_name"
      )
      .eq("id", id)
      .limit(1),
    supabase
      .from("objects")
      .select("ifc_guid, predefined_type, properties")
      .eq("id", id)
      .limit(1),
    fetchAssetClassifications(supabase, id),
  ]);

  // Effective view — zapuzdruje dedičnosť (D-021). Žiadny riadok = nie je asset.
  if (effRes.error) throw new Error(effRes.error.message);
  const eff = (effRes.data?.[0] ?? null) as EffRow | null;
  if (!eff) return null;

  // Raw occurrence — ifc_guid (vo view nie je) + raw properties pre provenance.
  if (occRes.error) throw new Error(occRes.error.message);
  const occ = (occRes.data?.[0] ?? null) as {
    ifc_guid: string | null;
    predefined_type: string | null;
    properties: PropertyBag | null;
  } | null;

  // Raw type — zdieľané properties (závisí od eff.type_id → až po effective view).
  let typeProps: PropertyBag = {};
  let typeRef: TypeRef | null = null;
  if (eff.type_id) {
    const { data: typeRows, error: typeErr } = await supabase
      .from("objects")
      .select("id, object_ref, name, properties")
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

  // PredefinedType: efektívna hodnota z view; zdedená, ak occurrence vlastnú nemá.
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
 * Detail asset_type: zdieľané atribúty/psety, vlastné klasifikácie a zoznam
 * occurrence, ktoré ho používajú. `null`, ak `id` nie je `object_type='asset_type'`.
 */
async function fetchAssetTypeImpl(id: string): Promise<AssetTypeDetail | null> {
  const supabase = getSupabaseAdmin();

  // Hlavný riadok, klasifikačné väzby aj occurrence väzby závisia len od `id`
  // → jedna paralelná vlna namiesto troch sekvenčných round-tripov.
  const [rowsRes, clsRes, occRelsRes] = await Promise.all([
    supabase
      .from("objects")
      .select(
        "id, object_ref, name, ifc_type, ifc_guid, predefined_type, user_defined_type, properties"
      )
      .eq("id", id)
      .eq("object_type", "asset_type")
      .limit(1),
    supabase
      .from("rel_associates_classification")
      .select("to_id")
      .eq("from_id", id)
      .is("valid_until", null)
      .not("to_id", "is", null),
    supabase
      .from("rel_defines_by_type")
      .select("from_id")
      .eq("to_id", id)
      .is("valid_until", null)
      .not("from_id", "is", null), // výskyt bez uzla AIM (D-183 K3)
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

  // Typ nemá nad sebou vrstvu → všetko `own` (typeProps prázdne).
  const propertySets = buildPropertySets({}, asBag(t.properties));

  const occIds = [...new Set((occRelsRes.data ?? []).map((r) => r.from_id as string))];

  // Detaily referencií (klasifikácie) a occurrence objekty — druhá paralelná vlna.
  const [refMap, occObjs] = await Promise.all([
    loadRefs(supabase, [
      ...new Set((clsRes.data ?? []).map((r) => r.to_id as string)),
    ]),
    occIds.length
      ? supabase
          .from("objects")
          .select("id, object_ref, name")
          .in("id", occIds)
          .then(({ data, error: e }) => {
            if (e) throw new Error(e.message);
            return data ?? [];
          })
      : Promise.resolve([]),
  ]);

  // Vlastné klasifikácie typu (level 'type' — zdedí ich každá occurrence).
  const classifications: ClassificationFacet[] = [...refMap.values()]
    .map((r) => ({ ...r, level: "type" as const }))
    .sort((a, b) => a.identification.localeCompare(b.identification));

  // Occurrence definované týmto typom (aktívne väzby).
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

/** Detail assetu (occurrence) — cachované per id (ISR, D-029 perf). */
export const fetchAsset = unstable_cache(fetchAssetImpl, ["fetch-asset"], AIM_CACHE);

/** Detail asset_type — cachované per id (ISR, D-029 perf). */
export const fetchAssetType = unstable_cache(
  fetchAssetTypeImpl,
  ["fetch-asset-type"],
  AIM_CACHE
);
