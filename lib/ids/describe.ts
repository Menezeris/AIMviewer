/**
 * Čitateľný opis a porovnanie IDS (D-162) nad Studio dokumentom z `ids_read`
 * (`doc.ids` + `doc.nodes`). Typy sú voľné: tvar prichádza z balíka a tu sa len číta.
 */

type Json = Record<string, unknown>;

const rec = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string => (typeof v === "string" ? v : "");

/** Obmedzenie hodnoty: pevná hodnota, vzor, výpočet, rozsah. */
export function constraintText(c: unknown): string {
  const o = rec(c);
  switch (o.type) {
    case "simpleValue":
      return txt(o.value);
    case "pattern":
      return `/${txt(o.pattern)}/`;
    case "enumeration":
      return `{${arr(o.values).map(String).join("|")}}`;
    case "bounds": {
      const parts = ["minInclusive", "maxInclusive", "minExclusive", "maxExclusive", "length", "minLength", "maxLength"]
        .filter((k) => o[k] !== undefined)
        .map((k) => `${k} ${String(o[k])}`);
      return `[${parts.join(", ")}]`;
    }
    default:
      return o.type ? String(o.type) : "?";
  }
}

export function facetText(facet: unknown): string {
  const f = rec(facet);
  const c = (k: string) => (f[k] === undefined ? "" : constraintText(f[k]));
  switch (f.type) {
    case "entity":
      return `entity ${c("name")}${f.predefinedType ? ` / ${c("predefinedType")}` : ""}`;
    case "attribute":
      return `attribute ${c("name")}${f.value ? ` = ${c("value")}` : ""}`;
    case "property":
      return `property ${c("propertySet")}.${c("baseName")}${f.dataType ? ` [${c("dataType")}]` : ""}${f.value ? ` = ${c("value")}` : ""}`;
    case "classification":
      return `classification ${f.system ? c("system") : "*"}${f.value ? ` = ${c("value")}` : ""}`;
    case "material":
      return `material${f.value ? ` = ${c("value")}` : ""}`;
    case "partOf":
      return `partOf ${txt(f.relation) || "*"}${f.entity ? ` ${facetText(f.entity).replace(/^entity /, "")}` : ""}`;
    default:
      return String(f.type ?? "facet");
  }
}

export interface DescribedFacet {
  id: string | null;
  facet: string;
  optionality?: string;
}

export interface DescribedSpec {
  id: string | null;
  name: string;
  identifier: string | null;
  ifc_versions: string[];
  /** Kardinalita použiteľnosti: minOccurs-maxOccurs (0-unbounded = "ak existuje", 1-unbounded = povinná). */
  occurs: string;
  description: string | null;
  instructions: string | null;
  applicability: DescribedFacet[];
  requirements: DescribedFacet[];
}

export interface DescribedIds {
  title: string;
  version: string | null;
  specifications: DescribedSpec[];
}

/** Opis dokumentu `doc` z `ids_read` (id špecifikácií a facetov sú tie, ktoré berie `apply_ops`). */
export function describeDoc(doc: unknown): DescribedIds {
  const d = rec(doc);
  const ids = rec(d.ids);
  const info = rec(ids.info);
  const nodes = arr(rec(d.nodes).specs);
  return {
    title: txt(info.title),
    version: txt(info.version) || null,
    specifications: arr(ids.specifications).map((raw, i) => {
      const s = rec(raw);
      const node = rec(nodes[i]);
      const appNodes = arr(node.applicability);
      const reqNodes = arr(node.requirements);
      return {
        id: txt(node.id) || txt(s.id) || null,
        name: txt(s.name),
        identifier: txt(s.identifier) || null,
        ifc_versions: arr(s.ifcVersions).map(String),
        occurs: `${String(s.minOccurs ?? 0)}-${String(s.maxOccurs ?? "unbounded")}`,
        description: txt(s.description) || null,
        instructions: txt(s.instructions) || null,
        applicability: arr(rec(s.applicability).facets).map((f, j) => ({ id: txt(rec(appNodes[j]).id) || null, facet: facetText(f) })),
        requirements: arr(s.requirements).map((r, j) => ({
          id: txt(rec(reqNodes[j]).id) || null,
          facet: facetText(rec(r).facet),
          optionality: txt(rec(r).optionality) || "required",
        })),
      };
    }),
  };
}

export interface IdsDiffResult {
  identical: boolean;
  info: string[];
  specs_added: string[];
  specs_removed: string[];
  specs_changed: Array<{ spec: string; changes: string[] }>;
}

const specKey = (s: DescribedSpec, seen: Map<string, number>): string => {
  const base = s.identifier || s.name;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base} #${n}`;
};

function listChanges(label: string, a: string[], b: string[]): string[] {
  const out: string[] = [];
  const left = [...b];
  for (const x of a) {
    const i = left.indexOf(x);
    if (i >= 0) left.splice(i, 1);
    else out.push(`- ${label}: ${x}`);
  }
  for (const x of left) out.push(`+ ${label}: ${x}`);
  return out;
}

/** Rozdiel dvoch IDS podľa špecifikácií (kľúč = identifier, inak názov), z čitateľných opisov. */
export function diffDocs(before: DescribedIds, after: DescribedIds): IdsDiffResult {
  const info: string[] = [];
  if (before.title !== after.title) info.push(`title: "${before.title}" -> "${after.title}"`);
  if (before.version !== after.version) info.push(`version: ${before.version ?? "-"} -> ${after.version ?? "-"}`);

  const index = (d: DescribedIds) => {
    const seen = new Map<string, number>();
    return new Map(d.specifications.map((s) => [specKey(s, seen), s] as const));
  };
  const a = index(before);
  const b = index(after);
  const specs_added = [...b.keys()].filter((k) => !a.has(k));
  const specs_removed = [...a.keys()].filter((k) => !b.has(k));
  const specs_changed: IdsDiffResult["specs_changed"] = [];
  for (const [key, x] of a) {
    const y = b.get(key);
    if (!y) continue;
    const changes: string[] = [];
    for (const [label, p, q] of [
      ["name", x.name, y.name],
      ["identifier", x.identifier ?? "", y.identifier ?? ""],
      ["ifcVersions", x.ifc_versions.join(","), y.ifc_versions.join(",")],
      ["occurs", x.occurs, y.occurs],
      ["description", x.description ?? "", y.description ?? ""],
      ["instructions", x.instructions ?? "", y.instructions ?? ""],
    ] as const) {
      if (p !== q) changes.push(`~ ${label}: ${p || "-"} -> ${q || "-"}`);
    }
    changes.push(...listChanges("applicability", x.applicability.map((f) => f.facet), y.applicability.map((f) => f.facet)));
    changes.push(
      ...listChanges(
        "requirement",
        x.requirements.map((r) => `${r.facet} (${r.optionality})`),
        y.requirements.map((r) => `${r.facet} (${r.optionality})`),
      ),
    );
    if (changes.length > 0) specs_changed.push({ spec: key, changes });
  }
  return {
    identical: info.length === 0 && specs_added.length === 0 && specs_removed.length === 0 && specs_changed.length === 0,
    info,
    specs_added,
    specs_removed,
    specs_changed,
  };
}
