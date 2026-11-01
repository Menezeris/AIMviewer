import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strToU8 } from "fflate";

import { assembleIcdd } from "./build";
import { DEFAULT_AIM_NAMESPACE, ISO_ONTOLOGY_FILES, type IcddPlan } from "./model";
import { sha256 } from "./sha256";

/**
 * Malý kontajner z exportného kódu (len pre testy): audit v Pythone (`etl/icdd_audit.py`) a import (`import.test.ts`).
 * Súbor `etl/tests/fixtures/icdd/aim-small.icdd` stráži `audit-fixture.test.ts`.
 */
export const FIXTURE = join(__dirname, "../../etl/tests/fixtures/icdd/aim-small.icdd");
export const FIXTURE_LINKS = join(__dirname, "../../etl/tests/fixtures/icdd/aim-small.links.json");
const ONTO_DIR = join(__dirname, "../../public/icdd/ontology");
const ontologies = Object.fromEntries(ISO_ONTOLOGY_FILES.map((f) => [f, readFileSync(join(ONTO_DIR, f), "utf8")]));

export const G = {
  space: "0BTBFw6f90Nfh9rP1dlXrb",
  zone: "3Zu5Bv0LOHrPC10066FoQQ",
  storeyA: "2VefEmfcj8sx0WLKr$GNnn",
  storeyV: "0JLkyEBbbEZg_9L47b5QYb",
  duct: "1hOSvn6df7F8_7GcBWlRGQ",
  terminal: "2Fz7wd1Nf3UPDBRfDCbx4c",
  cowl: "0pqk6UmJD2ARFkiAMMqZvv",
  port: "0EaVSNGKg1TW6brMA6EQFN",
};

export const ifc = (lines: string[]) =>
  strToU8(
    [
      "ISO-10303-21;",
      "HEADER;FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');FILE_NAME('x','2026-11-01T00:00:00',(''),(''),'','','');FILE_SCHEMA(('IFC4X3_ADD2'));ENDSEC;",
      "DATA;",
      ...lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n"),
  );

export const ASR = ifc([
  `#1=IFCSPACE('${G.space}',$,'1.01',$,$,$,$,$,$,$,$);`,
  `#2=IFCSPATIALZONE('${G.zone}',$,'PU-01',$,$,$,$,$,.FIRESAFETY.);`,
  `#3=IFCBUILDINGSTOREY('${G.storeyA}',$,'1NP',$,$,$,$,$,.ELEMENT.,0.);`,
  "#4=IFCDOCUMENTINFORMATION('D.1.1.09','V\\X2\\00FD\\X0\\pis skladieb',$,$,$,$,$,$,$,$,$,$,$,$,$,$,$);",
  "#5=IFCDOCUMENTREFERENCE('D-1-1-09.pdf#page=3','page=3','S1',$,#4);",
]);
export const VZT = ifc([
  `#1=IFCDUCTSEGMENT('${G.duct}',$,'PO.01',$,$,$,$,$,$);`,
  `#2=IFCAIRTERMINAL('${G.terminal}',$,'VV.01.01.001',$,$,$,$,$,$);`,
  `#3=IFCAIRTERMINAL('${G.cowl}',$,'VV.07.04.001',$,$,$,$,$,.USERDEFINED.);`,
  `#4=IFCBUILDINGSTOREY('${G.storeyV}',$,'1NP_VZT',$,$,$,$,$,.ELEMENT.,0.);`,
  `#5=IFCRELCONTAINEDINSPATIALSTRUCTURE('1fV3QnJ4n0aB7Q5BmA6Wq1',$,$,$,(#1,#2,#3),#4);`,
  `#6=IFCDISTRIBUTIONPORT('${G.port}',$,'Port',$,$,$,$,.SOURCE.,.DUCT.,$);`,
  `#7=IFCRELNESTS('2fV3QnJ4n0aB7Q5BmA6Wq2',$,$,$,#1,(#6));`,
]);
export const PDF = strToU8("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");

export function fixturePlan(): IcddPlan {
  return {
    versionID: "2026-11-01_ASR-v079_VZT-v011_D1",
    versionDescription: "ASR v79, VZT v11, 1 dokumentov k 2026-11-01; vrstvy documents-elements, documents-identity, derived-spatial, federation",
    createdAt: "2026-11-01T12:00:00Z",
    description: "Testovací kontajner pre audit",
    publisher: { name: "AIM" },
    aimNamespace: DEFAULT_AIM_NAMESPACE,
    layers: ["documents-elements", "documents-identity", "derived-spatial", "federation"],
    skipped: {},
    warnings: [],
    payloads: [
      { id: "model:ASR", kind: "model", filename: "ASR_v079.ifc", name: "ASR", filetype: "ifc", format: "application/x-step", versionID: "79", sha256: sha256(ASR), url: "x", gzip: false, identification: "ASR", model: "ASR", status: "DRAFT", revisionNo: 79 },
      { id: "model:VZT", kind: "model", filename: "VZT_v011.ifc", name: "VZT", filetype: "ifc", format: "application/x-step", versionID: "11", sha256: sha256(VZT), url: "x", gzip: false, identification: "VZT", model: "VZT", status: "DRAFT", revisionNo: 11 },
      { id: "document:D.1.1.09", kind: "document", filename: "D-1-1-09.pdf", name: "D.1.1.09 Výpis skladieb", filetype: "pdf", format: "application/pdf", versionID: "1", sha256: sha256(PDF), url: "x", gzip: false, identification: "D.1.1.09", objectRef: "D-1-1-09" },
    ],
    links: [
      // AIM vrstva prvok -> dokument (importovateľná, D-181 dodatok "import"): id väzby v AIM a revízia modelu prvku
      { kind: "IsElaboratedBy", relationshipId: "11111111-1111-4111-8111-111111111111", from: { payload: "model:VZT", guid: G.terminal, objectRef: "VV.01.01.001" }, to: { payload: "document:D.1.1.09", page: 3 }, source: "pdf_link (E4)", basedOn: "VZT=11", ifcRelationship: "IfcRelAssociatesDocument" },
      { kind: "IsElaboratedBy", relationshipId: "22222222-2222-4222-8222-222222222222", from: { payload: "model:VZT", guid: G.duct, objectRef: "PO.01" }, to: { payload: "document:D.1.1.09" }, source: "doc_upload (D-036)", basedOn: "VZT=11", ifcRelationship: "IfcRelAssociatesDocument" },
      { kind: "IsReferencedInSpatialStructure", from: { payload: "model:VZT", guid: G.duct, objectRef: "PO.01" }, to: { payload: "model:ASR", guid: G.space }, source: "derive:spatial_reference", role: "partial", rule: "element_in_space", basedOn: "ASR=79;VZT=11", ifcRelationship: "IfcRelReferencedInSpatialStructure" },
      { kind: "IsReferencedInSpatialStructure", from: { payload: "model:VZT", guid: G.terminal, objectRef: "VV.01.01.001" }, to: { payload: "model:ASR", guid: G.space }, source: "derive:spatial_reference", role: "inside", rule: "element_in_space", basedOn: "ASR=79;VZT=11", ifcRelationship: "IfcRelReferencedInSpatialStructure" },
      { kind: "IsReferencedInSpatialStructure", from: { payload: "model:VZT", guid: G.terminal, objectRef: "VV.01.01.001" }, to: { payload: "model:ASR", guid: G.zone }, source: "derive:element_in_spatial_zone", role: "inside", rule: "element_in_spatial_zone", basedOn: "ASR=79;VZT=11", ifcRelationship: "IfcRelReferencedInSpatialStructure" },
      { kind: "IsIdenticalTo", from: { payload: "model:VZT", guid: G.storeyV, label: "1NP_VZT" }, to: { payload: "model:ASR", guid: G.storeyA, label: "1NP" }, source: "ifc_storey_map:name_number", basedOn: "ASR=79;VZT=11" },
      { kind: "DocumentIsIdenticalTo", from: { payload: "model:ASR", ident: { field: "IfcDocumentInformation.Identification", value: "D.1.1.09" } }, to: { payload: "document:D.1.1.09" }, source: "ifc:ASR v79" },
      { kind: "DocumentIsIdenticalTo", from: { payload: "model:ASR", ident: { field: "IfcDocumentReference.Identification", value: "page=3" } }, to: { payload: "document:D.1.1.09", page: 3 }, source: "ifc:ASR v79" },
    ],
  };
}

export const buildFixture = () =>
  assembleIcdd({
    plan: fixturePlan(),
    payloads: new Map([
      ["model:ASR", ASR],
      ["model:VZT", VZT],
      ["document:D.1.1.09", PDF],
    ]),
    ontologies,
  });

