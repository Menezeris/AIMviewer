/**
  * Data model of the ICDD export (D-181, #350). `IcddPlan` is pure JSON: the host builds it from the DB
  * (`lib/icdd/plan.ts`), the browser downloads the payloads by it and assembles the container (`lib/icdd/build.ts`),
  * at import the container is read back to the same links (`lib/icdd/roundtrip.ts`).
 */

export const ISO = {
  Container: "https://standards.iso.org/iso/21597/-1/ed-1/en/Container",
  Linkset: "https://standards.iso.org/iso/21597/-1/ed-1/en/Linkset",
  ExtendedLinkset: "https://standards.iso.org/iso/21597/-2/ed-1/en/ExtendedLinkset",
} as const;

export const CT = `${ISO.Container}#`;
export const LS = `${ISO.Linkset}#`;
export const ELS = `${ISO.ExtendedLinkset}#`;

/** Namespace of the custom AIM ontology: a placeholder from configuration, unpublished (Samuel 30. 10., question 9 in #350). */
export const DEFAULT_AIM_NAMESPACE = "urn:x-aim:icdd#";

/** ISO ontologies bundled in `Ontology resources/` (files in `public/icdd/ontology/`). */
export const ISO_ONTOLOGY_FILES = ["Container.rdf", "Linkset.rdf", "ExtendedLinkset.rdf"] as const;
export const AIM_ONTOLOGY_FILE = "aim.rdf";

export const DIR_ONTOLOGY = "Ontology resources/";
export const DIR_DOCUMENTS = "Payload documents/";
export const DIR_TRIPLES = "Payload triples/";
/**
  * Container header. ICDDToolkitCore (RUB) reads it only as "index.rdf" (exact match), openbim-icdd regardless of
  * letter case (ICDD audit 1. 11.); reading (`readIcdd`) also accepts another spelling with a warning.
 */
export const INDEX_FILE = "index.rdf";

export const CONFORMANCE = "ICDD-Part1-Container";

/** Linkset layers. MVP: the first three; the others are prepared as an option for the future (Samuel, question 2). */
export const LAYERS = ["documents-elements", "documents-identity", "derived-spatial", "federation"] as const;
export const FUTURE_LAYERS = ["georef", "bcf", "ids"] as const;
export type Layer = (typeof LAYERS)[number];

/** Optional extra files generated from the plan links (D-181 point 9): xlsx listing of linksets (IFCX omitted, Samuel 31. 10.). */
export const EXTRAS = ["xlsx"] as const;
export type Extra = (typeof EXTRAS)[number];

/**
  * `IsIdenticalTo` = a model storey without a node <-> the storey the node owns (federation);
  * `DocumentIsIdenticalTo` = a document in the IFC (IfcDocumentInformation / IfcDocumentReference) <-> a PDF file in the container
  * (documents-identity); both are written as `els:IsIdenticalTo`, they differ by layer.
 */
export type LinkKind = "IsElaboratedBy" | "IsReferencedInSpatialStructure" | "IsIdenticalTo" | "DocumentIsIdenticalTo";

/**
  * Superclass in ls: (ISO 21597-1), written on the link next to the custom aim: class (Samuel 1. 11., ICDD audit).
  * Readers without RDFS inference look for links by exact type: ICDDToolkitCore (RUB) ls: and els:, openbim-icdd only
  * ls:. els: links (Part 2) do not get it, because ICDDToolkitCore would load a link typed both ls: and els: twice.
 */
export const LS_BASE_TYPE: Partial<Record<LinkKind, "DirectedBinaryLink">> = {
  IsReferencedInSpatialStructure: "DirectedBinaryLink",
};

export const LAYER_OF: Record<LinkKind, Layer> = {
  IsElaboratedBy: "documents-elements",
  IsReferencedInSpatialStructure: "derived-spatial",
  IsIdenticalTo: "federation",
  DocumentIsIdenticalTo: "documents-identity",
};

/**
  * IFC relationship on whose semantics the link stands (D-181, Samuel 31. 10.: "it must be preserved that it is clear on what basis
  * that linkset works"). Written on the link as `aim:ifcRelationship` and into `aim.rdf` as `rdfs:seeAlso`.
 */
export const IFC_RELATIONSHIP: Partial<Record<LinkKind, string>> = {
  IsElaboratedBy: "IfcRelAssociatesDocument",
  IsReferencedInSpatialStructure: "IfcRelReferencedInSpatialStructure",
};

/**
  * Linkset exchange with other tools (D-181 addendum "import", Samuel 1. 11.). This table in code decides, not the marker
  * in the container (a foreign tool can overwrite it): `export-only` = the data originates in AIM and another tool does not change it
  * (a change shows up at import as a finding), `import` = links may be added or changed by another tool. It goes into the index
  * as `aim:exchange` on `ct:Linkset`, informational only.
 */
export type Exchange = "export-only" | "import";
export const EXCHANGE: Record<Layer, Exchange> = {
  "documents-elements": "import",
  "documents-identity": "export-only",
  "derived-spatial": "export-only",
  federation: "export-only",
};
/** Link classes that the import writes (element -> document or page, `rel_associates_document` AIM layer). */
export const IMPORTABLE_KINDS: readonly LinkKind[] = ["IsElaboratedBy"];

export const IFC_DOCS_URL = "https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/";

/** File in `Payload documents/` (ct:InternalDocument + ct:SecuredDocument). */
export interface IcddPayload {
    /** Stable key in the plan: `model:ASR`, `document:<identification>`. */
  id: string;
    /** `generated` = a file created at export from the links (IFCX, xlsx), not a revision container. */
  kind: "model" | "document" | "generated";
    /** Name in `Payload documents/` (flat, unique). */
  filename: string;
  name: string;
  filetype: string;
  format: string;
    /** Container revision (D-183): model `79`, document `revision` or the revision order. */
  versionID: string;
    /** sha256 of the uncompressed content (model_revisions / documents.file_sha256). */
  sha256: string;
  sizeBytes?: number | null;
  description?: string | null;
    /** Where the browser downloads it (public bucket). */
  url: string;
    /** true = the file in storage is gzip (revision archive `vNNN.ifc.gz`, D-135); it goes into the container unpacked. */
  gzip: boolean;
  identification: string;
  model?: string | null;
  objectRef?: string | null;
    /** ISO 19650 status from `container_revisions` (D-183 point 8): `IfcDocumentStatusEnum` and `IfcApproval` (empty for now). */
  status?: string | null;
  approval?: unknown;
  revisionNo?: number | null;
}

/** Link end = ls:LinkElement: a document in the container + optionally GlobalId or page. */
export interface LinkEnd {
  /** `IcddPayload.id`. */
  payload: string;
  guid?: string | null;
    /** Identifier without GlobalId: `<Class>.Identification=<value>` (IfcDocumentInformation, IfcDocumentReference). */
  ident?: { field: string; value: string } | null;
  page?: number | null;
  objectRef?: string | null;
  label?: string | null;
}

export interface IcddLink {
  kind: LinkKind;
    /** `relationships.id` of the link in AIM (`aim:relationshipId`); computed links (identity, storeys) do not have it. */
  relationshipId?: string | null;
  from: LinkEnd;
  to: LinkEnd;
    /** Origin of the link in AIM (`relationships.source`, e.g. `pdf_link (E4)`, `derive:spatial_reference`, `ifc:ASR v79`). */
  source?: string | null;
  role?: string | null;
  /** Pravidlo odvodenia (`derivation_rules.id`). */
  rule?: string | null;
    /** Revisions over which the link arose, canonically `ASR=79;VZT=11` (D-183 point 4). */
  basedOn?: string | null;
    /** IFC relationship whose semantics the link carries (`IFC_RELATIONSHIP`). */
  ifcRelationship?: string | null;
}

export interface IcddPlan {
  versionID: string;
  versionDescription: string;
    /** ISO date and time of the export (ct:creationDate); the only thing that changes between two exports of the same state. */
  createdAt: string;
  description?: string | null;
  publisher: { name: string };
  aimNamespace: string;
  payloads: IcddPayload[];
  links: IcddLink[];
  layers: Layer[];
    /** Extra files; missing = none. */
  extras?: Extra[];
    /** What did not make it into the container and why (counts), e.g. a document without a file. */
  skipped: Record<string, number>;
  warnings: string[];
}

export function containerBase(versionID: string): string {
  return `urn:x-aim:container:${encodeURIComponent(versionID)}`;
}

export function containerFileName(versionID: string): string {
  return `AIM_${versionID.replace(/[^\w.-]+/g, "_")}.icdd`;
}
