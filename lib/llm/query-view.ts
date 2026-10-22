/**
 * Stránkovanie a väzby generického `query_view` (D-126, issue #181). Čisté
 * funkcie bez DB, aby sa dali testovať: stabilný kľúč poradia relácie,
 * kontrola vstupu `related` a súhrn strany (total, truncated, next_offset).
 */

/** Najväčší posun strany (ochrana pred dopytom cez celú DB po kúskoch). */
export const MAX_OFFSET = 100_000;
/** Max susedov uzla pre `related`; dopyt ide po dávkach `id in (...)`. */
export const RELATED_CAP = 2_000;

/**
 * Kľúč stabilného poradia relácie. Väčšina relácií má `id`; pohľady bez neho
 * majú prirodzený kľúč. Pridáva sa za `order`, aby sa strany neprekrývali.
 */
const STABLE_KEYS: Record<string, string[]> = {
  relationship_types: ["rel_type"],
  ifc_property_definitions: ["pset", "property"],
  v_asset_classifications: ["object_id", "classification_ref_id", "level"],
  v_property_dictionary: ["object_type", "ifc_type", "pset", "property"],
  v_space_elements: ["space_id", "element_id", "relation"],
  v_ids_summary: ["ids_title", "model_label", "spec_identifier"],
  v_object_documents: ["object_id", "document_id", "via", "via_id", "page"],
};

export function stableKeys(relation: string): string[] {
  return STABLE_KEYS[relation] ?? ["id"];
}

/** Relácie uzlov (riadok = jeden `objects.id`), nad ktorými ide filter `related`. */
export const RELATED_RELATIONS = new Set([
  "objects",
  "v_asset_effective",
  "v_floors",
  "v_actors",
  "floors",
  "documents",
  "persons",
]);

export interface RelatedSpec {
  relation: string;
  node: string;
  /** to = riadok je `from_id` hrany na node (prvok v priestore, člen zóny); from = `to_id` hrany z node. */
  direction: "to" | "from";
}

/** Skontroluje `related`; chyba = nepodporovaný vstup, nikdy ticho ignorovaný. */
export function parseRelated(raw: unknown, relation: string, relViews: Set<string>): RelatedSpec | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("related: objekt {relation: rel_*, node: id alebo object_ref, direction: to | from}.");
  }
  const r = raw as Record<string, unknown>;
  const unknown = Object.keys(r).filter((k) => !["relation", "node", "direction"].includes(k));
  if (unknown.length > 0) throw new Error(`related: neznámy kľúč ${unknown.join(", ")} (povolené relation, node, direction).`);
  if (!RELATED_RELATIONS.has(relation)) {
    throw new Error(`related ide len nad reláciami uzlov: ${[...RELATED_RELATIONS].join(", ")}.`);
  }
  const rel = typeof r.relation === "string" ? r.relation.trim() : "";
  if (!relViews.has(rel)) throw new Error(`related.relation: ${[...relViews].join(", ")}.`);
  const node = typeof r.node === "string" ? r.node.trim() : "";
  if (!node) throw new Error("related.node: id alebo object_ref uzla.");
  const direction = r.direction === undefined ? "to" : r.direction;
  if (direction !== "to" && direction !== "from") throw new Error("related.direction: to | from.");
  return { relation: rel, node, direction };
}

/** Celé číslo posunu strany v rozsahu 0..MAX_OFFSET. */
export function clampOffset(raw: unknown): number {
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error("offset: celé číslo >= 0.");
  return Math.min(Math.floor(raw), MAX_OFFSET);
}

export interface OrderTerm {
  column: string;
  ascending: boolean;
}

/** Poradie: voliteľný `order` používateľa, za ním kľúč relácie (bez opakovania stĺpca). */
export function orderTerms(relation: string, order: OrderTerm | null): OrderTerm[] {
  const terms = order ? [order] : [];
  for (const k of stableKeys(relation)) {
    if (!terms.some((t) => t.column === k)) terms.push({ column: k, ascending: true });
  }
  return terms;
}

/** Porovnanie ako PostgREST: null na konci pri vzostupnom poradí. */
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Zoradí riadky spojené z dávok (`related`) rovnako, ako by ich zoradila DB. */
export function sortRows<T extends Record<string, unknown>>(rows: T[], terms: OrderTerm[]): T[] {
  return [...rows].sort((x, y) => {
    for (const t of terms) {
      const c = compare(x[t.column], y[t.column]);
      if (c !== 0) return t.ascending ? c : -c;
    }
    return 0;
  });
}

/** Súhrn strany: model vždy vidí, či má všetko a odkiaľ pokračovať. */
export function pageInfo(total: number, offset: number, returned: number) {
  const truncated = offset + returned < total;
  return {
    total,
    returned,
    offset,
    truncated,
    next_offset: truncated ? offset + returned : null,
  };
}

/**
 * Strana, ktorá sa nezmestí do `maxChars`, sa skráti po celých riadkoch a súhrn sa prepočíta.
 * Inak by orezanie textu skrylo koniec strany a next_offset by ho preskočil (eval D-126:
 * 100 vyústiek s returned=100, viditeľných 74, ďalšia strana od 100).
 */
export function fitPage(result: unknown, maxChars: number): unknown {
  if (typeof result !== "object" || result === null) return result;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.rows) || typeof r.total !== "number" || typeof r.offset !== "number") return result;
  if (JSON.stringify(r).length <= maxChars) return result;
  const rows = r.rows as unknown[];
  const offset = r.offset;
  const page = (k: number) => {
    const next = offset + k;
    return {
      ...r,
      ...pageInfo(r.total as number, offset, k),
      hint: `Strana skrátená na ${k} riadkov (dĺžka výsledku): ďalšia strana offset=${next}; menej stĺpcev v select zmestí viac.`,
      rows: rows.slice(0, k),
    };
  };
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (JSON.stringify(page(mid)).length <= maxChars) lo = mid;
    else hi = mid - 1;
  }
  // Ani jeden riadok sa nezmestí (napr. select * s veľkými psetmi): aspoň jeden, aby sa strana posunula.
  return page(Math.max(lo, Math.min(1, rows.length)));
}
