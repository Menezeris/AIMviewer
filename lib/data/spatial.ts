import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AIM_CACHE } from "@/lib/data/constants";
import { fetchAllPages } from "@/lib/data/pagination";

/**
 * Data-access vrstva pre priestorovú hierarchiu (S1).
 *
 * Číta `objects` + aktívne spatial hrany (`rel_aggregates` +
 * `rel_contained_in_spatial_structure`, D-048) a poskladá strom
 * Site → Building → Floor → Space → Asset (D-018, D-021). `asset_type` sa tu
 * NIKDY nevyskytuje (type nemá polohu).
 *
 * Pri ~15 uzloch načítame celý graf jedným ťahom a poskladáme ho v pamäti —
 * žiadna rekurzia v DB. Všetko beží server-side cez `service_role` (D-026).
 */

export const SPATIAL_TYPES = [
  "site",
  "building",
  "floor",
  "space",
  "asset",
] as const;

export type SpatialType = (typeof SPATIAL_TYPES)[number];

/** Surový riadok z `objects` (podmnožina stĺpcov, ktorú Viewer potrebuje). */
export interface ObjectRow {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
  elevation: number | null; // len floor (z prípony `floors`)
}

/** Uzol stromu — `ObjectRow` + potomkovia. */
export interface SpatialNode extends ObjectRow {
  children: SpatialNode[];
}

/** Skrátený odkaz na uzol (breadcrumb, zoznam assetov). */
export interface NodeRef {
  id: string;
  object_type: SpatialType;
  object_ref: string | null;
  name: string | null;
}

interface Graph {
  byId: Map<string, ObjectRow>;
  /** to_id (rodič) → from_id[] (deti) */
  childrenOf: Map<string, string[]>;
  /** from_id (dieťa) → to_id (rodič) */
  parentOf: Map<string, string>;
}

interface RawSpatialObject {
  id: string;
  object_type: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  ifc_guid: string | null;
  predefined_type: string | null;
}

/**
 * Načíta všetky priestorové objekty stránkovane (obchádza Supabase `db-max-rows`
 * limit 1000). Stabilné poradie cez `order(id)` — nutné pre správne stránkovanie.
 */
function loadSpatialObjects(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<RawSpatialObject[]> {
  return fetchAllPages<RawSpatialObject>((from, to) =>
    supabase
      .from("objects")
      .select(
        "id, object_type, object_ref, name, ifc_type, ifc_guid, predefined_type"
      )
      .in("object_type", SPATIAL_TYPES as unknown as string[])
      .is("valid_until", null) // zaniknuté objekty (D-087)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

/** Aktívna spatial hrana `from_id (dieťa) → to_id (rodič)`. */
interface RawEdge {
  from_id: string;
  to_id: string;
}

/**
 * Načíta všetky aktívne hrany jednej spatial view stránkovane — hrán je po
 * federácii VZT tiež > 1000 (každý asset má containment hranu) a PostgREST
 * by ich bez stránkovania ticho orezal: prvky nad limit by prišli o rodiča
 * a vypadli by zo stromu (parentless assety sa vynechávajú).
 */
function loadSpatialEdges(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  view: "rel_aggregates" | "rel_contained_in_spatial_structure"
): Promise<RawEdge[]> {
  return fetchAllPages<RawEdge>((from, to) =>
    supabase
      .from(view)
      .select("from_id, to_id")
      .is("valid_until", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
}

/** Serializovateľná podoba grafu pre `unstable_cache` (Mapy JSON neprežijú). */
interface GraphData {
  objects: ObjectRow[];
  /** Aktívne spatial hrany `[from_id (dieťa), to_id (rodič)]`. */
  edges: [string, string][];
}

/**
 * Načíta celý priestorový graf jedným setom dotazov a cachuje ho ako **jeden
 * zdieľaný záznam** (ISR, tag `aim`). Kľúčové pre rýchlosť preklikávania:
 * strom v layoute aj detail ľubovoľného uzla čerpajú z toho istého cache
 * záznamu, takže prvý klik na nový uzol už nespúšťa žiadne DB dotazy na graf
 * (predtým bol `fetchNode` cachovaný per-id → každý nový uzol = celý graf znova).
 */
const loadGraphData = unstable_cache(async (): Promise<GraphData> => {
  const supabase = getSupabaseAdmin();

  const [objectRows, aggEdges, containedEdges, floorsRes, spacesRes] = await Promise.all([
    // Priestorové objekty stránkovane — Supabase capuje odpoveď na 1000 riadkov
    // (`db-max-rows`), a assetov je po federácii VZT (D-049) > 1000. Bez stránkovania
    // by sa prvky nad limit stratili z grafu (fetchNode → 404).
    loadSpatialObjects(supabase),
    // Spatial väzby IFC-kanonicky (D-048): dekompozícia štruktúry (rel_aggregates)
    // + umiestnenie prvku (rel_contained_in_spatial_structure). Len aktívne
    // (valid_until IS NULL) — partial-unique na oboch garantuje 1 rodiča na dieťa.
    // Tiež stránkovane (hrán je rovnako veľa ako prvkov).
    loadSpatialEdges(supabase, "rel_aggregates"),
    loadSpatialEdges(supabase, "rel_contained_in_spatial_structure"),
    supabase.from("floors").select("id, elevation"),
    supabase.from("spaces").select("id, long_name"),
  ]);

  if (floorsRes.error) throw new Error(floorsRes.error.message);
  if (spacesRes.error) throw new Error(spacesRes.error.message);

  const elevationById = new Map<string, number | null>(
    (floorsRes.data ?? []).map((f) => [f.id as string, f.elevation as number | null])
  );
  const longNameById = new Map<string, string | null>(
    (spacesRes.data ?? []).map((s) => [s.id as string, s.long_name as string | null])
  );

  const byId = new Map<string, ObjectRow>();
  for (const o of objectRows) {
    const id = o.id as string;
    const rawName = (o.name as string | null) ?? null;
    // Priestor: zobraz "číslo — popis funkcie" (D-040). Name = číslo (IfcSpace.Name),
    // long_name = IfcSpace.LongName z prípony `spaces`.
    const longName = longNameById.get(id) ?? null;
    const displayName =
      o.object_type === "space" && longName && rawName
        ? `${rawName} — ${longName}`
        : rawName;
    byId.set(id, {
      id,
      object_type: o.object_type as SpatialType,
      object_ref: (o.object_ref as string | null) ?? null,
      name: displayName,
      ifc_type: (o.ifc_type as string | null) ?? null,
      ifc_guid: (o.ifc_guid as string | null) ?? null,
      predefined_type: (o.predefined_type as string | null) ?? null,
      elevation: elevationById.get(id) ?? null,
    });
  }

  // Uzol je buď agregovaný (štruktúra) alebo obsiahnutý (prvok) — nikdy oboje,
  // takže zliatie oboch tabuliek nekoliduje.
  const relRows = [...aggEdges, ...containedEdges];
  const edges: [string, string][] = [];
  for (const r of relRows) {
    const from = r.from_id as string;
    const to = r.to_id as string;
    // Ignoruj hrany mimo priestorového grafu (napr. ak by to_id nebol v byId).
    if (!byId.has(from) || !byId.has(to)) continue;
    edges.push([from, to]);
  }

  return { objects: [...byId.values()], edges };
}, ["spatial-graph"], AIM_CACHE);

/**
 * Graf ako Mapy (per-request memo cez `cache()`) — zloženie z cachovaných dát
 * je čisto in-memory (~1–2k uzlov, sub-ms), žiadny DB round-trip pri HIT-e.
 */
const loadGraph = cache(async (): Promise<Graph> => {
  const { objects, edges } = await loadGraphData();

  const byId = new Map<string, ObjectRow>(objects.map((o) => [o.id, o]));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const [from, to] of edges) {
    parentOf.set(from, to);
    const list = childrenOf.get(to);
    if (list) list.push(from);
    else childrenOf.set(to, [from]);
  }

  return { byId, childrenOf, parentOf };
});

/** Poradie potomkov: floory podľa elevation, inak podľa object_ref/name. */
function compareNodes(a: ObjectRow, b: ObjectRow): number {
  if (a.object_type === "floor" && b.object_type === "floor") {
    return (a.elevation ?? 0) - (b.elevation ?? 0);
  }
  const ka = a.object_ref ?? a.name ?? "";
  const kb = b.object_ref ?? b.name ?? "";
  return ka.localeCompare(kb, "sk");
}

function buildSubtree(id: string, graph: Graph): SpatialNode {
  const row = graph.byId.get(id)!;
  const childIds = graph.childrenOf.get(id) ?? [];
  const children = childIds
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map((c) => buildSubtree(c.id, graph));
  return { ...row, children };
}

/**
 * Celý strom priestorovej hierarchie. Korene = uzly bez rodiča (typicky `site`).
 * Derivát cachovaného grafu (`loadGraphData`) — skladanie je in-memory, vlastný
 * `unstable_cache` netreba (render routy navyše cachuje Full Route Cache).
 */
export const fetchSpatialTree = cache(async (): Promise<SpatialNode[]> => {
  const graph = await loadGraph();
  const roots: ObjectRow[] = [];
  for (const row of graph.byId.values()) {
    // Koreň = priestorová štruktúra bez rodiča (site). `asset` bez rodiča je
    // group-only MEP prvok (potrubie/tvarovky, D-049) — do stromu nepatrí
    // (dostupný cez systém / priamy odkaz), inak by zaplavil sidebar.
    if (!graph.parentOf.has(row.id) && row.object_type !== "asset") roots.push(row);
  }
  return roots.sort(compareNodes).map((r) => buildSubtree(r.id, graph));
});

export interface NodeDetail {
  node: ObjectRow;
  /** Cesta od koreňa po rodiča uzla (bez samotného uzla). */
  breadcrumb: NodeRef[];
  /** Priami potomkovia (assety pod space, spaces pod floor, …). */
  children: NodeRef[];
}

function toRef(row: ObjectRow): NodeRef {
  return {
    id: row.id,
    object_type: row.object_type,
    object_ref: row.object_ref,
    name: row.name,
  };
}

/**
 * Detail jedného uzla + breadcrumb (chôdza nahor po spatial hranách)
 * a priami potomkovia. `null`, ak uzol neexistuje / nie je priestorový.
 * Derivát cachovaného grafu — prvý klik na nový uzol nespúšťa DB dotazy
 * (predchádzajúce per-id cachovanie tu pri každom novom uzle znova načítavalo
 * celý graf; to bola hlavná latencia studeného kliku).
 */
export const fetchNode = cache(async (id: string): Promise<NodeDetail | null> => {
  const graph = await loadGraph();
  const node = graph.byId.get(id);
  if (!node) return null;

  // Breadcrumb: nazbieraj predkov a otoč na poradie root → … → rodič.
  const breadcrumb: NodeRef[] = [];
  let cursor = graph.parentOf.get(id);
  const guard = new Set<string>(); // poistka proti cyklu
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const parent = graph.byId.get(cursor);
    if (parent) breadcrumb.push(toRef(parent));
    cursor = graph.parentOf.get(cursor);
  }
  breadcrumb.reverse();

  const children = (graph.childrenOf.get(id) ?? [])
    .map((cid) => graph.byId.get(cid)!)
    .sort(compareNodes)
    .map(toRef);

  return { node, breadcrumb, children };
});
