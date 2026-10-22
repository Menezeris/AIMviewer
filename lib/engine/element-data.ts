/**
 * Údaje jedného prvku z IFC súboru pre `get_object(include=quantities)` (D-142): všetky Qto výmery a psety
 * výskytu aj typu v plochom tvare s označením zdroja. Dáta berie `ifc_get`; tu je len tvarovanie.
 */

type Sets = Array<{ name?: string; properties?: unknown[]; quantities?: unknown[] }>;
type Named = { name?: string; value?: unknown };

export interface ElementQuantity {
  qto: string;
  name: string;
  value: unknown;
  source: "occurrence" | "type";
}

export interface ElementProperty {
  pset: string;
  name: string;
  value: unknown;
  source: "occurrence" | "type";
}

export interface ElementIfcData {
  model: string | null;
  global_id: string | null;
  ifc_type: string | null;
  type_name: string | null;
  quantities: ElementQuantity[];
  properties: ElementProperty[];
  note: string;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `typeProperties` z balíka: buď rovno súpravy, alebo objekt s `properties` / `quantities` / `name`. */
function typeSets(type: unknown): { name: string | null; properties: Sets; quantities: Sets } {
  if (Array.isArray(type)) return { name: null, properties: type as Sets, quantities: [] };
  if (!type || typeof type !== "object") return { name: null, properties: [], quantities: [] };
  const t = type as Record<string, unknown>;
  return {
    name: typeof t.name === "string" ? t.name : null,
    properties: arr(t.properties ?? t.psets) as Sets,
    quantities: arr(t.quantities ?? t.qtos) as Sets,
  };
}

function flatten<T>(sets: Sets, inner: "properties" | "quantities", source: "occurrence" | "type", key: "qto" | "pset"): T[] {
  const out: unknown[] = [];
  for (const set of sets) {
    for (const item of arr(set[inner])) {
      const { name, value } = item as Named;
      out.push({ [key]: set.name ?? "", name: name ?? "", value: value ?? null, source });
    }
  }
  return out as T[];
}

/** Z jednej položky `ifc_get` urobí kompaktný zoznam výmer a vlastností s označením zdroja. */
export function shapeIfcElement(item: Record<string, unknown>): ElementIfcData {
  const type = typeSets(item.typeProperties);
  const quantities = [
    ...flatten<ElementQuantity>(arr(item.quantities) as Sets, "quantities", "occurrence", "qto"),
    ...flatten<ElementQuantity>(type.quantities, "quantities", "type", "qto"),
  ];
  const properties = [
    ...flatten<ElementProperty>(arr(item.properties) as Sets, "properties", "occurrence", "pset"),
    ...flatten<ElementProperty>(type.properties, "properties", "type", "pset"),
  ];
  return {
    model: typeof item.model === "string" ? item.model : null,
    global_id: typeof item.global_id === "string" ? item.global_id : null,
    ifc_type: typeof item.type === "string" ? item.type : null,
    type_name: type.name,
    quantities,
    properties,
    note:
      quantities.length === 0
        ? "Qto v súbore pre tento prvok nie je (ani na výskyte, ani na type); plochu a objem z geometrie dá ifc_measure."
        : "Hodnoty sú v jednotkách IFC súboru (dĺžka m, plocha m2, objem m3, ak model nemá iné jednotky); source = výskyt alebo typ.",
  };
}
