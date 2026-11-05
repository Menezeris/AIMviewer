/**
 * Selection from the live viewer for `get_viewer_state` (D-093): total count, truncation
 * flag, summary (IFC class, storey, parent assembly, model) and a page of
 * items with identity, not just the GUID.
 *
 * Element data is taken first from the viewer answer (`selection.items`, it has the IFC
 * loaded, it also knows parts of assemblies AIM does not have, e.g. an IfcPlate of the curtain wall),
 * otherwise from AIM (`SelectionContext`). The summary over the whole selection is computed by the viewer
 * (`selection.summary`, D-093 addendum): the answer goes via Realtime with a cap of
 * 256 kB, so the viewer sends truncated lists and the whole summary. No DB changes,
 * a pure function + types.
 */

/** Cap of GUIDs the server processes from a selection (summary and AIM lookup). */
export const MAX_SELECTION_GUIDS = 5000;
export const DEFAULT_ITEMS_LIMIT = 50;
export const MAX_ITEMS_LIMIT = 200;
/** How many summary groups per dimension (the rest is counted into `other`). */
const MAX_GROUPS = 30;

/** A selection item as the viewer may send it (everything except guid optional). */
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

export interface ViewerSummaryGroup {
  key: string;
  count: number;
}

/** Summary the viewer computes over the whole selection (the parent carries a GUID for lookup in AIM). */
export interface ViewerSummary {
  of: number;
  by_ifc_type?: ViewerSummaryGroup[];
  by_storey?: ViewerSummaryGroup[];
  by_parent?: (ViewerSummaryGroup & { guid?: string | null; ifc_type?: string | null; name?: string | null })[];
  by_model?: ViewerSummaryGroup[];
}

export interface ViewerSelection {
  count?: number;
  guids?: string[];
  items?: ViewerSelectionItem[];
  summary?: ViewerSummary;
  [key: string]: unknown;
}

/** What AIM knows about a GUID (the graph in the DB). */
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
  /** "all" = the summary applies to the whole selection, "returned" = only to the returned part (the viewer truncated the selection and did not send a summary). */
  covers: "all" | "returned";
  of: number;
  by_ifc_type: SummaryGroup[];
  by_floor: SummaryGroup[];
  by_parent: SummaryGroup[];
  by_model?: SummaryGroup[];
  /** How many of the returned items (`returned`) AIM knows. */
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

/** Selection GUIDs without duplicates, in viewer order (guids, then items), max `MAX_SELECTION_GUIDS`. */
export function selectionGuids(sel: ViewerSelection): string[] {
  const out = new Set<string>();
  for (const g of sel.guids ?? []) if (typeof g === "string" && g) out.add(g);
  for (const it of sel.items ?? []) if (it && typeof it.guid === "string" && it.guid) out.add(it.guid);
  return [...out].slice(0, MAX_SELECTION_GUIDS);
}

/** GUIDs to look up in AIM: selection elements + the parents the viewer sent. */
export function lookupGuidsFor(sel: ViewerSelection): string[] {
  const guids = selectionGuids(sel);
  const keep = new Set(guids);
  const out = new Set(guids);
  for (const it of sel.items ?? []) {
    if (it && keep.has(it.guid) && typeof it.parent_guid === "string" && it.parent_guid) out.add(it.parent_guid);
  }
  for (const g of viewerSummary(sel)?.by_parent ?? []) if (typeof g.guid === "string" && g.guid) out.add(g.guid);
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

/** Summary from the viewer, if usable (count `of` and group fields). */
function viewerSummary(sel: ViewerSelection): ViewerSummary | null {
  const v = sel.summary;
  if (!v || typeof v !== "object" || typeof v.of !== "number" || !Number.isFinite(v.of)) return null;
  const ok = (a: unknown) => a === undefined || Array.isArray(a);
  return ok(v.by_ifc_type) && ok(v.by_storey) && ok(v.by_parent) && ok(v.by_model) ? v : null;
}

const groups = (a: ViewerSummaryGroup[] | undefined): SummaryGroup[] =>
  (a ?? []).filter((g) => g && typeof g.key === "string" && typeof g.count === "number").map((g) => ({ key: g.key, count: g.count }));

function parentLabel(p: SelectionItem["parent"]): string | null {
  if (!p) return null;
  const id = p.object_ref || p.name || p.guid;
  if (!id) return p.ifc_type ?? null;
  return p.ifc_type ? `${p.ifc_type} ${id}` : id;
}

/**
 * Assembles the selection: the viewer takes precedence (it knows the IFC), AIM adds object_ref and what the viewer
 * does not send. `opts.items_offset`/`items_limit` paginate the items, the summary is always
 * over all processed GUIDs.
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
    // Parent from the viewer; AIM may know it even when a part is unknown (IfcCurtainWall yes, IfcPlate no).
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

  const vs = viewerSummary(sel);
  const count = Math.max(typeof sel.count === "number" && Number.isFinite(sel.count) ? sel.count : 0, all.length, vs?.of ?? 0);
  const truncated = all.length < count;
  const in_aim = all.filter((i) => i.in_aim).length;
  const hasModel = all.some((i) => i.model);
  const summary: SelectionSummary = vs
    ? {
        covers: vs.of >= count ? "all" : "returned",
        of: vs.of,
        by_ifc_type: groups(vs.by_ifc_type),
        by_floor: groups(vs.by_storey),
        // An assembly that AIM knows (IfcCurtainWall yes) is named by object_ref.
        by_parent: (vs.by_parent ?? [])
          .filter((g) => g && typeof g.key === "string" && typeof g.count === "number")
          .map((g) => {
            const a = g.guid ? ctx.get(g.guid) : undefined;
            return { key: a?.object_ref ? `${g.ifc_type ?? a.ifc_type ?? ""} ${a.object_ref}`.trim() : g.key, count: g.count };
          }),
        ...(vs.by_model?.length ? { by_model: groups(vs.by_model) } : {}),
        in_aim,
      }
    : {
        covers: truncated ? "returned" : "all",
        of: all.length,
        by_ifc_type: group(all.map((i) => i.ifc_type)),
        by_floor: group(all.map((i) => i.floor)),
        by_parent: group(all.map((i) => parentLabel(i.parent) ?? "(bez zostavy)")),
        ...(hasModel ? { by_model: group(all.map((i) => i.model)) } : {}),
        in_aim,
      };

  const offset = clampInt(opts.items_offset, 0, 0, Math.max(0, all.length));
  const limit = clampInt(opts.items_limit, DEFAULT_ITEMS_LIMIT, 1, MAX_ITEMS_LIMIT);
  const items = all.slice(offset, offset + limit);

  const notes: string[] = [];
  if (truncated && summary.covers === "all") {
    notes.push(
      `Viewer poslal zoznam len ${all.length} z ${count} vybraných prvkov, súhrn (summary) však platí pre celý výber: ` +
        "na otázky o celom výbere (triedy, podlažia, zostavy) odpovedaj zo summary, nie z items.",
    );
  } else if (truncated) {
    notes.push(
      `Viewer poslal len ${all.length} z ${count} vybraných prvkov. Súhrn a položky platia len pre túto časť, ` +
        "nerob z nich závery o celom výbere (podlažia, triedy); povedz používateľovi, že výber je orezaný.",
    );
  }
  if (offset + items.length < all.length) {
    notes.push(`Položky ${offset + 1}-${offset + items.length} z ${all.length}; ďalšie cez items_offset=${offset + items.length}.`);
  }
  if (!vs && in_aim < all.length && all.some((i) => !i.ifc_type)) {
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
