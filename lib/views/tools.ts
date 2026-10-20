import type { ToolDefinition } from "../llm/provider";
import { ViewInputError, type ViewPlan } from "../llm/view-plan";

import { LAST_VIEW_NAME, captureFromState, describeView, isLastName, planRestore, type SavedViewRow } from "./plan";
import type { SavedViewStore } from "./store";

/**
 * Uložené pohľady viewera (D-117), len v MCP konektore. Zápis je tool
 * `saved_view` (save | rename | delete); zoznam číta `get_viewer_state(saved_views)`
 * a obnovu robí `set_view_mode(saved_view)`, lebo to sú existujúce tooly na
 * čítanie a pohľad (D-114). Závislosti (DB, živý viewer) sú v `runtime.ts`.
 */

export const DEFAULT_VIEW_AUTHOR = "Claude (MCP)";
const MAX_NAME = 120;
const MAX_TEXT = 2000;

export const SAVED_VIEW_ACTIONS = ["save", "rename", "delete"] as const;

export const SAVED_VIEW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "saved_view",
    description:
      "ULOŽÍ POHĽAD viewera pod menom (spoločný pre stavbu, D-117): 'ulož to ako Pôdorys technickej miestnosti 3.14'. " +
      "action=save vezme z otvoreného viewera kameru a projekciu, rez, režim a podlažie, izolované, skryté a vybrané prvky " +
      "(farby z style_in_3d sa neukladajú); existujúce meno prepíše len s overwrite=true. rename: name -> new_name. " +
      "delete: zmaže pohľad. Zoznam a opis pohľadov = get_viewer_state(saved_views=true); obnova = " +
      "set_view_mode(saved_view=meno, section_offset_m=-1 pre 'rez o meter nižšie'). Uloženie aj obnova sa zapíšu " +
      "ako 'Posledný pohľad' ('ako minule' = saved_view='Posledný pohľad').",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...SAVED_VIEW_ACTIONS] },
        name: { type: "string", description: `Meno pohľadu (max ${MAX_NAME} znakov, veľkosť písmen sa pri hľadaní nerozlišuje)` },
        new_name: { type: "string", description: "rename: nové meno" },
        description: { type: "string", description: "save: čo pohľad ukazuje (voliteľné)" },
        overwrite: { type: "boolean", description: "save: prepísať pohľad s rovnakým menom" },
        author: { type: "string", description: `Kto ukladá (predvolene '${DEFAULT_VIEW_AUTHOR}')` },
      },
      required: ["action", "name"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

export const SAVED_VIEW_TOOL_NAMES: ReadonlySet<string> = new Set(SAVED_VIEW_TOOL_DEFINITIONS.map((t) => t.name));

export interface SavedViewDeps {
  store: SavedViewStore;
  /** Surová odpoveď `view_state` z otvoreného viewera; string = prečo sa nedala prečítať. */
  viewState: () => Promise<unknown>;
  revisions: () => Promise<Record<string, number>>;
  /** IFC GUID podlažia -> object_ref/názov v AIM; null = nepoznáme. */
  storeyLabel: (guid: string) => Promise<string | null>;
  now: () => Date;
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
};

function nameOf(v: unknown, field = "name"): string {
  const s = text(v, MAX_NAME);
  if (!s) throw new ViewInputError(`Chýba ${field} (meno pohľadu).`);
  return s;
}

async function loadView(deps: Pick<SavedViewDeps, "store">, raw: unknown): Promise<SavedViewRow> {
  const name = nameOf(raw);
  const row = isLastName(name) ? await deps.store.last() : await deps.store.byName(name);
  if (row) return row;
  const names = (await deps.store.list()).map((r) => r.name);
  throw new ViewInputError(
    `Pohľad '${name}' neexistuje. ${names.length ? `Uložené: ${names.slice(0, 30).join(", ")}.` : "Zatiaľ nie je uložený žiadny pohľad."}`,
  );
}

async function save(args: Record<string, unknown>, deps: SavedViewDeps) {
  const name = nameOf(args.name);
  if (isLastName(name)) throw new ViewInputError(`'${LAST_VIEW_NAME}' sa zapisuje sám; zvoľ iné meno.`);
  const existing = await deps.store.byName(name);
  if (existing && args.overwrite !== true) {
    throw new ViewInputError(`Pohľad '${existing.name}' už existuje. Prepíš ho s overwrite=true alebo zvoľ iné meno.`);
  }
  const raw = await deps.viewState();
  if (typeof raw === "string") throw new ViewInputError(`Pohľad sa nedá uložiť: ${raw}.`);
  const { state, notes } = captureFromState(raw);
  if (state.viewpoint.storey_guid) state.viewpoint.storey_label = await deps.storeyLabel(state.viewpoint.storey_guid).catch(() => null);
  const author = text(args.author, 200) || DEFAULT_VIEW_AUTHOR;
  const write = {
    ...state,
    name,
    description: text(args.description, MAX_TEXT) || null,
    model_revisions: await deps.revisions().catch(() => ({})),
    author,
  };
  const row = existing ? await deps.store.update(existing.id, write) : await deps.store.create(write);
  await deps.store.setLast({ ...state, name: LAST_VIEW_NAME, description: `Uložený ako '${name}'`, model_revisions: write.model_revisions, author });
  return { saved: describeView(row), overwritten: Boolean(existing), ...(notes.length ? { notes } : {}) };
}

async function rename(args: Record<string, unknown>, deps: SavedViewDeps) {
  const row = await loadView(deps, args.name);
  if (row.kind === "last") throw new ViewInputError(`'${LAST_VIEW_NAME}' sa nepremenúva; ulož ho pod novým menom cez action=save.`);
  const next = nameOf(args.new_name, "new_name");
  if (isLastName(next)) throw new ViewInputError(`'${LAST_VIEW_NAME}' je vyhradené meno.`);
  const clash = await deps.store.byName(next);
  if (clash && clash.id !== row.id) throw new ViewInputError(`Pohľad '${clash.name}' už existuje.`);
  const from = row.name;
  const updated = await deps.store.update(row.id, { name: next });
  return { renamed: { from, to: updated.name } };
}

async function remove(args: Record<string, unknown>, deps: SavedViewDeps) {
  const row = await loadView(deps, args.name);
  if (row.kind === "last") throw new ViewInputError(`'${LAST_VIEW_NAME}' sa nemaže, prepíše ho ďalšie uloženie alebo obnova.`);
  await deps.store.remove(row.id);
  return { deleted: row.name };
}

const WRITES = { save, rename, delete: remove } as const;

export async function execSavedViewTool(
  name: string,
  args: Record<string, unknown>,
  deps: SavedViewDeps,
): Promise<{ text: string; isError: boolean }> {
  try {
    if (name !== "saved_view") return { text: `Neznámy tool: ${name}`, isError: true };
    const action = typeof args.action === "string" && args.action in WRITES ? (args.action as keyof typeof WRITES) : null;
    if (!action) throw new ViewInputError(`action: ${SAVED_VIEW_ACTIONS.join(" | ")}.`);
    return { text: JSON.stringify(await WRITES[action](args, deps), null, 1), isError: false };
  } catch (err) {
    if (err instanceof ViewInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

/** `get_viewer_state(saved_views=true)`: zoznam z DB, aj bez otvoreného viewera. */
export async function listSavedViews(deps: Pick<SavedViewDeps, "store">) {
  const [views, last] = await Promise.all([deps.store.list(), deps.store.last()]);
  return {
    saved_views: views.map(describeView),
    count: views.length,
    last: last ? describeView(last) : null,
    hint: "Obnova: set_view_mode(saved_view=meno, section_offset_m=...). Uloženie: saved_view(action=save, name).",
  };
}

/** `set_view_mode(saved_view)`: plán obnovy a zápis "Posledný pohľad". */
export async function restoreSavedView(input: Record<string, unknown>, deps: Pick<SavedViewDeps, "store" | "now">): Promise<ViewPlan> {
  const row = await loadView(deps, input.saved_view);
  const { plan, restored } = planRestore(row, input.section_offset_m);
  const at = deps.now().toISOString();
  if (row.kind === "saved") await deps.store.update(row.id, { last_used_at: at });
  await deps.store.setLast({
    ...restored,
    name: LAST_VIEW_NAME,
    description: `Obnovený '${row.name}'${typeof input.section_offset_m === "number" && input.section_offset_m ? `, rez ${input.section_offset_m} m` : ""}`,
    model_revisions: row.model_revisions,
    author: row.author,
    last_used_at: at,
  });
  return plan;
}
