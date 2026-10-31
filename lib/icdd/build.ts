/**
 * Zloženie kontajnera ICDD (ISO 21597-1/-2) z plánu a obsahu payloadov (D-181, #350).
 * Čisté funkcie: `buildIndex`, `buildLinksets`, `buildAimOntology` vracajú RDF/XML text,
 * `assembleIcdd` ZIP. Rovnaký plán a payloady = bajtovo rovnaký kontajner (zoradené trojice,
 * IRI linkov z hashu, pevné časy v ZIP); medzi dvoma exportmi sa mení len ct:creationDate.
 */

import { zipSync, type Zippable } from "fflate";

import {
  AIM_ONTOLOGY_FILE,
  CONFORMANCE,
  containerBase,
  CT,
  DIR_DOCUMENTS,
  DIR_ONTOLOGY,
  DIR_TRIPLES,
  ELS,
  INDEX_FILE,
  ISO,
  ISO_ONTOLOGY_FILES,
  LAYER_OF,
  LS,
  type IcddLink,
  type IcddPayload,
  type IcddPlan,
  type Layer,
  type LinkEnd,
} from "./model";
import { iri, lit, OWL, RDF_TYPE, RDFS, writeRdfXml, XSD, type Term, type Triple } from "./rdf";
import { sha256 } from "./sha256";

/** Vlastnosti AIM ontológie (lokálne mená). */
export const AIM_PROPS = [
  "source",
  "role",
  "derivationRule",
  "basedOnRevision",
  "objectRef",
  "identification",
  "model",
  "status",
  "approval",
  "revisionNo",
] as const;

export const aimTerm = (plan: Pick<IcddPlan, "aimNamespace">, local: string) => `${plan.aimNamespace}${local}`;

export const docIri = (plan: Pick<IcddPlan, "versionID">, p: Pick<IcddPayload, "id">) =>
  `${containerBase(plan.versionID)}#doc-${slug(p.id)}`;
export const linksetIri = (plan: Pick<IcddPlan, "versionID">, layer: string) => `${containerBase(plan.versionID)}#linkset-${layer}`;
const containerIri = (plan: Pick<IcddPlan, "versionID">) => `${containerBase(plan.versionID)}#container`;

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

const PREFIXES = (plan: IcddPlan): Record<string, string> => ({
  ct: CT,
  ls: LS,
  els: ELS,
  aim: plan.aimNamespace,
  owl: OWL,
  rdfs: RDFS,
  xsd: XSD,
});

/** `ct:ContainerDescription` s dokumentmi, linksetmi a vydavateľom. */
export function buildIndex(plan: IcddPlan): string {
  const t: Triple[] = [];
  const add = (s: string, p: string, o: Term) => t.push({ s: iri(s), p, o });
  const base = containerBase(plan.versionID);
  const c = containerIri(plan);
  add(base, RDF_TYPE, iri(`${OWL}Ontology`));
  add(base, `${OWL}imports`, iri(ISO.Container));
  add(c, RDF_TYPE, iri(`${CT}ContainerDescription`));
  add(c, `${CT}conformanceIndicator`, lit(CONFORMANCE));
  add(c, `${CT}versionID`, lit(plan.versionID));
  add(c, `${CT}versionDescription`, lit(plan.versionDescription));
  add(c, `${CT}creationDate`, lit(plan.createdAt, `${XSD}dateTime`));
  if (plan.description) add(c, `${CT}description`, lit(plan.description));
  const pub = `${base}#publisher`;
  add(c, `${CT}publishedBy`, iri(pub));
  add(pub, RDF_TYPE, iri(`${CT}Party`)); // najmenej zaväzujúce: bez Organisation/Person (D-181 bod 4, otvorené)
  add(pub, `${CT}name`, lit(plan.publisher.name));

  for (const p of plan.payloads) {
    const d = docIri(plan, p);
    add(c, `${CT}containsDocument`, iri(d));
    add(d, RDF_TYPE, iri(`${CT}InternalDocument`));
    add(d, RDF_TYPE, iri(`${CT}SecuredDocument`));
    add(d, `${CT}belongsToContainer`, iri(c));
    add(d, `${CT}name`, lit(p.name));
    add(d, `${CT}filename`, lit(p.filename));
    add(d, `${CT}filetype`, lit(p.filetype));
    add(d, `${CT}format`, lit(p.format));
    add(d, `${CT}versionID`, lit(p.versionID));
    if (p.description) add(d, `${CT}description`, lit(p.description));
    add(d, `${CT}checksum`, lit(p.sha256));
    add(d, `${CT}checksumAlgorithm`, lit("SHA-256"));
    add(d, aimTerm(plan, "identification"), lit(p.identification));
    if (p.model) add(d, aimTerm(plan, "model"), lit(p.model));
    if (p.objectRef) add(d, aimTerm(plan, "objectRef"), lit(p.objectRef));
    if (p.status) add(d, aimTerm(plan, "status"), lit(p.status));
    if (p.approval != null) add(d, aimTerm(plan, "approval"), lit(JSON.stringify(p.approval)));
    if (p.revisionNo != null) add(d, aimTerm(plan, "revisionNo"), lit(p.revisionNo));
  }
  for (const layer of plan.layers) {
    const l = linksetIri(plan, layer);
    add(c, `${CT}containsLinkset`, iri(l));
    add(l, RDF_TYPE, iri(`${CT}Linkset`));
    add(l, `${CT}filename`, lit(`${layer}.rdf`));
  }
  return writeRdfXml(t, PREFIXES(plan));
}

/** Kľúč konca linku nezávislý od IRI: súbor + GlobalId / strana. */
export function endKey(e: { file: string; guid?: string | null; page?: number | null }): string {
  return `${e.file}|${e.guid ?? ""}|${e.page ?? ""}`;
}

/** Jeden linkset na vrstvu: `ls:Link` podtriedy s `ls:LinkElement` a identifikátormi (GlobalId, strana PDF). */
export function buildLinksets(plan: IcddPlan): Record<Layer, string> {
  const payloads = new Map(plan.payloads.map((p) => [p.id, p]));
  const base = containerBase(plan.versionID);
  const per = new Map<Layer, Triple[]>(plan.layers.map((l) => [l, []]));

  for (const link of plan.links) {
    const layer = LAYER_OF[link.kind];
    const t = per.get(layer);
    if (!t) continue;
    const lsBase = `${base}/${layer}`;
    const add = (s: string, p: string, o: Term) => t.push({ s: iri(s), p, o });

    const element = (end: LinkEnd): string => {
      const p = payloads.get(end.payload);
      if (!p) throw new Error(`ICDD: link ukazuje na neznámy payload ${end.payload}`);
      const key = endKey({ file: p.filename, guid: end.guid, page: end.page });
      const e = `${lsBase}#E-${sha256(key).slice(0, 20)}`;
      add(e, RDF_TYPE, iri(`${LS}LinkElement`));
      add(e, `${LS}hasDocument`, iri(docIri(plan, p)));
      if (end.objectRef) add(e, aimTerm(plan, "objectRef"), lit(end.objectRef));
      if (end.label) add(e, `${RDFS}label`, lit(end.label));
      if (end.guid) {
        const id = `${lsBase}#I-${sha256(`guid|${end.guid}`).slice(0, 20)}`;
        add(e, `${LS}hasIdentifier`, iri(id));
        add(id, RDF_TYPE, iri(`${LS}StringBasedIdentifier`));
        add(id, `${LS}identifier`, lit(end.guid));
        add(id, `${LS}identifierField`, lit("GlobalId"));
      } else if (end.page) {
        const uri = `${p.filename}#page=${end.page}`;
        const id = `${lsBase}#I-${sha256(`uri|${uri}`).slice(0, 20)}`;
        add(e, `${LS}hasIdentifier`, iri(id));
        add(id, RDF_TYPE, iri(`${LS}URIBasedIdentifier`));
        add(id, `${LS}uri`, lit(encodeURI(uri), `${XSD}anyURI`));
      }
      return e;
    };

    const from = element(link.from);
    const to = element(link.to);
    const l = `${lsBase}#L-${sha256(linkKey(plan, link)).slice(0, 24)}`;
    if (link.kind === "IsIdenticalTo") {
      add(l, RDF_TYPE, iri(`${ELS}IsIdenticalTo`));
      add(l, `${LS}hasLinkElement`, iri(from));
      add(l, `${LS}hasLinkElement`, iri(to));
    } else {
      add(l, RDF_TYPE, iri(link.kind === "IsElaboratedBy" ? `${ELS}IsElaboratedBy` : aimTerm(plan, link.kind)));
      add(l, `${LS}hasFromLinkElement`, iri(from));
      add(l, `${LS}hasToLinkElement`, iri(to));
    }
    if (link.source) add(l, aimTerm(plan, "source"), lit(link.source));
    if (link.role) add(l, aimTerm(plan, "role"), lit(link.role));
    if (link.rule) add(l, aimTerm(plan, "derivationRule"), lit(link.rule));
    if (link.basedOn) add(l, aimTerm(plan, "basedOnRevision"), lit(link.basedOn));
  }

  const out = {} as Record<Layer, string>;
  for (const [layer, t] of per) {
    const onto = `${base}/${layer}`;
    t.push({ s: iri(onto), p: RDF_TYPE, o: iri(`${OWL}Ontology`) });
    for (const imp of [ISO.Linkset, ISO.ExtendedLinkset, plan.aimNamespace.replace(/#$/, "")])
      t.push({ s: iri(onto), p: `${OWL}imports`, o: iri(imp) });
    out[layer] = writeRdfXml(t, PREFIXES(plan));
  }
  return out;
}

/** Kanonický kľúč väzby (bez IRI), rovnaký pri exporte aj po importe: základ roundtripu. */
export function linkKey(plan: Pick<IcddPlan, "payloads">, link: IcddLink): string {
  const file = (id: string) => plan.payloads.find((p) => p.id === id)?.filename ?? `?${id}`;
  let a = endKey({ file: file(link.from.payload), guid: link.from.guid, page: link.from.page });
  let b = endKey({ file: file(link.to.payload), guid: link.to.guid, page: link.to.page });
  if (link.kind === "IsIdenticalTo" && b < a) [a, b] = [b, a];
  return [link.kind, a, b, link.source ?? "", link.role ?? "", link.rule ?? "", link.basedOn ?? ""].join(" ");
}

/** Vlastná ontológia AIM: len to, čo ISO 21597-2 nemá (D-181, plán #350 časť 2.4). */
export function buildAimOntology(plan: Pick<IcddPlan, "aimNamespace">): string {
  const ns = plan.aimNamespace;
  const onto = ns.replace(/#$/, "");
  const t: Triple[] = [];
  const add = (s: string, p: string, o: Term) => t.push({ s: iri(s), p, o });
  add(onto, RDF_TYPE, iri(`${OWL}Ontology`));
  add(onto, `${OWL}imports`, iri(ISO.Linkset));
  add(onto, `${RDFS}comment`, lit("AIM extensions for ICDD linksets (placeholder namespace, not published)."));
  const cls = `${ns}IsReferencedInSpatialStructure`;
  add(cls, RDF_TYPE, iri(`${OWL}Class`));
  add(cls, `${RDFS}subClassOf`, iri(`${LS}DirectedBinaryLink`));
  add(cls, `${RDFS}label`, lit("Is referenced in spatial structure"));
  add(
    cls,
    `${RDFS}comment`,
    lit("Element (from) is referenced in a spatial element (to), e.g. IfcSpace or IfcSpatialZone; named after IfcRelReferencedInSpatialStructure."),
  );
  for (const p of AIM_PROPS) {
    add(`${ns}${p}`, RDF_TYPE, iri(`${OWL}DatatypeProperty`));
    add(`${ns}${p}`, `${RDFS}range`, iri(p === "revisionNo" ? `${XSD}integer` : `${XSD}string`));
  }
  return writeRdfXml(t, { aim: ns, ls: LS, owl: OWL, rdfs: RDFS, xsd: XSD });
}

/** Pevný čas v ZIP (determinizmus): 1980-01-01, najmenší čas formátu ZIP. */
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

export interface AssembleInput {
  plan: IcddPlan;
  /** Obsah payloadov podľa `IcddPayload.id` (už rozbalený, sha256 overený volajúcim alebo tu). */
  payloads: Map<string, Uint8Array>;
  /** ISO ontológie podľa mena súboru (`Container.rdf`...). */
  ontologies: Record<string, string>;
}

/** Zloží `.icdd` (ZIP). Overí sha256 každého payloadu voči plánu; nesúlad = chyba, nič sa nezloží. */
export function assembleIcdd({ plan, payloads, ontologies }: AssembleInput): Uint8Array {
  const enc = new TextEncoder();
  const files: Zippable = {};
  const put = (path: string, data: Uint8Array, level: 0 | 6 = 6) => {
    files[path] = [data, { level, mtime: ZIP_TIME }];
  };
  put(INDEX_FILE, enc.encode(buildIndex(plan)));
  for (const f of ISO_ONTOLOGY_FILES) {
    const text = ontologies[f];
    if (!text) throw new Error(`ICDD: chýba ontológia ${f}`);
    put(`${DIR_ONTOLOGY}${f}`, enc.encode(text));
  }
  put(`${DIR_ONTOLOGY}${AIM_ONTOLOGY_FILE}`, enc.encode(buildAimOntology(plan)));
  const names = new Set<string>();
  for (const p of plan.payloads) {
    const data = payloads.get(p.id);
    if (!data) throw new Error(`ICDD: chýba obsah ${p.filename}`);
    const got = sha256(data);
    if (got !== p.sha256) throw new Error(`ICDD: sha256 ${p.filename} nesedí (${got} vs ${p.sha256})`);
    if (names.has(p.filename)) throw new Error(`ICDD: duplicitné meno ${p.filename}`);
    names.add(p.filename);
    put(`${DIR_DOCUMENTS}${p.filename}`, data, p.filetype === "pdf" ? 0 : 6);
  }
  const linksets = buildLinksets(plan);
  for (const layer of plan.layers) put(`${DIR_TRIPLES}${layer}.rdf`, enc.encode(linksets[layer]));
  // fflate zapisuje v poradí kľúčov; zoradíme ich, aby poradie nezáviselo od plánu
  const sorted: Zippable = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];
  return zipSync(sorted);
}
