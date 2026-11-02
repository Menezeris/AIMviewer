/**
 * Generátor IDS 1.0 (port `assetin/generate/ids.py`, D-186 krok 6): jeden IDS na cieľ (výmena × poskytovateľ).
 * Mapovanie je to isté ako v Pythone (SCHEMA §3/§4/§6/§14, DECISIONS V24/V25/V27): applicability = entita
 * (+ predefined type), klasifikácia bez `povinnost`, `filter[]`; requirements = položky s účinným `overenie: IDS`
 * (atribút, vlastnosť, materiál, výčty, vzory, medze, kardinalita z účinnej `povinnost` vrátane prepisov ER),
 * klasifikácia s `povinnost`; STD pravidlá `plati: vzdy` alebo zapnuté výmenou, `overenie: IDS`, rozsah objekt /
 * kontajner. Deterministický: bez dátumu, ak ho nikto nedá, takže vydanie bez zmeny dá tie isté bajty.
 */

import { idPoznamky, typPoznamky, type Kniznica } from "../graf";
import { klucPolozky } from "../graf-json";
import { dopadajucePravidla, povodHodnoty } from "../inspektor";
import type { PodZaznam, Poznamka } from "../loader";
import { jednotkyVymeny, type Jednotky } from "../retazec";
import { odsad, podprvok, prvok, vypis, type Prvok } from "./xml";

export const IDS_NS = "http://standards.buildingsmart.org/IDS";
export const XS_NS = "http://www.w3.org/2001/XMLSchema";
export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const PREFIXY = { [IDS_NS]: "ids", [XS_NS]: "xs", [XSI_NS]: "xsi" };

type M = Record<string, unknown>;

export interface Ciel {
  er: string;
  poskytovatel: string;
}

const NUMERIC_DATATYPES = new Set(["IFCAREAMEASURE", "IFCPOSITIVELENGTHMEASURE", "IFCLENGTHMEASURE", "IFCVOLUMEMEASURE", "IFCCOUNTMEASURE", "IFCREAL", "IFCINTEGER"]);
const NO_IDS_COUNTERPART = ["zavaznost", "rola", "povaha", "tolerancia", "dolozene_v", "definicia_ref", "postup"];

export class Report {
  specs: string[] = [];
  objekty: string[] = [];
  applicability = new Map<string, number>();
  requirements = new Map<string, number>();
  skipped: string[] = [];
  missing: Array<[string, string, string]> = [];
  miss(where: string, kind: string, text: string) {
    this.missing.push([where, kind, text]);
  }
}
const pripocitaj = (c: Map<string, number>, k: string) => c.set(k, (c.get(k) ?? 0) + 1);

// ------------------------------------------------------------------------------------------------ hodnoty ako Python

const obj = (v: unknown): M | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as M) : null);
const zoznam = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const zoznamM = (v: unknown): M[] => zoznam(v).map((x) => obj(x) ?? {});
const attr = (x: unknown, k: string): unknown => obj(x)?.[k] ?? null;
const je = (v: unknown) => v !== null && v !== undefined;
const pravda = (v: unknown) => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (obj(v) !== null && Object.keys(v as object).length === 0));
/** `str(v)`; čísla z polí typu float (medze rozsahu) ako Python float (`2.0`). */
function pyStr(v: unknown, float = false): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number" && float && Number.isInteger(v)) return `${v}.0`;
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `'${x}'` : pyStr(x))).join(", ")}]`;
  return String(v);
}
const sorted = (xs: Iterable<string>) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ------------------------------------------------------------------------------------------------ XML pomocníci

const q = (tag: string, ns = IDS_NS) => `{${ns}}${tag}`;
const sub = (parent: Prvok, tag: string, text: string | null = null, attrs: Record<string, string | null | undefined> = {}) => {
  const e = podprvok(parent, q(tag), attrs);
  if (text !== null) e.text = text;
  return e;
};
const simpleValue = (parent: Prvok, tag: string, value: unknown) => sub(sub(parent, tag), "simpleValue", pyStr(value));

function restriction(parent: Prvok, tag: string, o: { base?: string; enum?: unknown[] | null; pattern?: string | null; bounds?: Array<[string, unknown]> } = {}) {
  const holder = sub(parent, tag);
  const r = podprvok(holder, q("restriction", XS_NS), { base: o.base ?? "xs:string" });
  for (const v of o.enum ?? []) podprvok(r, q("enumeration", XS_NS), { value: pyStr(v) });
  if (o.pattern !== null && o.pattern !== undefined) podprvok(r, q("pattern", XS_NS), { value: o.pattern });
  for (const [k, v] of o.bounds ?? []) podprvok(r, q(k, XS_NS), { value: pyStr(v, true) });
}

function xsdPattern(vzor: string, where: string, rep: Report): string {
  let out = vzor;
  if (out.startsWith("^")) out = out.slice(1);
  if (out.endsWith("$")) out = out.slice(0, -1);
  if (out !== vzor) rep.miss(where, "vzor", `regex \`${vzor}\` má kotvy ^…$; XSD pattern ich nepozná (odstránené → \`${out}\`)`);
  return out;
}

function occurs(pritomnost: unknown, where: string, rep: Report): Record<string, string> {
  if (pritomnost === "required") return { minOccurs: "1", maxOccurs: "unbounded" };
  if (pritomnost === "optional") return { minOccurs: "0", maxOccurs: "unbounded" };
  if (pritomnost === "prohibited") return { minOccurs: "0", maxOccurs: "0" };
  rep.miss(where, "pritomnost_v_modeli", "chýba → IDS minOccurs/maxOccurs nechané na predvoľbu (0..unbounded)");
  return { minOccurs: "0", maxOccurs: "unbounded" };
}

// ------------------------------------------------------------------------------------------------ dotazy na knižnicu

/** `link_target`: cieľ WikiLinku (`[[X#a|b]]` -> X). */
function linkTarget(v: unknown): string | null {
  if (!je(v)) return null;
  const s = String(v).trim();
  if (!s.startsWith("[[")) return null;
  return s.slice(2, -2).split("|")[0].split("#")[0].trim();
}
function linkAnchor(v: unknown): string | null {
  if (!je(v)) return null;
  const s = String(v).trim();
  if (!s.startsWith("[[")) return null;
  const inner = s.slice(2, -2).split("|")[0];
  const i = inner.indexOf("#");
  return i >= 0 ? inner.slice(i + 1) : null;
}
const podZaznam = (k: Kniznica, ciel: string, kotva: string | null): PodZaznam | null => k.pod_zaznamy.get(`${ciel}\u0000${kotva ?? ""}`) ?? null;

function resolveVocab(k: Kniznica, ref: unknown, where: string, rep: Report): unknown[] | null {
  const ciel = linkTarget(ref);
  const kotva = linkAnchor(ref);
  if (ciel === null) return null;
  if (!k.poznamky.has(ciel)) {
    rep.miss(where, "hodnoty_ref", `slovník \`${ciel}#${pyStr(kotva)}\` — poznámka ${ciel} v knižnici neexistuje`);
    return null;
  }
  const pz = podZaznam(k, ciel, kotva);
  if (!pz || pz.model === null) {
    rep.miss(where, "hodnoty_ref", `slovník \`${ciel}#${pyStr(kotva)}\` — pod-záznam nenájdený`);
    return null;
  }
  const hodnoty = attr(pz.model, "hodnoty");
  if (!pravda(hodnoty)) {
    rep.miss(where, "hodnoty_ref", `slovník \`${ciel}#${pyStr(kotva)}\` bez \`hodnoty\``);
    return null;
  }
  return Array.isArray(hodnoty) ? [...hodnoty] : Object.keys(hodnoty as M);
}

function providerOf(er: Poznamka, iu: Poznamka): [string | null, string] {
  const own = zoznam(iu.model!.poskytovatel).map(linkTarget).filter((x): x is string => !!x);
  if (own.length === 1) return [own[0], "IU-O.poskytovatel"];
  if (own.length > 1) return [null, `IU-O.poskytovatel má ${own.length} hodnôt (${own.join(", ")}) — nejednoznačné`];
  const d = linkTarget(er.model!.poskytovatel_predvoleny);
  if (d) return [d, "ER.poskytovatel_predvoleny"];
  return [null, "žiadny poskytovateľ (IU-O ani ER)"];
}

const kontajneryObjektu = (j: Jednotky, iu: string) => j.kontajnery.filter((c) => (j.priradenia.get(c) ?? []).some((p) => p.iu === iu));
function rozsahObjektu(j: Jednotky, iu: string): Set<string> {
  const r = new Set<string>();
  for (const c of kontajneryObjektu(j, iu)) for (const p of j.priradenia.get(c) ?? []) if (p.iu === iu) p.ucinny_rozsah.forEach((a) => r.add(a));
  return r;
}

function objektyCiela(k: Kniznica, er: Poznamka, ciel: Ciel, rep: Report): Poznamka[] {
  const out: Poznamka[] = [];
  const j = jednotkyVymeny(k, idPoznamky(er)!);
  for (const nid of j.kontajnery) rep.skipped.push(`${nid}: kontajner — IDS neopisuje kontajnery`);
  for (const nid of j.objekty) {
    const n = k.poznamky.get(nid);
    if (!n || !n.model) {
      rep.miss(`${ciel.er}.obsahuje`, "odkaz", `\`${nid}\` sa nedá načítať`);
      continue;
    }
    const rozsah = rozsahObjektu(j, nid);
    if (kontajneryObjektu(j, nid).length && !rozsah.has("alfanumerika")) {
      rep.skipped.push(`${nid}: priradenie nesie ${sorted(rozsah).join(", ") || "—"} — bez alfanumeriky IDS nič nežiada`);
      continue;
    }
    const [prov, origin] = providerOf(er, n);
    if (prov === null) {
      rep.miss(`${nid}.poskytovatel`, "poskytovatel", origin);
      continue;
    }
    if (prov !== ciel.poskytovatel) {
      rep.skipped.push(`${nid}: poskytovateľ ${prov} (${origin}) ≠ ${ciel.poskytovatel}`);
      continue;
    }
    out.push(n);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ IU-O -> špecifikácia

const PREPISOVATELNE_EFF = ["povinnost", "hodnoty", "hodnoty_ref", "rozsah", "zavaznost"];
const bezNull = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(bezNull);
  const o = obj(v);
  return o ? Object.fromEntries(Object.entries(o).filter(([, x]) => je(x)).map(([a, b]) => [a, bezNull(b)])) : v;
};

/** `Kniznica.efektivna_polozka` + predvoľby §14b z inšpektora. */
function effectiveItem(k: Kniznica, erId: string, iuId: string, kluc: string): M {
  const origin = povodHodnoty(k, iuId, kluc, erId);
  const iu = k.poznamky.get(iuId);
  const er = k.poznamky.get(erId);
  let eff: M = {};
  const base = iu?.model ? zoznamM(iu.model.alfanumerika).find((p) => klucPolozky(p) === kluc) : undefined;
  if (base) {
    eff = bezNull(base) as M;
    if (pravda(iu!.model!.zavaznost_predvolena) && !("zavaznost" in eff)) eff.zavaznost = iu!.model!.zavaznost_predvolena;
    if (er?.model) {
      for (const pr of zoznamM(er.model.prepisy)) {
        if (linkTarget(pr.iu) === iuId && pr.polozka === kluc) for (const kl of PREPISOVATELNE_EFF) if (je(pr[kl])) eff[kl] = bezNull(pr[kl]);
      }
    }
  }
  if (origin) for (const [kl, v] of Object.entries(origin.hodnota)) if (!(kl in eff)) eff[kl] = v;
  return eff;
}

function addValueRestriction(facet: Prvok, eff: M, where: string, rep: Report, numeric: boolean) {
  const hodnoty = eff.hodnoty;
  const vzor = eff.vzor;
  const rozsah = obj(eff.rozsah);
  if (![hodnoty, vzor, eff.rozsah].some(pravda)) return;
  let base = numeric ? "xs:double" : "xs:string";
  const bounds: Array<[string, unknown]> = [];
  if (rozsah && pravda(rozsah)) {
    if (je(rozsah.min)) bounds.push([rozsah.min_exkluzivne ? "minExclusive" : "minInclusive", rozsah.min]);
    if (je(rozsah.max)) bounds.push([rozsah.max_exkluzivne ? "maxExclusive" : "maxInclusive", rozsah.max]);
    if (!numeric) {
      rep.miss(where, "rozsah", "rozsah na položke bez číselného dataType — IDS bounds vyžadujú xs:double");
      base = "xs:double";
    }
  }
  if ([hodnoty, vzor, eff.rozsah].filter(pravda).length > 1) rep.miss(where, "hodnoty/vzor/rozsah", "viac obmedzení naraz — IDS ich spája do jednej xs:restriction (AND)");
  restriction(facet, "value", { base, enum: zoznam(hodnoty), pattern: pravda(vzor) ? xsdPattern(String(vzor), where, rep) : null, bounds });
}

function classificationFacet(k: Kniznica, parent: Prvok, kl: M, where: string, rep: Report, cardinality: string | null = null): Prvok {
  const cl = sub(parent, "classification", null, { uri: kl.uri as string | null, cardinality });
  let pattern: string | null = null;
  const ciel = linkTarget(kl.pravidlo);
  const kotva = linkAnchor(kl.pravidlo);
  if (ciel && !k.poznamky.has(ciel)) rep.miss(`${where}.pravidlo`, "slovnik", `\`${ciel}#${pyStr(kotva)}\` — poznámka neexistuje; vzor kódu CCI nedostupný`);
  else if (ciel) {
    const pz = podZaznam(k, ciel, kotva);
    pattern = (attr(pz?.model, "vzor") as string | null) ?? null;
    if (pattern === null) rep.miss(`${where}.pravidlo`, "slovnik", `\`${ciel}#${pyStr(kotva)}\` bez \`vzor\``);
  }
  if (pattern) restriction(cl, "value", { pattern: xsdPattern(pattern, where, rep) });
  simpleValue(cl, "system", kl.system);
  return cl;
}

function buildIuSpec(k: Kniznica, erId: string, iu: Poznamka, ifcVersion: string, rep: Report): Prvok {
  const m = iu.model as M;
  const nid = idPoznamky(iu)!;
  const objekt = obj(m.objekt) ?? {};
  const spec = prvok(q("specification"), {
    ifcVersion,
    name: String(m.nazov),
    identifier: nid,
    description: pravda(m.zdovodnenie) ? String(m.zdovodnenie) : null,
    instructions: pravda(m.pokyn) ? String(m.pokyn) : null,
  });
  const app = sub(spec, "applicability", null, occurs(m.pritomnost_v_modeli, `${nid}.pritomnost_v_modeli`, rep));
  const ent = sub(app, "entity");
  simpleValue(ent, "name", String(objekt.ifc_entita).toUpperCase());
  if (pravda(objekt.predefined_type)) simpleValue(ent, "predefinedType", objekt.predefined_type);
  pripocitaj(rep.applicability, "entity");
  if (pravda(objekt.uri)) rep.miss(`${nid}.objekt.uri`, "uri", "entity facet v IDS 1.0 nemá @uri — bSDD URI entity sa stráca");

  const klasifikacia = zoznamM(m.klasifikacia);
  klasifikacia.forEach((kl, i) => {
    if (!je(kl.povinnost)) {
      classificationFacet(k, app, kl, `${nid}.klasifikacia[${i}]`, rep);
      pripocitaj(rep.applicability, "classification");
    }
  });
  zoznamM(m.filter).forEach((f, i) => {
    addGenericFacet(k, app, f, `${nid}.filter[${i}]`, rep, false);
    pripocitaj(rep.applicability, String(f.facet));
  });

  const req = sub(spec, "requirements");
  klasifikacia.forEach((kl, i) => {
    if (je(kl.povinnost)) {
      classificationFacet(k, req, kl, `${nid}.klasifikacia[${i}]`, rep, String(kl.povinnost));
      pripocitaj(rep.requirements, "classification");
    }
  });
  for (const p of zoznamM(m.alfanumerika)) {
    const kluc = klucPolozky(p);
    const where = `${nid}.alfanumerika[${kluc}]`;
    const eff = effectiveItem(k, erId, nid, kluc);
    if (eff.overenie !== "IDS") {
      rep.skipped.push(`${where}: overenie ${pyStr(eff.overenie)} — mimo IDS`);
      continue;
    }
    if (je(p.prop)) {
      rep.miss(where, "prop", "vlastná vlastnosť (PROP) — pset/dataType by musel niesť PROP (§7); nevygenerované");
      continue;
    }
    const card = je(eff.povinnost) ? String(eff.povinnost) : null;
    if (card === null) rep.miss(`${where}.povinnost`, "povinnost", "chýba → IDS cardinality; použitá predvoľba XSD `required`");
    for (const fld of NO_IDS_COUNTERPART) if (pravda(eff[fld])) rep.miss(`${where}.${fld}`, "bez-nasledku", `\`${fld}: ${pyStr(eff[fld])}\` — IDS 1.0 nemá protistranu`);
    const ifc = obj(p.ifc) ?? {};
    const pokyn = je(eff.pokyn) ? String(eff.pokyn) : null;
    if ("atribut" in ifc) {
      const fac = sub(req, "attribute", null, { cardinality: card, instructions: pokyn });
      simpleValue(fac, "name", ifc.atribut);
      addValueRestriction(fac, eff, where, rep, false);
      pripocitaj(rep.requirements, "attribute");
      if (ifc.atribut === "PredefinedType") {
        rep.miss(where, "sporne", "PredefinedType ako požiadavka (výčet) popri prázdnom `objekt.predefined_type` — IDS má predefinedType aj v entity facete; dve miesta pre tú istú vec");
      }
    } else if ("material" in ifc) {
      const fac = sub(req, "material", null, { cardinality: card, instructions: pokyn });
      simpleValue(fac, "value", ifc.material);
      pripocitaj(rep.requirements, "material");
    } else {
      const dt = je(eff.datovy_typ) ? String(eff.datovy_typ) : null;
      if (dt === null) rep.miss(`${where}.datovy_typ`, "datovy_typ", "položka nemá `datovy_typ` (V24) — IDS @dataType ostáva prázdny a číselné medze sa neoveria");
      const fac = sub(req, "property", null, { dataType: dt, uri: je(ifc.uri) ? String(ifc.uri) : null, cardinality: card, instructions: pokyn });
      simpleValue(fac, "propertySet", ifc.pset);
      simpleValue(fac, "baseName", ifc.nazov);
      addValueRestriction(fac, eff, where, rep, dt !== null && NUMERIC_DATATYPES.has(dt));
      pripocitaj(rep.requirements, "property");
    }
  }
  zoznamM(m.dokumentacia).forEach((d, i) => rep.skipped.push(`${nid}.dokumentacia[${i}] (${pyStr(linkTarget(d.dok))}): overenie manual — mimo IDS`));
  if (je(m.geometria)) rep.skipped.push(`${nid}.geometria: overenie manual/clash-detection — mimo IDS`);
  for (const c of zoznam(m.clenenie)) rep.miss(`${nid}.clenenie`, "clenenie", `prepis členenia \`${pyStr(c)}\` — prototyp partOf berie len zo STD pravidiel`);
  if (!req.deti.length) spec.deti = spec.deti.filter((d) => d !== req);
  return spec;
}

// ------------------------------------------------------------------------------------------------ STD pravidlo -> špecifikácia

function addGenericFacet(k: Kniznica, parent: Prvok, f: M, where: string, rep: Report, inRequirements: boolean) {
  const card = inRequirements && je(f.cardinality) ? String(f.cardinality) : null;
  let hodnoty: unknown[] | null = Array.isArray(f.hodnoty) ? f.hodnoty : null;
  if (je(f.hodnoty_ref)) {
    hodnoty = resolveVocab(k, f.hodnoty_ref, `${where}.hodnoty_ref`, rep);
    if (hodnoty === null) {
      rep.miss(where, "degradovane", "bez slovníka je facet len »atribút existuje« (žiadne value) — " + (!inRequirements ? "filter nezužuje applicability" : "požiadavka neoveruje hodnotu"));
    }
  }
  const hodnota = f.hodnota ?? null;
  const vzor = (f.vzor as string | null | undefined) ?? null;
  const valueOf = (el: Prvok, tag = "value") => {
    if (hodnota !== null) simpleValue(el, tag, hodnota);
    else if (pravda(hodnoty) || pravda(vzor)) restriction(el, tag, { enum: hodnoty, pattern: pravda(vzor) ? xsdPattern(vzor!, where, rep) : null });
  };
  const s = (v: unknown) => (je(v) ? String(v) : null);
  if (f.facet === "entity") {
    const el = sub(parent, "entity");
    simpleValue(el, "name", String(f.nazov).toUpperCase());
    if (pravda(f.predefined_type)) simpleValue(el, "predefinedType", f.predefined_type);
  } else if (f.facet === "attribute") {
    const el = sub(parent, "attribute", null, { cardinality: card });
    simpleValue(el, "name", f.nazov);
    valueOf(el);
  } else if (f.facet === "classification") {
    const el = sub(parent, "classification", null, { cardinality: card, uri: s(f.uri) });
    valueOf(el);
    if (pravda(f.system)) simpleValue(el, "system", f.system);
  } else if (f.facet === "property") {
    const el = sub(parent, "property", null, { cardinality: card, uri: s(f.uri), dataType: s(f.datovy_typ) });
    simpleValue(el, "propertySet", f.pset);
    simpleValue(el, "baseName", f.nazov);
    valueOf(el);
  } else if (f.facet === "material") {
    const el = sub(parent, "material", null, { cardinality: card, uri: s(f.uri) });
    valueOf(el);
  } else if (f.facet === "partOf") {
    const el = sub(parent, "partOf", null, { cardinality: card, relation: s(f.relation) });
    const ent = sub(el, "entity");
    const entities = (Array.isArray(f.entity) ? f.entity : [f.entity]).map((e) => String(e).toUpperCase());
    if (entities.length === 1) simpleValue(ent, "name", entities[0]);
    else restriction(ent, "name", { enum: entities });
    if (pravda(f.predefined_type)) simpleValue(ent, "predefinedType", f.predefined_type);
  }
  if (inRequirements && card === null && f.facet !== "entity") rep.miss(`${where}.cardinality`, "cardinality", "chýba → predvoľba XSD `required`");
}

function applicableRules(k: Kniznica, erId: string, ius: Poznamka[], rep: Report): Array<[PodZaznam, string]> {
  const seen = new Map<string, string>();
  for (const iu of ius) for (const r of dopadajucePravidla(k, idPoznamky(iu)!, erId)) if (!seen.has(String(r.pravidlo))) seen.set(String(r.pravidlo), String(r.dovod));
  for (const [, pid, pz] of k.pod_zaznamy_poradie) {
    if (pz.druh !== "pravidlo" || pz.model === null) continue;
    const p = pz.model as M;
    if (p.plati === "vzdy" && p.overenie === "IDS" && (p.rozsah === "objekt" || p.rozsah === "kontajner") && !seen.has(pid)) seen.set(pid, "vždy (bez ohľadu na entity poskytovateľa)");
  }
  const out: Array<[PodZaznam, string]> = [];
  for (const [pid, dovod] of seen) {
    const pz = k.globalne_pod.get(pid);
    if (!pz || pz.model === null) continue;
    const p = pz.model as M;
    if (p.overenie !== "IDS") {
      rep.skipped.push(`${pid}: overenie ${pyStr(p.overenie)} — mimo IDS`);
      continue;
    }
    if (p.rozsah === "federacia") {
      rep.skipped.push(`${pid}: rozsah federacia — nikdy do IDS`);
      continue;
    }
    out.push([pz, dovod]);
  }
  // Python `list.sort` je stabilné podľa ID pod-záznamu
  return out.map((x, i) => [x, i] as const).sort(([a, ia], [b, ib]) => (a[0].id < b[0].id ? -1 : a[0].id > b[0].id ? 1 : ia - ib)).map(([x]) => x);
}

function buildRuleSpec(k: Kniznica, pz: PodZaznam, dovod: string, ifcVersion: string, rep: Report): Prvok | null {
  const p = pz.model as M;
  const pid = pz.id;
  if (pravda(p.vynimka)) {
    rep.miss(pid, "vynimka", "núdzový ```ids blok — prototyp ho nevkladá");
    return null;
  }
  const appDef = obj(p.applicability);
  if (!appDef || !je(appDef.entity)) {
    rep.miss(`${pid}.applicability`, "applicability", "pravidlo bez entity — IDS špecifikácia bez applicability nejde");
    return null;
  }
  const entities = (Array.isArray(appDef.entity) ? appDef.entity : [appDef.entity]).map((e) => String(e).toUpperCase());
  if (entities.some((e) => ["IFCELEMENT", "IFCPRODUCT", "IFCOBJECT", "IFCROOT"].includes(e))) {
    rep.miss(`${pid}.applicability.entity`, "abstraktna-entita", `${pyStr(entities)} je abstraktná — IDS 1.0 nepozná dedičnosť, generátor musí rozvinúť podtypy z IFC 4.3 schémy (SCHEMA V5); prototyp bez IfcOpenShell → pravidlo VYNECHANÉ`);
    return null;
  }
  rep.miss(`${pid}.poskytovatel`, "poskytovatel", `STD pravidlo nemá poskytovateľa; zaradené do IDS poskytovateľa lebo: ${dovod}`);
  const spec = prvok(q("specification"), {
    ifcVersion,
    name: String(p.nazov),
    identifier: pid,
    description: pravda(p.text) ? String(p.text) : null,
    instructions: pravda(p.pokyn) ? String(p.pokyn) : null,
  });
  if (pravda(p.zavaznost)) rep.miss(`${pid}.zavaznost`, "bez-nasledku", `\`zavaznost: ${pyStr(p.zavaznost)}\` — IDS 1.0 nemá protistranu`);
  const app = sub(spec, "applicability", null, occurs(pravda(p.pritomnost_v_modeli) ? p.pritomnost_v_modeli : "optional", pid, rep));
  const ent = sub(app, "entity");
  if (entities.length === 1) simpleValue(ent, "name", entities[0]);
  else restriction(ent, "name", { enum: entities });
  if (pravda(appDef.predefined_type)) simpleValue(ent, "predefinedType", appDef.predefined_type);
  pripocitaj(rep.applicability, "entity");
  zoznamM(appDef.filter).forEach((f, i) => {
    addGenericFacet(k, app, f, `${pid}.applicability.filter[${i}]`, rep, false);
    pripocitaj(rep.applicability, String(f.facet));
  });
  const reqs = zoznamM(p.requirements);
  if (reqs.length) {
    const req = sub(spec, "requirements");
    reqs.forEach((f, i) => {
      addGenericFacet(k, req, f, `${pid}.requirements[${i}]`, rep, true);
      pripocitaj(rep.requirements, String(f.facet));
    });
  } else if (p.pritomnost_v_modeli !== "prohibited") rep.miss(`${pid}.requirements`, "requirements", "prázdne requirements bez zákazu — špecifikácia nič neoverí");
  if (pravda(p.postup)) rep.skipped.push(`${pid}.postup: »${[...String(p.postup)].slice(0, 60).join("")}…« — manuálna časť, mimo IDS`);
  return spec;
}

// ------------------------------------------------------------------------------------------------ ids:info

function buildInfo(k: Kniznica, er: Poznamka, ciel: Ciel, root: Prvok, rep: Report, datum: string | null) {
  const m = er.model as M;
  const info = sub(root, "info");
  sub(info, "title", String(m.nazov));
  sub(info, "copyright", pravda(m.autor) ? `${m.autor} (${pyStr(m.licencia)})` : null);
  sub(info, "version", pravda(m.verzia) ? String(m.verzia) : null);
  const uc = zoznam(m.uc);
  const su = zoznam(m.spustacia_udalost);
  const ucId = uc.length ? linkTarget(uc[0]) : null;
  const evId = su.length ? linkTarget(su[0]) : null;
  const ucN = k.poznamky.get(ucId ?? "");
  const evN = k.poznamky.get(evId ?? "");
  const prov = k.poznamky.get(ciel.poskytovatel);
  const provName = prov?.model ? String(prov.model.nazov) : ciel.poskytovatel;
  sub(info, "description", `Poskytovateľ: ${provName} (${ciel.poskytovatel}); príjemca: ${pyStr(linkTarget(m.prijemca))}`);
  rep.miss(`${ciel.poskytovatel}.email`, "author", "IDS info/author vyžaduje e-mail (XSD pattern); ACT nemá e-mail → author vynechaný, poskytovateľ je v description");
  if (datum) sub(info, "date", datum);
  if (ucN?.model) sub(info, "purpose", String(ucN.model.nazov));
  else rep.miss(`${ciel.er}.uc`, "purpose", `UC \`${pyStr(ucId)}\` nenájdený`);
  if (evN?.model) sub(info, "milestone", String(evN.model.nazov));
  else rep.miss(`${ciel.er}.spustacia_udalost`, "milestone", `EV \`${pyStr(evId)}\` nenájdený`);
  if (su.length > 1) rep.miss(`${ciel.er}.spustacia_udalost`, "milestone", "viac udalostí — IDS má jeden milestone");
}

function ifcVersionOf(er: Poznamka, rep: Report): string {
  const v = attr(er.model!.forma, "verzia_schemy");
  if (v === "IFC2X3" || v === "IFC4" || v === "IFC4X3_ADD2") return v;
  rep.miss(`${idPoznamky(er)}.forma.verzia_schemy`, "ifcVersion", `\`${pyStr(v)}\` nie je v IDS enum (IFC2X3|IFC4|IFC4X3_ADD2) → IFC4X3_ADD2`);
  return "IFC4X3_ADD2";
}

// ------------------------------------------------------------------------------------------------ ciele a súbory

/** `ciele`: všetky ciele (ER × poskytovateľ) knižnice, zoradené. */
export function ciele(k: Kniznica): Ciel[] {
  const out = new Map<string, Ciel>();
  const ery = k.vsetky.filter((n) => typPoznamky(n) === "ER" && n.model !== null).sort((a, b) => ((idPoznamky(a) ?? "") < (idPoznamky(b) ?? "") ? -1 : 1));
  for (const er of ery) {
    const j = jednotkyVymeny(k, idPoznamky(er)!);
    for (const nid of j.objekty) {
      const n = k.poznamky.get(nid);
      if (!n || !n.model) continue;
      if (kontajneryObjektu(j, nid).length && !rozsahObjektu(j, nid).has("alfanumerika")) continue;
      const [prov] = providerOf(er, n);
      if (prov !== null) out.set(`${idPoznamky(er)}\u0000${prov}`, { er: idPoznamky(er)!, poskytovatel: prov });
    }
  }
  return [...out.values()].sort((a, b) => (a.er < b.er ? -1 : a.er > b.er ? 1 : a.poskytovatel < b.poskytovatel ? -1 : a.poskytovatel > b.poskytovatel ? 1 : 0));
}

/** `generuj_ciel`: (text IDS, správa o tom, čo sa nedalo zmapovať) pre jeden cieľ. */
export function generujCiel(k: Kniznica, ciel: Ciel, datum: string | null = null): [string, Report] {
  const rep = new Report();
  const er = k.poznamky.get(ciel.er);
  if (!er || !er.model) throw new Error(`${ciel.er} sa nedá načítať`);
  const ifcVersion = ifcVersionOf(er, rep);
  const root = prvok(q("ids"), { [q("schemaLocation", XSI_NS)]: `${IDS_NS} http://standards.buildingsmart.org/IDS/1.0/ids.xsd` });
  buildInfo(k, er, ciel, root, rep, datum);
  const specs = sub(root, "specifications");
  const ius = objektyCiela(k, er, ciel, rep);
  for (const iu of ius) {
    specs.deti.push(buildIuSpec(k, ciel.er, iu, ifcVersion, rep));
    rep.specs.push(`${idPoznamky(iu)} (IU-O, ${pyStr(attr(iu.model!.objekt, "ifc_entita"))})`);
  }
  for (const [pz, dovod] of applicableRules(k, ciel.er, ius, rep)) {
    const spec = buildRuleSpec(k, pz, dovod, ifcVersion, rep);
    if (spec) {
      specs.deti.push(spec);
      rep.specs.push(`${pz.id} (STD, ${dovod})`);
    }
  }
  rep.objekty = ius.map((iu) => idPoznamky(iu)!);
  odsad(root, "  ");
  return [`${vypis(root, PREFIXY)}\n`, rep];
}
