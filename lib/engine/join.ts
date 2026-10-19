/**
 * Prepojenie výsledku IFC motora na graf AIM cez IFC GlobalId (D-084).
 *
 * Každý prvok z IFC súboru dostane `object_id`/`object_ref`/`aim_url`, ak ho
 * graf AIM pozná (aktívny GUID v `ifc_guid_history`), inak null. Výsledok nesie
 * pripravený vstup pre `show_in_3d`/`style_in_3d`: prvky z AIM ako
 * `ids_or_refs`, ostatné priamo ako `global_ids`.
 */

export interface AimRef {
  object_id: string;
  object_ref: string | null;
  name: string | null;
  object_type: string;
}

export type GuidLookup = (guids: string[]) => Promise<Map<string, AimRef>>;

export interface JoinedItem {
  global_id: string;
  object_id: string | null;
  object_ref: string | null;
  aim_url: string | null;
  [key: string]: unknown;
}

export interface Joined<T = unknown> {
  items: Array<T & JoinedItem>;
  unmapped: number;
  show_in_3d: { ids_or_refs: string[]; global_ids: string[] };
}

const routeFor = (objectType: string): string =>
  objectType === "asset_type" ? "type" : "node";

export async function joinToAim<T extends { global_id: string }>(
  rows: T[],
  lookup: GuidLookup,
): Promise<Joined<T>> {
  const guids = [...new Set(rows.map((r) => r.global_id).filter(Boolean))];
  const refs = guids.length > 0 ? await lookup(guids) : new Map<string, AimRef>();
  let unmapped = 0;
  const idsOrRefs: string[] = [];
  const globalIds: string[] = [];
  const items = rows.map((r) => {
    const aim = refs.get(r.global_id);
    if (aim) {
      if (!idsOrRefs.includes(aim.object_id)) idsOrRefs.push(aim.object_id);
    } else {
      unmapped++;
      if (r.global_id && !globalIds.includes(r.global_id)) globalIds.push(r.global_id);
    }
    return {
      ...r,
      object_id: aim?.object_id ?? null,
      object_ref: aim?.object_ref ?? null,
      aim_url: aim ? `/${routeFor(aim.object_type)}/${aim.object_id}` : null,
    };
  });
  return { items, unmapped, show_in_3d: { ids_or_refs: idsOrRefs, global_ids: globalIds } };
}
