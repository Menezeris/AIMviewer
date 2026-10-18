/**
 * Výber zo živého viewera pre `get_viewer_state` (D-093): celkový počet, príznak
 * orezania, súhrn (IFC trieda, podlažie, rodičovská zostava, model) a stránka
 * položiek s identitou, nie len GUID.
 *
 * Údaje o prvku berie najprv z odpovede viewera (`selection.items`, má načítaný
 * IFC, pozná aj časti zostáv, ktoré AIM nemá, napr. IfcPlate obvodového plášťa),
 * inak z AIM (`SelectionContext`). Bez zmien DB, čistá funkcia + typy.
 */

/** Strop GUID, ktoré server z výberu spracuje (súhrn aj AIM lookup). */
export const MAX_SELECTION_GUIDS = 5000;
export const DEFAULT_ITEMS_LIMIT = 50;
export const MAX_ITEMS_LIMIT = 200;
/** Koľko skupín súhrnu na rozmer (zvyšok sa zráta do `other`). */
const MAX_GROUPS = 30;

/** Položka výberu, ako ju môže poslať viewer (všetko okrem guid voliteľné). */
export interface ViewerSelectionItem {
  guid: string;
  name?: string | null;
  ifc_type?: string | null;
  storey?: string | null;
  model?: string | null;
  parent_guid?: string | null;
  parent_type?: string | null;
  parent_name?: string | null;
}

export interface ViewerSelection {
  count?: number;
  guids?: string[];
  items?: ViewerSelectionItem[];
  [key: string]: unknown;
}

/** Čo o GUID vie AIM (graf v DB). */
export interface AimSelectionInfo {
  object_id: string;
  object_ref: string | null;
  name: string | null;
  ifc_type: string | null;
  floor: string | null;
  parent: { object_ref: string | null; name: string | null; ifc_type: string | null } | null;
}

export type SelectionContext = Map<string, AimSelectionInfo>;

export interface SelectionItem {
  guid: string;
  object_ref?: string | null;
  name?: string | null;
  ifc_type?: string | null;
  floor?: string | null;
  model?: string | null;
  parent?: { guid?: string | null; object_ref?: string | null; name?: string | null; ifc_type?: string | null } | null;
  in_aim: boolean;
}

export interface SummaryGroup {
  key: string;
  count: number;
}

export interface SelectionSummary {
  /** "all" = súhrn platí pre celý výber, "returned" = len pre vrátenú časť (viewer výber orezal). */
  covers: "all" | "returned";
  of: number;
  by_ifc_type: SummaryGroup[];
  by_floor: SummaryGroup[];
  by_parent: SummaryGroup[];
  by_model?: SummaryGroup[];
  in_aim: number;
}

export interface SummarizedSelection {
  count: number;
  returned: number;
  truncated: boolean;
  summary: SelectionSummary;
  items: SelectionItem[];
  items_offset: number;
  items_total: number;
  note?: string;
}

const UNKNOWN = "(neznáme)";

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** GUIDy výberu bez duplicít, v poradí viewera (guids, potom items), max `MAX_SELECTION_GUIDS`. */
export function selectionGuids(sel: ViewerSelection): string[] {
  const out = new Set<string>();
  for (const g of sel.guids ?? []) if (typeof g === "string" && g) out.add(g);
  for (const it of sel.items ?? []) if (it && typeof it.guid === "string" && it.guid) out.add(it.guid);
  return [...out].slice(0, MAX_SELECTION_GUIDS);
}

/** GUIDy, ktoré treba hľadať v AIM: prvky výberu + rodičia, ktorých poslal viewer. */
export function lookupGuidsFor(sel: ViewerSelection): string[] {
  const guids = selectionGuids(sel);
  const keep = new Set(guids);
  const out = new Set(guids);
  for (const it of sel.items ?? []) {
    if (it && keep.has(it.guid) && typeof it.parent_guid === "string" && it.parent_guid) out.add(it.parent_guid);
  }
  return [...out];
}

function group(values: (string | null | undefined)[]): SummaryGroup[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v || UNKNOWN;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (sorted.length <= MAX_GROUPS) return sorted;
  const rest = sorted.slice(MAX_GROUPS - 1).reduce((s, g) => s + g.count, 0);
  return [...sorted.slice(0, MAX_GROUPS - 1), { key: "(ostatné)", count: rest }];
}

function parentLabel(p: SelectionItem["parent"]): string | null {
  if (!p) return null;
  const id = p.object_ref || p.name || p.guid;
  if (!id) return p.ifc_type ?? null;
  return p.ifc_type ? `${p.ifc_type} ${id}` : id;
}

/**
 * Zloží výber: viewer má prednosť (pozná IFC), AIM dopĺňa object_ref a čo viewer
 * nepošle. `opts.items_offset`/`items_limit` stránkujú položky, súhrn je vždy
 * nad všetkými spracovanými GUID.
 */
export function summarizeSelection(
  sel: ViewerSelection,
  ctx: SelectionContext,
  opts: { items_offset?: unknown; items_limit?: unknown } = {},
): SummarizedSelection {
  const guids = selectionGuids(sel);
  const fromViewer = new Map<string, ViewerSelectionItem>();
  for (const it of sel.items ?? []) if (it && typeof it.guid === "string") fromViewer.set(it.guid, it);

  const all: SelectionItem[] = guids.map((guid) => {
    const v = fromViewer.get(guid);
    const a = ctx.get(guid);
    // Rodič z viewera; AIM ho môže poznať, aj keď časť nie (IfcCurtainWall áno, IfcPlate nie).
    const pa = v?.parent_guid ? ctx.get(v.parent_guid) : undefined;
    const parent =
      v?.parent_guid || v?.parent_type || v?.parent_name
        ? {
            guid: v.parent_guid ?? null,
            object_ref: pa?.object_ref ?? null,
            name: v.parent_name ?? pa?.name ?? null,
            ifc_type: v.parent_type ?? pa?.ifc_type ?? null,
          }
        : (a?.parent ?? null);
    return {
      guid,
      ...(a ? { object_ref: a.object_ref } : {}),
      name: v?.name ?? a?.name ?? null,
      ifc_type: v?.ifc_type ?? a?.ifc_type ?? null,
      floor: v?.storey ?? a?.floor ?? null,
      ...(v?.model ? { model: v.model } : {}),
      parent,
      in_aim: Boolean(a),
    };
  });

  const count = Math.max(typeof sel.count === "number" && Number.isFinite(sel.count) ? sel.count : 0, all.length);
  const truncated = all.length < count;
  const hasModel = all.some((i) => i.model);
  const summary: SelectionSummary = {
    covers: truncated ? "returned" : "all",
    of: all.length,
    by_ifc_type: group(all.map((i) => i.ifc_type)),
    by_floor: group(all.map((i) => i.floor)),
    by_parent: group(all.map((i) => parentLabel(i.parent) ?? "(bez zostavy)")),
    ...(hasModel ? { by_model: group(all.map((i) => i.model)) } : {}),
    in_aim: all.filter((i) => i.in_aim).length,
  };

  const offset = clampInt(opts.items_offset, 0, 0, Math.max(0, all.length));
  const limit = clampInt(opts.items_limit, DEFAULT_ITEMS_LIMIT, 1, MAX_ITEMS_LIMIT);
  const items = all.slice(offset, offset + limit);

  const notes: string[] = [];
  if (truncated) {
    notes.push(
      `Viewer poslal len ${all.length} z ${count} vybraných prvkov. Súhrn a položky platia len pre túto časť, ` +
        "nerob z nich závery o celom výbere (podlažia, triedy); povedz používateľovi, že výber je orezaný.",
    );
  }
  if (offset + items.length < all.length) {
    notes.push(`Položky ${offset + 1}-${offset + items.length} z ${all.length}; ďalšie cez items_offset=${offset + items.length}.`);
  }
  if (summary.in_aim < all.length && all.some((i) => !i.ifc_type)) {
    notes.push("Časť prvkov AIM nepozná a viewer o nich neposlal triedu ani podlažie (skupina (neznáme)).");
  }

  return {
    count,
    returned: all.length,
    truncated,
    summary,
    items,
    items_offset: offset,
    items_total: all.length,
    ...(notes.length ? { note: notes.join(" ") } : {}),
  };
}
