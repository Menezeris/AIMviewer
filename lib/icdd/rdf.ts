/**
 * RDF trojice, deterministický zápis RDF/XML a jeho čítanie (D-181). ICDD index a linksety sú RDF/XML
 * (ISO 21597-1 ich tak vyžaduje); vlastná implementácia bez knižnice, aby generátor aj kontrola
 * kontajnera bežali v prehliadači (export a import z AIM, #350) aj v testoch.
 */

import { escapeXml, parseXml, type XmlElement, type XmlNode } from "./xml";

export type Term =
  | { t: "iri"; v: string }
  | { t: "bnode"; v: string }
  | { t: "lit"; v: string; dt?: string; lang?: string };

export interface Triple {
  s: Term;
  p: string;
  o: Term;
}

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const RDF_TYPE = `${RDF}type`;

export const iri = (v: string): Term => ({ t: "iri", v });
export const lit = (v: string | number | boolean, dt?: string): Term => {
  if (typeof v === "boolean") return { t: "lit", v: String(v), dt: `${XSD}boolean` };
  if (typeof v === "number") return { t: "lit", v: String(v), dt: dt ?? (Number.isInteger(v) ? `${XSD}integer` : `${XSD}decimal`) };
  return dt ? { t: "lit", v, dt } : { t: "lit", v };
};

export function termKey(t: Term): string {
  if (t.t === "iri") return `<${t.v}>`;
  if (t.t === "bnode") return `_:${t.v}`;
  return `"${t.v}"${t.dt ? `^^<${t.dt}>` : ""}${t.lang ? `@${t.lang}` : ""}`;
}

export function tripleKey(tr: Triple): string {
  return `${termKey(tr.s)} <${tr.p}> ${termKey(tr.o)}`;
}

// ---------------------------------------------------------------- zápis

/** Rozdelí IRI na menný priestor a lokálne meno (za posledným # alebo /). */
function splitIri(v: string): [string, string] {
  const h = v.lastIndexOf("#");
  const cut = h >= 0 ? h : v.lastIndexOf("/");
  const ns = v.slice(0, cut + 1);
  const local = v.slice(cut + 1);
  if (!/^[A-Za-z_][\w.-]*$/.test(local)) throw new Error(`RDF/XML: predikát ${v} sa nedá zapísať ako QName`);
  return [ns, local];
}

/**
 * Zapíše trojice ako RDF/XML. Výstup je deterministický: subjekty, predikáty a objekty zoradené,
 * duplicity preč, prefixy v pevnom poradí (zadané + automatické `ns1`... podľa abecedy IRI).
 */
export function writeRdfXml(triples: Triple[], prefixes: Record<string, string>): string {
  const ns = new Map<string, string>(); // iri -> prefix
  for (const [p, u] of Object.entries(prefixes)) ns.set(u, p);
  ns.set(RDF, "rdf");
  const seen = new Set<string>();
  const uniq: Triple[] = [];
  for (const tr of triples) {
    const k = tripleKey(tr);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(tr);
    }
  }
  const extra = [...new Set(uniq.map((tr) => splitIri(tr.p)[0]).filter((u) => !ns.has(u)))].sort();
  extra.forEach((u, i) => ns.set(u, `ns${i + 1}`));

  const bySubject = new Map<string, { s: Term; rows: Triple[] }>();
  for (const tr of uniq) {
    const k = termKey(tr.s);
    const g = bySubject.get(k) ?? { s: tr.s, rows: [] };
    g.rows.push(tr);
    bySubject.set(k, g);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const decl = [...ns.entries()].sort((a, b) => cmp(a[1], b[1])).map(([u, p]) => `    xmlns:${p}="${escapeXml(u)}"`);
  out.push(`<rdf:RDF\n${decl.join("\n")}>`);
  for (const k of [...bySubject.keys()].sort(cmp)) {
    const { s, rows } = bySubject.get(k)!;
    const subj = s.t === "iri" ? `rdf:about="${escapeXml(s.v)}"` : `rdf:nodeID="${escapeXml(s.v)}"`;
    out.push(`  <rdf:Description ${subj}>`);
    rows.sort((a, b) => cmp(a.p, b.p) || cmp(termKey(a.o), termKey(b.o)));
    for (const tr of rows) {
      const [u, local] = splitIri(tr.p);
      const q = `${ns.get(u)}:${local}`;
      const o = tr.o;
      if (o.t === "iri") out.push(`    <${q} rdf:resource="${escapeXml(o.v)}"/>`);
      else if (o.t === "bnode") out.push(`    <${q} rdf:nodeID="${escapeXml(o.v)}"/>`);
      else {
        const attr = o.dt ? ` rdf:datatype="${escapeXml(o.dt)}"` : o.lang ? ` xml:lang="${escapeXml(o.lang)}"` : "";
        out.push(`    <${q}${attr}>${escapeXml(o.v)}</${q}>`);
      }
    }
    out.push("  </rdf:Description>");
  }
  out.push("</rdf:RDF>", "");
  return out.join("\n");
}

// ---------------------------------------------------------------- čítanie

interface Ctx {
  ns: Record<string, string>;
  base: string;
  lang?: string;
}

function hasScheme(v: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(v);
}

/** Rozlíši relatívne IRI voči základu (stačí pre tvary v ICDD: "", "#x", absolútne, relatívna cesta). */
export function resolveIri(ref: string, base: string): string {
  if (hasScheme(ref)) return ref;
  const b = base.split("#")[0];
  if (ref === "") return b;
  if (ref.startsWith("#")) return b + ref;
  if (!b) return ref;
  try {
    return new URL(ref, b).toString();
  } catch {
    return b.replace(/[^/]*$/, "") + ref;
  }
}

/**
 * Prečíta RDF/XML (striped syntax: rdf:about / rdf:ID / rdf:nodeID, typové elementy, rdf:resource,
 * rdf:datatype, xml:lang, xml:base, parseType Resource / Collection / Literal, vlastnostné atribúty).
 */
let parseCounter = 0;

export function parseRdfXml(text: string, docBase = ""): Triple[] {
  const root = parseXml(text);
  const out: Triple[] = [];
  // prázdne uzly sú jedinečné naprieč volaniami: index, linksety a ontológie sa spájajú do jedného grafu
  const doc = ++parseCounter;
  let bn = 0;
  const fresh = (): Term => ({ t: "bnode", v: `d${doc}b${++bn}` });

  const scope = (el: XmlElement, parent: Ctx): Ctx => {
    let ns = parent.ns;
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k === "xmlns" || k.startsWith("xmlns:")) {
        if (ns === parent.ns) ns = { ...ns };
        ns[k === "xmlns" ? "" : k.slice(6)] = v;
      }
    }
    const base = el.attrs["xml:base"] !== undefined ? resolveIri(el.attrs["xml:base"], parent.base) : parent.base;
    const lang = el.attrs["xml:lang"] !== undefined ? el.attrs["xml:lang"] : parent.lang;
    return { ns, base, lang };
  };
  const expand = (qname: string, ctx: Ctx): string => {
    const c = qname.indexOf(":");
    const prefix = c >= 0 ? qname.slice(0, c) : "";
    const local = c >= 0 ? qname.slice(c + 1) : qname;
    const u = ctx.ns[prefix];
    if (u === undefined) throw new Error(`RDF/XML: neznámy prefix v ${qname}`);
    return u + local;
  };
  const isMeta = (k: string) => k === "xmlns" || k.startsWith("xmlns:") || k.startsWith("xml:");
  const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => typeof c !== "string");
  const textOf = (el: XmlElement) => el.children.filter((c): c is string => typeof c === "string").join("");

  const nodeElement = (el: XmlElement, parent: Ctx): Term => {
    const ctx = scope(el, parent);
    const a = el.attrs;
    const subj: Term =
      a["rdf:about"] !== undefined
        ? iri(resolveIri(a["rdf:about"], ctx.base))
        : a["rdf:ID"] !== undefined
          ? iri(resolveIri(`#${a["rdf:ID"]}`, ctx.base))
          : a["rdf:nodeID"] !== undefined
            ? { t: "bnode", v: `d${doc}n_${a["rdf:nodeID"]}` }
            : fresh();
    const name = expand(el.name, ctx);
    if (name !== `${RDF}Description`) out.push({ s: subj, p: RDF_TYPE, o: iri(name) });
    for (const [k, v] of Object.entries(a)) {
      if (isMeta(k) || k === "rdf:about" || k === "rdf:ID" || k === "rdf:nodeID") continue;
      const p = expand(k, ctx);
      out.push({ s: subj, p, o: p === RDF_TYPE ? iri(resolveIri(v, ctx.base)) : withLang(v, ctx) });
    }
    for (const child of elements(el)) propertyElement(child, subj, ctx);
    return subj;
  };

  const withLang = (v: string, ctx: Ctx): Term => (ctx.lang ? { t: "lit", v, lang: ctx.lang } : { t: "lit", v });

  const propertyElement = (el: XmlElement, subj: Term, parent: Ctx) => {
    const ctx = scope(el, parent);
    const p = expand(el.name, ctx);
    const a = el.attrs;
    const kids = elements(el);
    const pt = a["rdf:parseType"];
    if (a["rdf:resource"] !== undefined) {
      out.push({ s: subj, p, o: iri(resolveIri(a["rdf:resource"], ctx.base)) });
      return;
    }
    if (a["rdf:nodeID"] !== undefined) {
      out.push({ s: subj, p, o: { t: "bnode", v: `d${doc}n_${a["rdf:nodeID"]}` } });
      return;
    }
    if (pt === "Resource") {
      const b = fresh();
      out.push({ s: subj, p, o: b });
      for (const k of kids) propertyElement(k, b, ctx);
      return;
    }
    if (pt === "Collection") {
      const items = kids.map((k) => nodeElement(k, ctx));
      let head: Term = iri(`${RDF}nil`);
      for (let i = items.length - 1; i >= 0; i--) {
        const cell = fresh();
        out.push({ s: cell, p: `${RDF}first`, o: items[i] });
        out.push({ s: cell, p: `${RDF}rest`, o: head });
        head = cell;
      }
      out.push({ s: subj, p, o: head });
      return;
    }
    if (pt === "Literal") {
      out.push({ s: subj, p, o: { t: "lit", v: serializeChildren(el.children), dt: `${RDF}XMLLiteral` } });
      return;
    }
    if (kids.length === 1) {
      out.push({ s: subj, p, o: nodeElement(kids[0], ctx) });
      return;
    }
    if (kids.length > 1) throw new Error(`RDF/XML: vlastnosť ${el.name} má viac uzlov`);
    const propAttrs = Object.entries(a).filter(
      ([k]) => !isMeta(k) && k !== "rdf:datatype" && k !== "rdf:ID" && k !== "rdf:parseType",
    );
    if (propAttrs.length && textOf(el).trim() === "") {
      const b = fresh();
      out.push({ s: subj, p, o: b });
      for (const [k, v] of propAttrs) out.push({ s: b, p: expand(k, ctx), o: withLang(v, ctx) });
      return;
    }
    const dt = a["rdf:datatype"];
    out.push({ s: subj, p, o: dt ? { t: "lit", v: textOf(el), dt: resolveIri(dt, ctx.base) } : withLang(textOf(el), ctx) });
  };

  const ctx0 = scope(root, { ns: { xml: "http://www.w3.org/XML/1998/namespace" }, base: docBase });
  if (expand(root.name, ctx0) !== `${RDF}RDF`) {
    nodeElement(root, ctx0);
  } else {
    for (const el of elements(root)) nodeElement(el, ctx0);
  }
  return out;
}

function serializeChildren(nodes: XmlNode[]): string {
  return nodes
    .map((n) =>
      typeof n === "string"
        ? escapeXml(n)
        : `<${n.name}${Object.entries(n.attrs)
            .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
            .join("")}>${serializeChildren(n.children)}</${n.name}>`,
    )
    .join("");
}

/** Index nad trojicami pre kontroly (typy, hodnoty vlastností). */
export class Graph {
  readonly triples: Triple[];
  private bySP = new Map<string, Term[]>();
  private subjects = new Map<string, Term>();

  constructor(triples: Triple[]) {
    this.triples = triples;
    for (const tr of triples) {
      const k = `${termKey(tr.s)} ${tr.p}`;
      const arr = this.bySP.get(k) ?? [];
      arr.push(tr.o);
      this.bySP.set(k, arr);
      this.subjects.set(termKey(tr.s), tr.s);
    }
  }

  values(s: Term, p: string): Term[] {
    return this.bySP.get(`${termKey(s)} ${p}`) ?? [];
  }

  value(s: Term, p: string): Term | undefined {
    return this.values(s, p)[0];
  }

  str(s: Term, p: string): string | undefined {
    const v = this.value(s, p);
    return v && v.t === "lit" ? v.v : undefined;
  }

  types(s: Term): string[] {
    return this.values(s, RDF_TYPE)
      .filter((t): t is { t: "iri"; v: string } => t.t === "iri")
      .map((t) => t.v);
  }

  allSubjects(): Term[] {
    return [...this.subjects.values()];
  }

  /** Prvky RDF zoznamu (rdf:first / rdf:rest). */
  list(head: Term): Term[] {
    const items: Term[] = [];
    let cur: Term | undefined = head;
    let guard = 0;
    while (cur && !(cur.t === "iri" && cur.v === `${RDF}nil`) && guard++ < 10000) {
      const first = this.value(cur, `${RDF}first`);
      if (first) items.push(first);
      cur = this.value(cur, `${RDF}rest`);
    }
    return items;
  }
}
