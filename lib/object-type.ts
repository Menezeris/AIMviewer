import type { SpatialType } from "@/lib/data/spatial";

/** Všetky typy uzlov, ktoré Viewer vie zobraziť (D-018). */
export type ObjectType =
  | SpatialType
  | "asset_type"
  | "person"
  | "organization"
  | "document"
  // Časť dokumentu (IfcDocumentReference, napr. strana výpisu skladieb, D-104).
  | "document_reference"
  | "system"
  // Projekt, zóny a skupiny z IFC (D-088): IfcProject, IfcZone, IfcSpatialZone, IfcGroup.
  | "project"
  | "zone"
  | "spatial_zone"
  | "group";

/** Skupinové uzly s členmi alebo časťami (systém D-047, projekt/zóny/skupiny D-088). */
export const GROUP_LIKE_TYPES = ["system", "project", "zone", "spatial_zone", "group"] as const;
export type GroupLikeType = (typeof GROUP_LIKE_TYPES)[number];

/** Slovenské labely typov uzlov (zobrazenie vo Viewerі). */
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

/** Labely `IfcSpatialZoneTypeEnum` (predefined_type priestorovej zóny, D-088). */
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

/** Labely `IfcDistributionSystemEnum` (predefined_type systému, D-047). */
export const SYSTEM_TYPE_LABEL: Record<string, string> = {
  VENTILATION: "vetranie",
  EXHAUST: "odvod",
  AIRCONDITIONING: "klimatizácia",
  HEATING: "kúrenie",
  COOLING: "chladenie",
  WATERSUPPLY: "vodovod",
  DRAINAGE: "kanalizácia",
};

/** Acting roly zo `rel_assigns_to_actor.role` (D-020, IfcActorRole). */
export const ACTING_ROLE_LABEL: Record<string, string> = {
  owner: "vlastník",
  operator: "prevádzkovateľ",
  maintainer: "údržbár",
  manufacturer: "výrobca",
};

/** Roly dokumentovej väzby `rel_associates_document.role` (D-014). */
export const DOC_ROLE_LABEL: Record<string, string> = {
  manual: "manuál",
  certificate: "certifikát",
  "as-built": "as-built",
};

/** Preloží rolu cez mapu; neznámu rolu vráti tak ako je. `null` ostáva `null`. */
export function roleLabel(
  map: Record<string, string>,
  role: string | null | undefined
): string | null {
  if (role == null) return null;
  return map[role] ?? role;
}
