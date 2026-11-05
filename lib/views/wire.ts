import { isViewWire, MAX_VIEWS, type ViewWire } from "../viewer-views";

import { isLastName, type SavedViewRow, type SavedViewpoint } from "./plan";
import type { SavedViewStore, SavedViewWrite } from "./store";

/**
  * Views from the Presentation panel in `saved_views` (D-161): `viewpoint` carries the whole `ViewWire`, the `id` and name
  * of the row belong to the columns. Rows from D-122 and D-132 (camera as {x,y,z}, `mode`, `view_type`) have a different shape;
  * they stay only for the chat (restore via `planRestore`) and are not sent to the viewer.
 */

export const VIEWER_AUTHOR = "viewer";
const MAX_NAME = 120;

/** Does `viewpoint` have the `ViewWire` shape (D-161)? Rows from D-122 and D-132 do not. */
export function isWireViewpoint(vp: unknown): boolean {
  const v = vp as { basket?: unknown; order?: unknown } | null;
  return !!v && typeof v === "object" && !!v.basket && typeof v.basket === "object" && Number.isInteger(v.order);
}

/**
  * Row -> view for the viewer; null = a row from D-122 or damaged. For "Posledný pohľad" (last view) the original view stays in
  * `viewpoint.id` (the row id belongs to the last view).
 */
export function wireOfRow(row: SavedViewRow): ViewWire | null {
  if (!isWireViewpoint(row.viewpoint)) return null;
  const wire = { ...(row.viewpoint as unknown as ViewWire), ...(row.kind === "saved" ? { id: row.id } : {}), name: row.name };
  return isViewWire(wire) ? wire : null;
}

/** Write of a view from the viewer: `viewpoint` is the whole `ViewWire`, the other columns stay empty. */
export function wireWrite(view: ViewWire, author: string, revisions: Record<string, number>): SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint"> {
  return {
    name: view.name,
        // Jsonb is a free shape; the type `SavedViewpoint` applies to rows from D-122.
    viewpoint: view as unknown as SavedViewpoint,
    selection: [],
    hidden: [],
    isolated: null,
    model_revisions: revisions,
    author,
  };
}

/** Views for the viewer in the order of the Presentation strip. */
export async function listWires(store: Pick<SavedViewStore, "list">): Promise<ViewWire[]> {
  const wires = (await store.list()).map(wireOfRow).filter((w): w is ViewWire => w !== null);
  return wires.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).slice(0, MAX_VIEWS);
}

/** Name without a collision (regardless of letter case, "Posledný pohľad" (last view) is reserved): suffix " 2", " 3"... */
export async function freeName(store: Pick<SavedViewStore, "list">, wanted: string, selfId?: string): Promise<string> {
  const base = wanted.trim().slice(0, MAX_NAME);
  const taken = new Set((await store.list()).filter((r) => r.id !== selfId).map((r) => r.name.toLowerCase()));
  const busy = (n: string) => taken.has(n.toLowerCase()) || isLastName(n);
  if (!busy(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base} ${i}`;
    if (!busy(candidate)) return candidate;
  }
}

const isDuplicate = (err: unknown) => err instanceof Error && /duplicate key|uniq_saved_views_name/i.test(err.message);

/** Writes (creates or overwrites) a view from the viewer; a name collision gets a suffix. */
export async function saveWire(
  store: SavedViewStore,
  view: ViewWire,
  revisions: Record<string, number>,
  author = VIEWER_AUTHOR,
): Promise<{ name: string; renamed: boolean }> {
  for (let attempt = 0; ; attempt += 1) {
    const existing = await store.byId(view.id);
    const name = await freeName(store, view.name, view.id);
    const write = wireWrite({ ...view, name }, existing?.author ?? author, revisions);
    try {
      if (existing) await store.update(existing.id, { ...write, ...(existing.description ? { description: existing.description } : {}) });
      else await store.create({ ...write, id: view.id });
      return { name, renamed: name !== view.name };
    } catch (err) {
            // Two windows saved the same name at once: the second attempt sees the foreign row and picks a different suffix.
      if (!isDuplicate(err) || attempt >= 2) throw err;
    }
  }
}

/** Renaming a view from the viewer; null = the row does not exist (deleted by the chat). */
export async function renameWire(store: SavedViewStore, id: string, wanted: string): Promise<{ name: string } | null> {
  const row = await store.byId(id);
  if (!row) return null;
  const name = await freeName(store, wanted, id);
  const viewpoint = isWireViewpoint(row.viewpoint) ? ({ ...row.viewpoint, name } as unknown as SavedViewpoint) : row.viewpoint;
  await store.update(id, { name, viewpoint });
  return { name };
}

/** Deleting a view from the viewer; a nonexistent row is not an error. */
export async function deleteWire(store: SavedViewStore, id: string): Promise<void> {
  if (await store.byId(id)) await store.remove(id);
}
