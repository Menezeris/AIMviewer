import type { SpatialType } from "@/lib/data/spatial";

/** All node types the Viewer can display (D-018). */
export type ObjectType =
  | SpatialType
  | "asset_type"
  | "person"
  | "organization"
  | "document"
  // Part of a document (IfcDocumentReference, e.g. a page of the assembly schedule, D-104).
  | "document_reference"
  | "system"
  // Project, zones and groups from the IFC (D-088): IfcProject, IfcZone, IfcSpatialZone, IfcGroup.
  | "project"
  | "zone"
  | "spatial_zone"
  | "group";

/** Group nodes with members or parts (system D-047, project/zones/groups D-088). */
export const GROUP_LIKE_TYPES = ["system", "project", "zone", "spatial_zone", "group"] as const;
export type GroupLikeType = (typeof GROUP_LIKE_TYPES)[number];

/** Slovak labels of node types (displayed in the Viewer). */
export const OBJECT_TYPE_LABEL: Record<ObjectType, string> = {
  site: "Areál",
  building: "Budova",
  floor: "Podlažie",
  space: "Miestnosť",
  asset: "Asset",
  asset_type: "Typ assetu",
  person: "Osoba",
  organization: "Organizácia",
  document: "Dokument",
  document_reference: "Časť dokumentu",
  system: "Systém",
  project: "Projekt",
  zone: "Zóna",
  spatial_zone: "Priestorová zóna",
  group: "Skupina",
};

/** Labels of `IfcSpatialZoneTypeEnum` (predefined_type of a spatial zone, D-088). */
export const SPATIAL_ZONE_TYPE_LABEL: Record<string, string> = {
  FIRESAFETY: "požiarny úsek",
  THERMAL: "energetická zóna",
  LIGHTING: "osvetlenie",
  OCCUPANCY: "obsadenosť",
  SECURITY: "bezpečnosť",
  TRANSPORT: "doprava",
  VENTILATION: "vetranie",
  CONSTRUCTION: "výstavba",
  RESERVATION: "rezervácia",
  INTERFERENCE: "interferencia",
};

/** Labels of `IfcDistributionSystemEnum` (predefined_type of a system, D-047). */
export const SYSTEM_TYPE_LABEL: Record<string, string> = {
  VENTILATION: "vetranie",
  EXHAUST: "odvod",
  AIRCONDITIONING: "klimatizácia",
  HEATING: "kúrenie",
  COOLING: "chladenie",
  WATERSUPPLY: "vodovod",
  DRAINAGE: "kanalizácia",
};

/** Acting roles from `rel_assigns_to_actor.role` (D-020, IfcActorRole). */
export const ACTING_ROLE_LABEL: Record<string, string> = {
  owner: "vlastník",
  operator: "prevádzkovateľ",
  maintainer: "údržbár",
  manufacturer: "výrobca",
};

/** Roles of the document link `rel_associates_document.role` (D-014). */
export const DOC_ROLE_LABEL: Record<string, string> = {
  manual: "manuál",
  certificate: "certifikát",
  "as-built": "as-built",
};

/** Translates a role via the map; an unknown role is returned as is. `null` stays `null`. */
export function roleLabel(
  map: Record<string, string>,
  role: string | null | undefined
): string | null {
  if (role == null) return null;
  return map[role] ?? role;
}
