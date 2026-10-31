/**
 * Dátový model exportu ICDD (D-181, #350). `IcddPlan` je čisté JSON: host ho zostaví z DB
 * (`lib/icdd/plan.ts`), prehliadač podľa neho stiahne payloady a zloží kontajner (`lib/icdd/build.ts`),
 * pri importe sa kontajner prečíta späť na rovnaké väzby (`lib/icdd/roundtrip.ts`).
 */

export const ISO = {
  Container: "https://standards.iso.org/iso/21597/-1/ed-1/en/Container",
  Linkset: "https://standards.iso.org/iso/21597/-1/ed-1/en/Linkset",
  ExtendedLinkset: "https://standards.iso.org/iso/21597/-2/ed-1/en/ExtendedLinkset",
} as const;

export const CT = `${ISO.Container}#`;
export const LS = `${ISO.Linkset}#`;
export const ELS = `${ISO.ExtendedLinkset}#`;

/** Namespace vlastnej ontológie AIM: placeholder z konfigurácie, nezverejnený (Samuel 30. 10., otázka 9 v #350). */
export const DEFAULT_AIM_NAMESPACE = "urn:x-aim:icdd#";

/** ISO ontológie pribalené v `Ontology resources/` (súbory v `public/icdd/ontology/`). */
export const ISO_ONTOLOGY_FILES = ["Container.rdf", "Linkset.rdf", "ExtendedLinkset.rdf"] as const;
export const AIM_ONTOLOGY_FILE = "aim.rdf";

export const DIR_ONTOLOGY = "Ontology resources/";
export const DIR_DOCUMENTS = "Payload documents/";
export const DIR_TRIPLES = "Payload triples/";
export const INDEX_FILE = "index.rdf";

export const CONFORMANCE = "ICDD-Part1-Container";

/** Vrstvy linksetu. MVP: prvé tri; ďalšie sú pripravené ako voľba do budúcnosti (Samuel, otázka 2). */
export const LAYERS = ["documents-elements", "derived-spatial", "federation"] as const;
export const FUTURE_LAYERS = ["georef", "bcf", "ids"] as const;
export type Layer = (typeof LAYERS)[number];

/** Voliteľné súbory navyše, generované z väzieb plánu (D-181 bod 9): IFCX overlay a xlsx výpis. */
export const EXTRAS = ["ifcx", "xlsx"] as const;
export type Extra = (typeof EXTRAS)[number];

export type LinkKind = "IsElaboratedBy" | "IsReferencedInSpatialStructure" | "IsIdenticalTo";

export const LAYER_OF: Record<LinkKind, Layer> = {
  IsElaboratedBy: "documents-elements",
  IsReferencedInSpatialStructure: "derived-spatial",
  IsIdenticalTo: "federation",
};

/** Súbor v `Payload documents/` (ct:InternalDocument + ct:SecuredDocument). */
export interface IcddPayload {
  /** Stabilný kľúč v pláne: `model:ASR`, `document:<identification>`. */
  id: string;
  /** `generated` = súbor vytvorený pri exporte z väzieb (IFCX, xlsx), nie kontajner revízie. */
  kind: "model" | "document" | "generated";
  /** Meno v `Payload documents/` (ploché, unikátne). */
  filename: string;
  name: string;
  filetype: string;
  format: string;
  /** Revízia kontajnera (D-183): model `79`, dokument `revision` alebo poradie revízie. */
  versionID: string;
  /** sha256 nekomprimovaného obsahu (model_revisions / documents.file_sha256). */
  sha256: string;
  sizeBytes?: number | null;
  description?: string | null;
  /** Kde ho prehliadač stiahne (verejný bucket). */
  url: string;
  /** true = súbor v úložisku je gzip (archív revízie `vNNN.ifc.gz`, D-135); do kontajnera ide rozbalený. */
  gzip: boolean;
  identification: string;
  model?: string | null;
  objectRef?: string | null;
  /** Stav ISO 19650 z `container_revisions` (D-183 bod 8): `IfcDocumentStatusEnum` a `IfcApproval` (zatiaľ prázdny). */
  status?: string | null;
  approval?: unknown;
  revisionNo?: number | null;
}

/** Koniec linku = ls:LinkElement: dokument v kontajneri + voliteľne GlobalId alebo strana. */
export interface LinkEnd {
  /** `IcddPayload.id`. */
  payload: string;
  guid?: string | null;
  page?: number | null;
  objectRef?: string | null;
  label?: string | null;
}

export interface IcddLink {
  kind: LinkKind;
  from: LinkEnd;
  to: LinkEnd;
  /** Pôvod väzby v AIM (`relationships.source`, napr. `pdf_link (E4)`, `derive:spatial_reference`, `ifc:ASR v79`). */
  source?: string | null;
  role?: string | null;
  /** Pravidlo odvodenia (`derivation_rules.id`). */
  rule?: string | null;
  /** Revízie, nad ktorými väzba vznikla, kanonicky `ASR=79;VZT=11` (D-183 bod 4). */
  basedOn?: string | null;
}

export interface IcddPlan {
  versionID: string;
  versionDescription: string;
  /** ISO dátum a čas exportu (ct:creationDate); jediné, čo sa mení medzi dvoma exportmi toho istého stavu. */
  createdAt: string;
  description?: string | null;
  publisher: { name: string };
  aimNamespace: string;
  payloads: IcddPayload[];
  links: IcddLink[];
  layers: Layer[];
  /** Súbory navyše; chýba = žiadne. */
  extras?: Extra[];
  /** Čo sa do kontajnera nedostalo a prečo (počty), napr. dokument bez súboru. */
  skipped: Record<string, number>;
  warnings: string[];
}

export function containerBase(versionID: string): string {
  return `urn:x-aim:container:${encodeURIComponent(versionID)}`;
}

export function containerFileName(versionID: string): string {
  return `AIM_${versionID.replace(/[^\w.-]+/g, "_")}.icdd`;
}
