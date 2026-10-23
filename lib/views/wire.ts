import { isViewWire, MAX_VIEWS, type ViewWire } from "../viewer-views";

import { isLastName, type SavedViewRow, type SavedViewpoint } from "./plan";
import type { SavedViewStore, SavedViewWrite } from "./store";

/**
 * Pohľady z panela Presentation v `saved_views` (D-161): `viewpoint` nesie celý `ViewWire`, `id` a meno
 * riadku patria stĺpcom. Riadky z D-122 a D-132 (kamera ako {x,y,z}, `mode`, `view_type`) majú iný tvar;
 * ostávajú len pre chat (obnova cez `planRestore`) a do viewera sa neposielajú.
 */

export const VIEWER_AUTHOR = "viewer";
const MAX_NAME = 120;

/** Má `viewpoint` tvar `ViewWire` (D-161)? Riadky z D-122 a D-132 ho nemajú. */
export function isWireViewpoint(vp: unknown): boolean {
  const v = vp as { basket?: unknown; order?: unknown } | null;
  return !!v && typeof v === "object" && !!v.basket && typeof v.basket === "object" && Number.isInteger(v.order);
}

/**
 * Riadok -> pohľad pre viewera; null = riadok z D-122 alebo poškodený. Pri "Posledný pohľad" ostáva v
 * `viewpoint.id` pôvodný pohľad (id riadku patrí poslednému pohľadu).
 */
export function wireOfRow(row: SavedViewRow): ViewWire | null {
  if (!isWireViewpoint(row.viewpoint)) return null;
  const wire = { ...(row.viewpoint as unknown as ViewWire), ...(row.kind === "saved" ? { id: row.id } : {}), name: row.name };
  return isViewWire(wire) ? wire : null;
}

/** Zápis pohľadu z viewera: `viewpoint` je celý `ViewWire`, ostatné stĺpce ostávajú prázdne. */
export function wireWrite(view: ViewWire, author: string, revisions: Record<string, number>): SavedViewWrite & Pick<SavedViewRow, "name" | "viewpoint"> {
  return {
    name: view.name,
    // Jsonb je voľný tvar; typ `SavedViewpoint` platí pre riadky z D-122.
    viewpoint: view as unknown as SavedViewpoint,
    selection: [],
    hidden: [],
    isolated: null,
    model_revisions: revisions,
    author,
  };
}

/** Pohľady pre viewera v poradí pásu Presentation. */
export async function listWires(store: Pick<SavedViewStore, "list">): Promise<ViewWire[]> {
  const wires = (await store.list()).map(wireOfRow).filter((w): w is ViewWire => w !== null);
  return wires.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).slice(0, MAX_VIEWS);
}

/** Meno bez kolízie (bez ohľadu na veľkosť písmen, "Posledný pohľad" je vyhradené): prípona " 2", " 3"... */
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

/** Zapíše (vytvorí alebo prepíše) pohľad z viewera; kolízia mena dostane príponu. */
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
      // Dve okná uložili to isté meno naraz: druhý pokus vidí cudzí riadok a zvolí inú príponu.
      if (!isDuplicate(err) || attempt >= 2) throw err;
    }
  }
}

/** Premenovanie pohľadu z viewera; null = riadok neexistuje (zmazal ho chat). */
export async function renameWire(store: SavedViewStore, id: string, wanted: string): Promise<{ name: string } | null> {
  const row = await store.byId(id);
  if (!row) return null;
  const name = await freeName(store, wanted, id);
  const viewpoint = isWireViewpoint(row.viewpoint) ? ({ ...row.viewpoint, name } as unknown as SavedViewpoint) : row.viewpoint;
  await store.update(id, { name, viewpoint });
  return { name };
}

/** Zmazanie pohľadu z viewera; neexistujúci riadok nie je chyba. */
export async function deleteWire(store: SavedViewStore, id: string): Promise<void> {
  if (await store.byId(id)) await store.remove(id);
}
