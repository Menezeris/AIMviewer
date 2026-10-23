import type { ToolDefinition } from "../llm/provider";
import { ViewInputError, type ViewPlan } from "../llm/view-plan";

import { LAST_VIEW_NAME, captureFromState, describeView, isLastName, planRestore, type SavedViewRow, type SavedViewpoint } from "./plan";
import type { SavedViewStore } from "./store";
import { isWireViewpoint, wireOfRow } from "./wire";

/**
 * Uložené pohľady viewera (D-122, od D-161 pohľady z panela Presentation), len v MCP konektore. Zápis je tool
 * `saved_view` (save | rename | delete); zoznam číta `get_viewer_state(saved_views)` a obnovu robí
 * `set_view_mode(view)`, lebo to sú existujúce tooly na čítanie a pohľad (D-114). `save` pošle viewera
 * `VIEW_CAPTURE` (uloží ako tlačidlo v paneli, zápis do DB urobí host cez route), rename a delete zapíše
 * server a viewer dostane zoznam znova. Závislosti (DB, živý viewer) sú v `runtime.ts`.
 */

export const DEFAULT_VIEW_AUTHOR = "Claude (MCP)";
const MAX_NAME = 120;
const MAX_TEXT = 2000;

export const SAVED_VIEW_ACTIONS = ["save", "rename", "delete"] as const;

/** Parametre z D-132, ktoré D-161 nepozná (druh pohľadu, zámok, podklad); prijmú sa a ignorujú s poznámkou. */
const IGNORED_ARGS = ["view_type", "locked", "underlay_document_id", "underlay_page"] as const;

export const SAVED_VIEW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "saved_view",
    description:
      "ULOŽÍ POHĽAD do panela Presentation (pás pohľadov, spoločný pre stavbu): 'ulož to ako Pôdorys technickej miestnosti 3.14'. " +
      "action=save uloží to, čo je vo vieweri práve nastavené (kamera s projekciou, rezy, košík = viditeľné prvky; prázdny " +
      "košík = všetko viditeľné), ako tlačidlo Uložiť v paneli. Farby z style_in_3d sa neukladajú. Existujúce meno prepíše " +
      "len s overwrite=true. rename: name -> new_name. delete: zmaže pohľad. Zoznam = get_viewer_state(saved_views=true); " +
      "otvorenie = set_view_mode(view=meno, section_offset_m=-1 pre 'rez o meter nižšie'; 'ako minule' = view='Posledný pohľad'). " +
      "Pôdorys alebo rez si najprv nastav (set_section, set_camera preset=top projection=orthographic), potom ulož. " +
      "Zápis z viewera môže byť vypnutý (env brána); tool to povie.",
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

/** Výsledok `VIEW_CAPTURE` vo vieweri: `view` je uložený pohľad, `null` = viewer nič neuložil, `undefined` = starší viewer. */
export type CaptureOutcome =
  | { ok: true; view: { id: string; name?: string; objects?: number } | null | undefined; issues: string[] }
  | { ok: false; reason: string };

export interface SavedViewDeps {
  store: SavedViewStore;
  /** Pošle viewera `VIEW_CAPTURE` a počká na potvrdenie (`APPLIED.state.view`). */
  capture: (req: { name: string; capture_id: string }) => Promise<CaptureOutcome>;
  /** Povie otvorenému vieweru, aby načítal pohľady z DB znova (po premenovaní, zmazaní, prepísaní). */
  notifyChanged: () => Promise<void>;
  /** Surová odpoveď `view_state` z otvoreného viewera (starší viewer bez `VIEW_CAPTURE`); string = prečo sa nedala prečítať. */
  viewState: () => Promise<unknown>;
  /** Čakanie na zápis hosta (testy ho skracujú). */
  sleep?: (ms: number) => Promise<void>;
  newCaptureId?: () => string;
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

/** Zápis hosta z viewera ide cez route po potvrdení `APPLIED`; počká sa naň najviac ~4 s. */
const WRITE_POLL_MS = 300;
const WRITE_POLL_TRIES = 14;

async function waitForRow(deps: SavedViewDeps, id: string): Promise<SavedViewRow | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < WRITE_POLL_TRIES; i += 1) {
    const row = await deps.store.byId(id);
    if (row) return row;
    await sleep(WRITE_POLL_MS);
  }
  return null;
}

/** Starší viewer bez `VIEW_CAPTURE`: stav z `view_state` do riadku v tvare D-122 (len kamera, rez, výber, skrytie, izolácia). */
async function saveLegacy(args: Record<string, unknown>, deps: SavedViewDeps, existing: SavedViewRow | null) {
  const name = nameOf(args.name);
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
  return {
    saved: describeView(row),
    overwritten: Boolean(existing),
    notes: ["viewer je starší (bez uloženia do Presentation): pohľad je len v DB a v paneli sa neukáže", ...notes],
  };
}

async function save(args: Record<string, unknown>, deps: SavedViewDeps) {
  const name = nameOf(args.name);
  if (isLastName(name)) throw new ViewInputError(`'${LAST_VIEW_NAME}' sa zapisuje sám; zvoľ iné meno.`);
  const existing = await deps.store.byName(name);
  if (existing && args.overwrite !== true) {
    throw new ViewInputError(`Pohľad '${existing.name}' už existuje. Prepíš ho s overwrite=true alebo zvoľ iné meno.`);
  }
  const ignored = IGNORED_ARGS.filter((k) => args[k] !== undefined);
  const notes = ignored.length ? [`${ignored.join(", ")} sa ignoruje (D-161: pohľad nemá druh, zámok ani podklad; ukladá sa kamera, rezy a košík)`] : [];
  const out = await deps.capture({ name, capture_id: (deps.newCaptureId ?? (() => crypto.randomUUID()))() });
  if (!out.ok) throw new ViewInputError(`Pohľad sa nedá uložiť: ${out.reason}.`);
  if (out.view === undefined) {
    const legacy = await saveLegacy(args, deps, existing);
    return { ...legacy, notes: [...notes, ...legacy.notes] };
  }
  if (out.view === null) {
    throw new ViewInputError(`Viewer pohľad neuložil${out.issues.length ? `: ${out.issues.join("; ")}` : " (model nemá viditeľné prvky?)"}.`);
  }
  const written = await waitForRow(deps, out.view.id);
  if (!written) {
    throw new ViewInputError(
      "Pohľad je uložený len vo viewere (panel Presentation, v pamäti prehliadača): do DB ho host nezapísal. " +
        "Zápis z viewera je vypnutý (env brána VIEWS_WRITE_ENABLED) alebo zlyhal; po obnovení stránky pohľad zmizne.",
    );
  }
  // Prepísanie: starý pohľad zmizne a nový dostane jeho meno (host pri zápise meno kvôli kolízii doplnil príponou).
  const replaced = existing && existing.id !== written.id;
  if (replaced) await deps.store.remove(existing.id);
  const author = text(args.author, 200) || DEFAULT_VIEW_AUTHOR;
  const description = text(args.description, MAX_TEXT) || null;
  const rename = replaced && written.name !== name;
  const viewpoint = isWireViewpoint(written.viewpoint) && rename ? ({ ...written.viewpoint, name } as unknown as SavedViewpoint) : written.viewpoint;
  const row = await deps.store.update(written.id, { author, description, ...(rename ? { name, viewpoint } : {}) });
  await deps.store.setLast({
    viewpoint: row.viewpoint,
    selection: [],
    hidden: [],
    isolated: null,
    name: LAST_VIEW_NAME,
    description: `Uložený ako '${row.name}'`,
    model_revisions: row.model_revisions,
    author,
  });
  if (replaced) await deps.notifyChanged().catch(() => undefined);
  if (row.name !== name) notes.push(`meno '${name}' bolo obsadené, pohľad sa uložil ako '${row.name}'`);
  return { saved: describeView(row), overwritten: Boolean(replaced), ...(notes.length ? { notes } : {}) };
}

async function rename(args: Record<string, unknown>, deps: SavedViewDeps) {
  const row = await loadView(deps, args.name);
  if (row.kind === "last") throw new ViewInputError(`'${LAST_VIEW_NAME}' sa nepremenúva; ulož ho pod novým menom cez action=save.`);
  const next = nameOf(args.new_name, "new_name");
  if (isLastName(next)) throw new ViewInputError(`'${LAST_VIEW_NAME}' je vyhradené meno.`);
  const clash = await deps.store.byName(next);
  if (clash && clash.id !== row.id) throw new ViewInputError(`Pohľad '${clash.name}' už existuje.`);
  const from = row.name;
  const viewpoint = isWireViewpoint(row.viewpoint) ? ({ ...row.viewpoint, name: next } as unknown as SavedViewpoint) : row.viewpoint;
  const updated = await deps.store.update(row.id, { name: next, viewpoint });
  await deps.notifyChanged().catch(() => undefined);
  return { renamed: { from, to: updated.name } };
}

async function remove(args: Record<string, unknown>, deps: SavedViewDeps) {
  const row = await loadView(deps, args.name);
  if (row.kind === "last") throw new ViewInputError(`'${LAST_VIEW_NAME}' sa nemaže, prepíše ho ďalšie uloženie alebo obnova.`);
  await deps.store.remove(row.id);
  await deps.notifyChanged().catch(() => undefined);
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

/** `get_viewer_state(saved_views=true)`: zoznam z DB, aj bez otvoreného viewera; poradie ako v páse Presentation. */
export async function listSavedViews(deps: Pick<SavedViewDeps, "store">) {
  const [rows, last] = await Promise.all([deps.store.list(), deps.store.last()]);
  const views = [...rows].sort((a, b) => {
    const wa = wireOfRow(a);
    const wb = wireOfRow(b);
    if (wa && wb) return wa.order - wb.order;
    return wa ? -1 : wb ? 1 : 0;
  });
  return {
    saved_views: views.map(describeView),
    count: views.length,
    last: last ? describeView(last) : null,
    hint: "Otvorenie: set_view_mode(view=meno, section_offset_m=...). Uloženie: saved_view(action=save, name).",
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
