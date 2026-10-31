/**
 * Ontológie ISO 21597 (ct:, ls:, els:) a AIM ako pravidlá na kontrolu kontajnera (D-181).
 * Pravidlá sa čítajú zo samotných súborov ontológií (deklarované triedy a vlastnosti, rdfs:subClassOf,
 * rdfs:subPropertyOf, rdfs:domain / rdfs:range vrátane owl:unionOf, owl:Restriction s kardinalitou),
 * takže kontrola nemá vlastný opis normy, ktorý by sa od nej mohol odkloniť.
 */

import { Graph, OWL, RDF, RDF_TYPE, RDFS, XSD, type Term, type Triple } from "./rdf";

export interface Restriction {
  prop: string;
  kind: "exact" | "min" | "max";
  n: number;
  onClass?: string;
}

export interface Ontology {
  /** Menné priestory pokryté ontológiami (napr. `...Container#`); termy v nich musia byť deklarované. */
  namespaces: Set<string>;
  declared: Set<string>;
  superClasses: Map<string, Set<string>>;
  superProps: Map<string, Set<string>>;
  /** Každý prvok poľa je jedna podmienka rdfs:domain (konjunkcia), množina = owl:unionOf. */
  domains: Map<string, Set<string>[]>;
  ranges: Map<string, Set<string>[]>;
  restrictions: Map<string, Restriction[]>;
  ontologyIris: Set<string>;
}

const DECL_TYPES = new Set([
  `${OWL}Class`,
  `${RDFS}Class`,
  `${OWL}ObjectProperty`,
  `${OWL}DatatypeProperty`,
  `${OWL}FunctionalProperty`,
  `${OWL}InverseFunctionalProperty`,
  `${OWL}AnnotationProperty`,
  `${OWL}TransitiveProperty`,
  `${OWL}SymmetricProperty`,
  `${RDF}Property`,
]);

const nsOf = (v: string) => {
  const h = v.lastIndexOf("#");
  return v.slice(0, (h >= 0 ? h : v.lastIndexOf("/")) + 1);
};

export function loadOntology(sources: Triple[][]): Ontology {
  const all = sources.flat();
  const g = new Graph(all);
  const o: Ontology = {
    namespaces: new Set(),
    declared: new Set(),
    superClasses: new Map(),
    superProps: new Map(),
    domains: new Map(),
    ranges: new Map(),
    restrictions: new Map(),
    ontologyIris: new Set(),
  };
  const classSet = (t: Term): Set<string> | null => {
    if (t.t === "iri") return new Set([t.v]);
    if (t.t === "bnode") {
      const u = g.value(t, `${OWL}unionOf`);
      if (u) return new Set(g.list(u).flatMap((x) => (x.t === "iri" ? [x.v] : [])));
    }
    return null;
  };
  const addTo = <V>(m: Map<string, V[]>, k: string, v: V) => m.set(k, [...(m.get(k) ?? []), v]);

  for (const tr of all) {
    if (tr.s.t !== "iri") continue;
    const s = tr.s.v;
    if (tr.p === RDF_TYPE && tr.o.t === "iri") {
      if (DECL_TYPES.has(tr.o.v)) o.declared.add(s);
      if (tr.o.v === `${OWL}Ontology`) o.ontologyIris.add(s);
    }
    if (tr.p === `${RDFS}subClassOf`) {
      if (tr.o.t === "iri") {
        const set = o.superClasses.get(s) ?? new Set();
        set.add(tr.o.v);
        o.superClasses.set(s, set);
      } else if (tr.o.t === "bnode" && g.types(tr.o).includes(`${OWL}Restriction`)) {
        const r = restriction(g, tr.o);
        if (r) addTo(o.restrictions, s, r);
      }
    }
    if (tr.p === `${RDFS}subPropertyOf` && tr.o.t === "iri") {
      const set = o.superProps.get(s) ?? new Set();
      set.add(tr.o.v);
      o.superProps.set(s, set);
    }
    if (tr.p === `${RDFS}domain`) {
      const cs = classSet(tr.o);
      if (cs) addTo(o.domains, s, cs);
    }
    if (tr.p === `${RDFS}range`) {
      const cs = classSet(tr.o);
      if (cs) addTo(o.ranges, s, cs);
    }
  }
  // menné priestory = tie, v ktorých ontológia deklaruje svoje termy (nie importované owl:, foaf:...)
  for (const onto of o.ontologyIris) {
    for (const d of o.declared) if (d.startsWith(`${onto}#`)) o.namespaces.add(`${onto}#`);
  }
  return o;
}

function restriction(g: Graph, b: Term): Restriction | null {
  const on = g.value(b, `${OWL}onProperty`);
  if (!on || on.t !== "iri") return null;
  const onClass = g.value(b, `${OWL}onClass`);
  const kinds: [string, Restriction["kind"]][] = [
    [`${OWL}cardinality`, "exact"],
    [`${OWL}qualifiedCardinality`, "exact"],
    [`${OWL}minCardinality`, "min"],
    [`${OWL}minQualifiedCardinality`, "min"],
    [`${OWL}maxCardinality`, "max"],
    [`${OWL}maxQualifiedCardinality`, "max"],
  ];
  for (const [p, kind] of kinds) {
    const v = g.str(b, p);
    if (v !== undefined) {
      return { prop: on.v, kind, n: Number(v), onClass: onClass?.t === "iri" ? onClass.v : undefined };
    }
  }
  return null;
}

/** Trieda a všetky jej nadtriedy. */
export function classClosure(o: Ontology, types: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...types];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const p of o.superClasses.get(c) ?? []) stack.push(p);
  }
  return out;
}

/** Vlastnosť a všetky jej nadvlastnosti. */
export function propClosure(o: Ontology, p: string): Set<string> {
  const out = new Set<string>();
  const stack = [p];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    out.add(c);
    for (const s of o.superProps.get(c) ?? []) stack.push(s);
  }
  return out;
}

export interface OntologyIssue {
  level: "error" | "warning";
  code: string;
  subject: string;
  message: string;
}

const XSD_LITERAL_OK = (range: string, t: Term): boolean => {
  if (t.t !== "lit") return false;
  if (!range.startsWith(XSD)) return true;
  if (range === `${XSD}string`) return !t.dt || t.dt === `${XSD}string`;
  return t.dt === range;
};

/**
 * Skontroluje dáta (index + linksety) voči ontológii: deklarované termy v pokrytých menných priestoroch,
 * domény a rozsahy, kardinality z owl:Restriction (aj kvalifikované, s rdfs:subPropertyOf).
 */
export function checkAgainstOntology(o: Ontology, data: Graph, label: (t: Term) => string): OntologyIssue[] {
  const issues: OntologyIssue[] = [];
  const covered = (v: string) => o.namespaces.has(nsOf(v));
  const closures = new Map<string, Set<string>>();
  const closureOf = (t: Term) => {
    const k = t.t === "iri" ? t.v : `_:${t.v}`;
    let c = closures.get(k);
    if (!c) {
      c = classClosure(o, data.types(t));
      closures.set(k, c);
    }
    return c;
  };

  const seenUndeclared = new Set<string>();
  for (const tr of data.triples) {
    const terms = [tr.p, ...(tr.p === RDF_TYPE && tr.o.t === "iri" ? [tr.o.v] : [])];
    for (const v of terms) {
      if (covered(v) && !o.declared.has(v) && !seenUndeclared.has(v)) {
        seenUndeclared.add(v);
        issues.push({ level: "error", code: "undeclared_term", subject: v, message: `term ${v} nie je v ontológii` });
      }
    }
    if (tr.p === RDF_TYPE) continue;
    for (const dom of o.domains.get(tr.p) ?? []) {
      const c = closureOf(tr.s);
      if (![...dom].some((d) => c.has(d) || d === `${OWL}Thing`)) {
        issues.push({
          level: "error",
          code: "domain",
          subject: label(tr.s),
          message: `${tr.p}: subjekt nie je ${[...dom].join(" | ")}`,
        });
      }
    }
    for (const rng of o.ranges.get(tr.p) ?? []) {
      const r = [...rng];
      if (r.every((x) => x.startsWith(XSD))) {
        if (!r.some((x) => XSD_LITERAL_OK(x, tr.o)))
          issues.push({ level: "error", code: "range", subject: label(tr.s), message: `${tr.p}: hodnota nie je ${r.join(" | ")}` });
      } else if (tr.o.t === "lit") {
        issues.push({ level: "error", code: "range", subject: label(tr.s), message: `${tr.p}: očakávaný zdroj, nie literál` });
      } else {
        const c = closureOf(tr.o);
        if (!r.some((x) => c.has(x)))
          issues.push({ level: "error", code: "range", subject: label(tr.s), message: `${tr.p}: objekt nie je ${r.join(" | ")}` });
      }
    }
  }

  // kardinality: hodnoty vlastnosti vrátane jej podvlastností
  const subProps = new Map<string, Set<string>>();
  for (const tr of data.triples) {
    for (const sup of propClosure(o, tr.p)) {
      const set = subProps.get(sup) ?? new Set();
      set.add(tr.p);
      subProps.set(sup, set);
    }
  }
  for (const s of data.allSubjects()) {
    const c = closureOf(s);
    for (const cls of c) {
      for (const r of o.restrictions.get(cls) ?? []) {
        const vals = new Map<string, Term>();
        for (const p of subProps.get(r.prop) ?? []) {
          for (const v of data.values(s, p)) vals.set(v.t === "lit" ? `"${v.v}"` : v.v, v);
        }
        let n = vals.size;
        if (r.onClass) n = [...vals.values()].filter((v) => v.t !== "lit" && closureOf(v).has(r.onClass!)).length;
        const ok = r.kind === "exact" ? n === r.n : r.kind === "min" ? n >= r.n : n <= r.n;
        if (!ok) {
          issues.push({
            level: "error",
            code: "cardinality",
            subject: label(s),
            message: `${cls.split("#").pop()}: ${r.prop.split("#").pop()} ${r.kind === "exact" ? "=" : r.kind === "min" ? ">=" : "<="} ${r.n}${r.onClass ? ` (${r.onClass.split("#").pop()})` : ""}, je ${n}`,
          });
        }
      }
    }
  }
  return issues;
}
