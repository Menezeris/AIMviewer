/**
 * MEP "grouping" triedy (D-049, zoznam `group_only` v `etl/scheme.py`): potrubie, tvarovky a rozvody,
 * pri ktorých nezáleží na inštancii. Od D-183 K3 majú v dátach podlažie zo súboru
 * (`rel_contained_in_spatial_structure` z kópie revízie); výnimka ostáva len v strome, ktorý ich
 * pod podlažím neukazuje (inak by ho zaplavili), dostupné sú cez systém alebo priamy odkaz.
 */
export const GROUP_ONLY_IFC_TYPES: ReadonlySet<string> = new Set([
  "IfcDuctSegment",
  "IfcDuctFitting",
  "IfcPipeSegment",
  "IfcPipeFitting",
  "IfcCableSegment",
  "IfcCableFitting",
  "IfcCableCarrierSegment",
  "IfcCableCarrierFitting",
]);

/** Prvok sa v strome pod priestorovou štruktúrou neukazuje (len člen systému, D-049). */
export function isGroupOnly(row: { object_type: string; ifc_type: string | null }): boolean {
  return row.object_type === "asset" && row.ifc_type !== null && GROUP_ONLY_IFC_TYPES.has(row.ifc_type);
}
