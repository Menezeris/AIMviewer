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

/**
 * Hrany stromu `[dieťa, rodič]` z agregácie a umiestnenia. Od D-183 K3 nesie `rel_aggregates` aj zostavy zo
 * súboru (zábradlie v schodisku); prvok (`asset`) má v strome rodiča len z umiestnenia, časť zostavy sa preto
 * z agregácie neberie (inak by bola pod podlažím aj pod schodiskom). Hrana mimo grafu alebo so stranou bez
 * uzla AIM (null) vypadne.
 */
export function treeEdges(
  aggregates: readonly { from_id: string | null; to_id: string | null }[],
  contained: readonly { from_id: string | null; to_id: string | null }[],
  byId: ReadonlyMap<string, { object_type: string }>,
): [string, string][] {
  const out: [string, string][] = [];
  const push = (from: string | null, to: string | null, skipAsset: boolean) => {
    if (!from || !to) return;
    const child = byId.get(from);
    if (!child || !byId.has(to)) return;
    if (skipAsset && child.object_type === "asset") return;
    out.push([from, to]);
  };
  for (const r of aggregates) push(r.from_id, r.to_id, true);
  for (const r of contained) push(r.from_id, r.to_id, false);
  return out;
}
