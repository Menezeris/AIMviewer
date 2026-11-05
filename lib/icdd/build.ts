/**
  * Assembly of an ICDD container (ISO 21597-1/-2) from the plan and the payload contents (D-181, #350).
  * Pure functions: `buildIndex`, `buildLinksets`, `buildAimOntology` return RDF/XML text,
  * `assembleIcdd` a ZIP. The same plan and payloads = a byte-identical container (sorted triples,
  * link IRIs from a hash, fixed times in the ZIP); between two exports only ct:creationDate changes.
 */

import { zipSync, type Zippable } from "fflate";

import {
  AIM_ONTOLOGY_FILE,
  CONFORMANCE,
  containerBase,
  containerFileName,
  CT,
  DIR_DOCUMENTS,
  DIR_ONTOLOGY,
  DIR_TRIPLES,
  ELS,
  EXCHANGE,
  INDEX_FILE,
  ISO,
  ISO_ONTOLOGY_FILES,
  LAYER_OF,
  IFC_DOCS_URL,
  IFC_RELATIONSHIP,
  LS,
  LS_BASE_TYPE,
  type IcddLink,
  type IcddPayload,
  type IcddPlan,
  type Layer,
  type LinkEnd,
} from "./model";
import { iri, lit, OWL, RDF_TYPE, RDFS, writeRdfXml, XSD, type Term, type Triple } from "./rdf";
import { sha256 } from "./sha256";
import { buildAimXlsx, XLSX_FILE } from "./xlsx";

/** Properties of the AIM ontology (local names). */
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
  "generatedFrom",
  "ifcRelationship",
  "relationshipId",
  "exchange",
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

/** `ct:ContainerDescription` with documents, linksets and the publisher. */
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
  add(pub, RDF_TYPE, iri(`${CT}Party`)); // least committing: without Organisation/Person (D-181 point 4, open)
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
    if (p.kind === "generated") add(d, aimTerm(plan, "generatedFrom"), lit("linksets"));
  }
  for (const layer of plan.layers) {
    const l = linksetIri(plan, layer);
    add(c, `${CT}containsLinkset`, iri(l));
    add(l, RDF_TYPE, iri(`${CT}Linkset`));
    add(l, `${CT}filename`, lit(`${layer}.rdf`));
        // only information for other tools; the import decides by EXCHANGE in code (D-181 addendum "import")
    add(l, aimTerm(plan, "exchange"), lit(EXCHANGE[layer]));
  }
  return writeRdfXml(t, PREFIXES(plan));
}

/** Link end key independent of the IRI: file + GlobalId (or `Class.Identification=value`) / page. */
export function endKey(e: {
  file: string;
  guid?: string | null;
  ident?: { field: string; value: string } | null;
  page?: number | null;
}): string {
  const id = e.guid ?? (e.ident ? `${e.ident.field}=${e.ident.value}` : "");
  return `${e.file}|${id}|${e.page ?? ""}`;
}

/** One linkset per layer: `ls:Link` subclasses with `ls:LinkElement` and identifiers (GlobalId, PDF page). */
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
      const key = endKey({ file: p.filename, guid: end.guid, ident: end.ident, page: end.page });
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
      } else if (end.ident) {
                // IfcDocumentInformation / IfcDocumentReference are not IfcRoot (no GlobalId): identity via Identification
        const id = `${lsBase}#I-${sha256(`ident|${end.ident.field}|${end.ident.value}`).slice(0, 20)}`;
        add(e, `${LS}hasIdentifier`, iri(id));
        add(id, RDF_TYPE, iri(`${LS}StringBasedIdentifier`));
        add(id, `${LS}identifier`, lit(end.ident.value));
        add(id, `${LS}identifierField`, lit(end.ident.field));
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
        // The custom aim: class also gets the superclass ls: (a consequence of rdfs:subClassOf from aim.rdf), so that a reader
        // without RDFS inference and without the aim: ontology (LS_BASE_TYPE) finds the link too.
    const lsType = LS_BASE_TYPE[link.kind];
    if (lsType) add(l, RDF_TYPE, iri(`${LS}${lsType}`));
    if (link.kind === "IsIdenticalTo" || link.kind === "DocumentIsIdenticalTo") {
      add(l, RDF_TYPE, iri(`${ELS}IsIdenticalTo`));
      add(l, `${LS}hasLinkElement`, iri(from));
      add(l, `${LS}hasLinkElement`, iri(to));
    } else {
      add(l, RDF_TYPE, iri(link.kind === "IsElaboratedBy" ? `${ELS}IsElaboratedBy` : aimTerm(plan, link.kind)));
      add(l, `${LS}hasFromLinkElement`, iri(from));
      add(l, `${LS}hasToLinkElement`, iri(to));
    }
    if (link.relationshipId) add(l, aimTerm(plan, "relationshipId"), lit(link.relationshipId));
    if (link.source) add(l, aimTerm(plan, "source"), lit(link.source));
    if (link.role) add(l, aimTerm(plan, "role"), lit(link.role));
    if (link.rule) add(l, aimTerm(plan, "derivationRule"), lit(link.rule));
    if (link.basedOn) add(l, aimTerm(plan, "basedOnRevision"), lit(link.basedOn));
    if (link.ifcRelationship) add(l, aimTerm(plan, "ifcRelationship"), lit(link.ifcRelationship));
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

/** Canonical key of a link (without the IRI), the same at export and after import: the basis of the roundtrip. */
export function linkKey(plan: Pick<IcddPlan, "payloads">, link: IcddLink): string {
  const file = (id: string) => plan.payloads.find((p) => p.id === id)?.filename ?? `?${id}`;
  let a = endKey({ file: file(link.from.payload), guid: link.from.guid, ident: link.from.ident, page: link.from.page });
  let b = endKey({ file: file(link.to.payload), guid: link.to.guid, ident: link.to.ident, page: link.to.page });
  if ((link.kind === "IsIdenticalTo" || link.kind === "DocumentIsIdenticalTo") && b < a) [a, b] = [b, a];
  return [link.kind, a, b, link.source ?? "", link.role ?? "", link.rule ?? "", link.basedOn ?? "", link.ifcRelationship ?? "", link.relationshipId ?? ""].join(" ");
}

/** The custom AIM ontology: only what ISO 21597-2 does not have (D-181, plan #350 part 2.4). */
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
  add(cls, `${RDFS}seeAlso`, iri(`${IFC_DOCS_URL}IfcRelReferencedInSpatialStructure.htm`));
  for (const p of AIM_PROPS) {
    add(`${ns}${p}`, RDF_TYPE, iri(`${OWL}DatatypeProperty`));
    add(`${ns}${p}`, `${RDFS}range`, iri(p === "revisionNo" ? `${XSD}integer` : `${XSD}string`));
  }
    // On which IFC semantics the links stand (D-181 point 3): the IFC relationship on the link + a reference to its definition in IFC 4.3.
  const rel = `${ns}ifcRelationship`;
  add(rel, `${RDFS}comment`, lit("Name of the IFC relationship (IFC 4.3 schema) whose semantics the link carries, e.g. IfcRelAssociatesDocument for els:IsElaboratedBy element -> document, IfcRelReferencedInSpatialStructure for aim:IsReferencedInSpatialStructure. Links in the AIM layer exist only where the relationship crosses files or is derived; relationships inside an IFC file stay in that file."));
  for (const name of [...new Set(Object.values(IFC_RELATIONSHIP))].sort()) add(rel, `${RDFS}seeAlso`, iri(`${IFC_DOCS_URL}${name}.htm`));
  add(`${ns}source`, `${RDFS}comment`, lit("Origin of the link in AIM (e.g. pdf_link (E4), doc_upload (D-036), derive:spatial_reference, ifc_storey_map:name_number, ifc:ASR v79 for document identity)."));
  add(`${ns}relationshipId`, `${RDFS}comment`, lit("Identifier of the link in AIM (relationships.id, UUID). A tool that changes a link keeps it; a new link has none. Import pairs links by this id first, then by content."));
  add(
    `${ns}exchange`,
    `${RDFS}comment`,
    lit("On ct:Linkset in the index: export-only = links are created in AIM and other tools should not change them (a change is reported on import, never written); import = other tools may add or change links (element -> document). Informative: AIM decides by its own policy; the mark can only restrict import."),
  );
  add(`${ns}basedOnRevision`, `${RDFS}comment`, lit("Container revisions the link was created from, e.g. ASR=79;VZT=11."));
  add(
    onto,
    `${RDFS}comment`,
    lit("Document identity (els:IsIdenticalTo, layer documents-identity) links IfcDocumentInformation / IfcDocumentReference in an IFC payload (ls:identifierField <Class>.Identification) to the document file in the container; element -> document links from IfcRelAssociatesDocument inside IFC files are not duplicated."),
  );
  return writeRdfXml(t, { aim: ns, ls: LS, owl: OWL, rdfs: RDFS, xsd: XSD });
}

/** Fixed time in the ZIP (determinism): 1980-01-01, the smallest time of the ZIP format. */
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

export interface AssembleInput {
  plan: IcddPlan;
    /** Payload contents by `IcddPayload.id` (already unpacked, sha256 verified by the caller or here). */
  payloads: Map<string, Uint8Array>;
    /** ISO ontologies by file name (`Container.rdf`...). */
  ontologies: Record<string, string>;
}

/**
  * Extra files from the plan links (option `extras`): xlsx listing of linksets. They do not go into the container (Samuel 1. 11., ICDD audit:
  * the listing would duplicate the truth of the linksets and could go stale), they are downloaded next to the `.icdd`.
 */
export function sideFiles(plan: IcddPlan): { filename: string; mime: string; bytes: Uint8Array }[] {
  const out: { filename: string; mime: string; bytes: Uint8Array }[] = [];
  if (plan.extras?.includes("xlsx"))
    out.push({
      filename: `${containerFileName(plan.versionID).replace(/\.icdd$/, "")}_${XLSX_FILE}`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: buildAimXlsx(plan),
    });
  return out;
}

/** Assembles the `.icdd` (ZIP). Verifies the sha256 of every payload against the plan; a mismatch = an error, nothing is assembled. */
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
    put(`${DIR_DOCUMENTS}${p.filename}`, data, p.filetype === "pdf" || p.filetype === "xlsx" ? 0 : 6);
  }
  const linksets = buildLinksets(plan);
  for (const layer of plan.layers) put(`${DIR_TRIPLES}${layer}.rdf`, enc.encode(linksets[layer]));
    // fflate writes in key order; we sort them so that the order does not depend on the plan
  const sorted: Zippable = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];
  return zipSync(sorted);
}
