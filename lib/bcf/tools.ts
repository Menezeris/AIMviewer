import "server-only";

import { randomUUID } from "node:crypto";

import type { RoutineFireResult } from "@/lib/feedback/routine";
import type { ToolDefinition } from "@/lib/llm/provider";

import { selectionGuids, type ViewerSelection } from "../live/selection-summary";
import { ViewInputError } from "../llm/view-plan";

import { TOPIC_STATUSES, type BcfStore, type BcfTopicRow, type BcfTopicWrite, type TopicStatus } from "./store";

/**
 * BCF témy nad modelmi federácie (D-099), len v MCP konektore. Mená a
 * parametre sú 1:1 z `@ifc-lite/mcp` 0.27 (`bcf_topic_*`, `bcf_viewpoint_create`,
 * D-087); originál drží témy v pamäti session, tu sú v DB (`model_tasks`).
 * Téma priradená Claudovi spustí Claude session cez routine "AIM: BCF téma",
 * ktorá ju vyrieši (úprava modelu v OCB, revízia s poistkou, D-086).
 * Závislosti (DB, živý viewer, routine) sú v `runtime.ts`, tu len logika.
 */

/** `assigned_to` tejto hodnoty (bez ohľadu na veľkosť písmen) = téma pre Claude. */
export const CLAUDE_ASSIGNEE = "claude";
export const DEFAULT_AUTHOR = "Claude (MCP)";
/** Session bez pohybu v téme dlhšie než toto sa do stropu nepočíta. */
export const STALE_HOURS = 24;

const MAX_TITLE = 200;
const MAX_TEXT = 8000;
const MAX_LABELS = 20;
const MAX_COMPONENTS = 2000;
const LIST_DEFAULT = 20;
const LIST_MAX = 100;
const DETAIL_COMPONENTS = 200;

const STATUS_TEXT =
  "open | in_progress | resolved | closed | conflict | failed (BCF 'Open', 'In Progress', 'Closed' sa prevedú)";

const TARGET_PROPS = {
  target_ids_or_refs: {
    type: "array",
    items: { type: "string" },
    description: "Prvky témy: objects.id alebo object_ref (napr. DD01.06.03); prevedú sa na IFC GlobalId.",
  },
  global_ids: { type: "array", items: { type: "string" }, description: "Prvky témy ako IFC GlobalId (z ifc_* tools)." },
} as const;

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export const BCF_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "bcf_topic_create",
    description:
      "Založí BCF tému (issue) nad modelom federácie (D-099): chyba, kolízia, pripomienka alebo požiadavka na " +
      "úpravu modelu. Volaj, keď používateľ povie 'založ BCF / tému / issue k tomuto prvku'. Prvky: " +
      "target_ids_or_refs alebo global_ids; bez nich a s capture_view (predvolene) sa vezme výber, kamera, rez " +
      "a režim z OTVORENÉHO živého viewera ako BCF pohľad. assigned_to='claude' = tému rieši Claude: hneď sa " +
      "spustí Claude Code session (úprava IFC v OCB, nová revízia); ľudí priraď menom alebo e-mailom, session " +
      "sa vtedy nespúšťa. Vráti guid a číslo témy (#N) na ďalšie volania.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: `Názov témy (max ${MAX_TITLE} znakov).` },
        description: { type: "string", description: "Čo je zle a čo by bolo správne (diktovaný text)." },
        author: { type: "string", description: `Kto tému zakladá (predvolene '${DEFAULT_AUTHOR}').` },
        type: { type: "string", description: "BCF topic_type: Issue (predvolené), Clash, Request, Remark..." },
        status: { type: "string", description: `Stav (predvolene open): ${STATUS_TEXT}` },
        priority: { type: "string", description: "Priorita, napr. High, Normal, Low." },
        assigned_to: {
          type: "string",
          description: "Komu: 'claude' (spustí session, ktorá to vyrieši) alebo meno/e-mail človeka.",
        },
        labels: { type: "array", items: { type: "string" }, description: "Štítky, napr. VZT, ASR, kolizia." },
        model: { type: "string", description: "Model federácie (ASR, VZT...); bez neho téma nad celou federáciou." },
        due_date: { type: "string", description: "Termín YYYY-MM-DD." },
        ...TARGET_PROPS,
        capture_view: {
          type: "boolean",
          description:
            "Uložiť pohľad z otvoreného viewera (kamera, rez, režim, podlažie, výber); predvolene true. Bez " +
            "otvoreného viewera téma vznikne bez pohľadu.",
        },
        start_session: {
          type: "boolean",
          description: "Pri assigned_to='claude': false = len zapísať, session nespúšťať (predvolene true).",
        },
      },
      required: ["title"],
    },
    annotations: WRITE,
  },
  {
    name: "bcf_topic_list",
    description:
      "BCF témy nad modelmi federácie (D-099), najnovšie prvé: číslo, guid, názov, stav, typ, priorita, " +
      "komu, model, počet prvkov a komentárov, odkaz na Claude session. Filtre status, model, assigned_to " +
      "('claude' = témy pre Claude). S guid (alebo číslom témy) vráti detail: popis, komentáre, pohľad " +
      "(kamera, rez, výber) a GlobalId prvkov - prvky ukáž cez show_in_3d(global_ids).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: STATUS_TEXT },
        model: { type: "string", description: "Model federácie (ASR, VZT...)." },
        assigned_to: { type: "string", description: "Komu je téma priradená." },
        guid: { type: "string", description: "guid témy alebo číslo (#12) - detail jednej témy." },
        limit: { type: "number", description: `Koľko tém (predvolene ${LIST_DEFAULT}, max ${LIST_MAX}).` },
      },
    },
  },
  {
    name: "bcf_topic_update",
    description:
      "Upraví BCF tému alebo k nej pridá komentár (D-099): stav, priorita, komu, popis, štítky, termín. " +
      "Priradenie Claudovi (assigned_to='claude') alebo start_session=true spustí Claude session, ak ešte " +
      "nebeží. Session, ktorá tému rieši, cez tento tool píše postup a výsledok.",
    inputSchema: {
      type: "object",
      properties: {
        guid: { type: "string", description: "guid témy alebo číslo (#12)." },
        status: { type: "string", description: STATUS_TEXT },
        priority: { type: "string" },
        comment: { type: "string", description: "Komentár k téme." },
        modified_by: { type: "string", description: `Kto mení (predvolene '${DEFAULT_AUTHOR}').` },
        assigned_to: { type: "string", description: "'claude' alebo meno/e-mail; prázdny reťazec zruší priradenie." },
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", description: "BCF topic_type." },
        labels: { type: "array", items: { type: "string" }, description: "Nahradí štítky." },
        due_date: { type: "string", description: "YYYY-MM-DD; prázdny reťazec zruší termín." },
        start_session: { type: "boolean", description: "Spustiť session pre tému priradenú Claudovi (aj z fronty)." },
      },
      required: ["guid"],
    },
    annotations: WRITE,
  },
  {
    name: "bcf_topic_close",
    description: "Uzavrie BCF tému (stav closed, D-099) - vybavené bez úpravy modelu; voliteľne s komentárom.",
    inputSchema: {
      type: "object",
      properties: {
        guid: { type: "string", description: "guid témy alebo číslo (#12)." },
        modified_by: { type: "string" },
        comment: { type: "string", description: "Prečo sa uzatvára." },
      },
      required: ["guid"],
    },
    annotations: { ...WRITE, idempotentHint: true },
  },
  {
    name: "bcf_viewpoint_create",
    description:
      "Nastaví pohľad BCF témy (D-099): prvky (selection_global_ids, target_ids_or_refs) a s capture_view " +
      "(predvolene true) kameru, rez, režim a výber z otvoreného viewera. Téma má jeden pohľad, nový nahradí " +
      "starý.",
    inputSchema: {
      type: "object",
      properties: {
        guid: { type: "string", description: "guid témy alebo číslo (#12)." },
        selection_global_ids: { type: "array", items: { type: "string" }, description: "IFC GlobalId prvkov." },
        target_ids_or_refs: TARGET_PROPS.target_ids_or_refs,
        capture_view: { type: "boolean", description: "Pohľad z otvoreného viewera (predvolene true)." },
      },
      required: ["guid"],
    },
    annotations: WRITE,
  },
];

export const BCF_TOOL_NAMES = new Set(BCF_TOOL_DEFINITIONS.map((t) => t.name));

/** Pohľad z viewera: BCF viewpoint + GlobalId výberu. */
export interface CapturedView {
  viewpoint: Record<string, unknown>;
  selection: string[];
}

export interface BcfDeps {
  store: BcfStore;
  /** Spustí session; null = routine "AIM: BCF téma" nie je nastavená. */
  fire: ((text: string) => Promise<RoutineFireResult>) | null;
  /** Pohľad z otvoreného viewera; string = prečo sa nedal zachytiť. */
  captureView: () => Promise<CapturedView | string>;
  /** object_ref / objects.id / GlobalId -> GlobalId (vzor view tools). */
  resolve: (input: Record<string, unknown>) => Promise<string[]>;
  now: () => Date;
  maxSessions: number;
  /** Po zápise: oznámenie otvoreným viewerom, že sa témy zmenili (D-099 dodatok). */
  notify?: () => Promise<void>;
}

/** Čistá časť: odpoveď `view_state` -> uložený pohľad (bez zoznamu GUID, ten je v components). */
export function viewFromState(result: unknown): CapturedView {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const sel = (r.selection && typeof r.selection === "object" ? r.selection : {}) as ViewerSelection;
  const selection = selectionGuids(sel);
  const count = typeof sel.count === "number" ? sel.count : selection.length;
  return {
    viewpoint: {
      guid: randomUUID(),
      source: "viewer",
      frame: r.frame ?? "ifc_world",
      units: r.units ?? "m",
      mode: r.mode ?? null,
      storey_guid: r.storey_guid ?? null,
      camera: r.camera ?? null,
      section: r.section ?? null,
      selection_count: count,
      selection_truncated: count > selection.length,
      ...(sel.bbox ? { selection_bbox: sel.bbox } : {}),
    },
    selection,
  };
}

export class BcfInputError extends Error {}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
};

const required = (v: unknown, max: number, field: string): string => {
  const s = text(v, max);
  if (!s) throw new BcfInputError(`Chýba ${field}.`);
  return s;
};

/** BCF stav v ľubovoľnom zápise ('In Progress', 'in-progress') -> hodnota v DB. */
export function normalizeStatus(v: unknown): TopicStatus | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((TOPIC_STATUSES as readonly string[]).includes(s)) return s as TopicStatus;
  throw new BcfInputError(`Neznámy stav '${String(v)}'. Povolené: ${TOPIC_STATUSES.join(", ")}.`);
}

function dueDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new BcfInputError(`due_date musí byť YYYY-MM-DD, nie '${s}'.`);
  }
  return s;
}

const labels = (v: unknown): string[] | undefined =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))].slice(0, MAX_LABELS)
    : undefined;

export const isClaude = (assignee: string | null | undefined) => assignee?.trim().toLowerCase() === CLAUDE_ASSIGNEE;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** guid témy alebo jej číslo ('12', '#12'). */
export function topicRef(v: unknown): { id?: string; number?: number } {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (UUID_RE.test(s)) return { id: s.toLowerCase() };
  const m = /^#?(\d{1,9})$/.exec(s);
  if (m) return { number: Number(m[1]) };
  throw new BcfInputError(`guid musí byť guid témy alebo jej číslo (#12), nie '${s || "(prázdne)"}'.`);
}

async function loadTopic(deps: BcfDeps, v: unknown): Promise<BcfTopicRow> {
  const ref = topicRef(v);
  const row = await deps.store.get(ref);
  if (!row) throw new BcfInputError(`Téma ${ref.id ?? `#${ref.number}`} neexistuje (bcf_topic_list ukáže, aké sú).`);
  return row;
}

/** Prvky z argumentov + výber z viewera; GlobalId bez duplicít. */
async function components(
  args: Record<string, unknown>,
  deps: BcfDeps,
  globalIdsKey: "global_ids" | "selection_global_ids",
): Promise<{ guids: string[]; viewpoint: Record<string, unknown> | null; viewNote: string | null }> {
  const input = { target_ids_or_refs: args.target_ids_or_refs, global_ids: args[globalIdsKey] };
  const explicit = input.target_ids_or_refs || input.global_ids ? await deps.resolve(input) : [];
  let viewpoint: Record<string, unknown> | null = null;
  let viewNote: string | null = null;
  let selected: string[] = [];
  if (args.capture_view !== false) {
    const view = await deps.captureView();
    if (typeof view === "string") viewNote = `Pohľad sa neuložil: ${view}.`;
    else {
      viewpoint = view.viewpoint;
      // Výber z viewera je prvkami témy, len keď ich Claude nezadal sám.
      if (explicit.length === 0) selected = view.selection;
    }
  }
  return { guids: [...new Set([...explicit, ...selected])].slice(0, MAX_COMPONENTS), viewpoint, viewNote };
}

/** Text pre `<routine-fire-payload>`; session si tému prečíta cez bcf_topic_list(guid). */
export function bcfFirePayload(t: BcfTopicRow): string {
  return [
    "BCF téma z MCP konektora AIM (D-099).",
    `tema: #${t.number}`,
    `guid: ${t.id}`,
    `model: ${t.model ?? "federacia"}`,
    `typ: ${t.topic_type}`,
    `nazov: ${t.title}`,
    `prvkov: ${t.components.length}`,
  ].join("\n");
}

export interface SessionOutcome {
  session: { url: string } | null;
  queued: boolean;
  note: string;
  topic: BcfTopicRow;
}

/** Spustí session pre tému priradenú Claudovi (ak nebeží a je miesto); inak povie prečo nie. */
export async function maybeStartSession(topic: BcfTopicRow, deps: BcfDeps, wanted: boolean): Promise<SessionOutcome> {
  const base = { session: null, queued: false, topic };
  if (!isClaude(topic.assigned_to)) return { ...base, note: "Téma nie je priradená Claudovi, session sa nespúšťa." };
  if (!wanted) return { ...base, note: "Session sa nespúšťala (start_session=false)." };
  if (topic.session_url) return { ...base, note: `Session pre tému už bola spustená: ${topic.session_url}` };
  if (topic.status !== "open") return { ...base, note: `Téma je v stave ${topic.status}, session sa spúšťa len pre otvorenú.` };
  if (!deps.fire) {
    return {
      ...base,
      queued: true,
      note:
        "Session sa nespustila: routine 'AIM: BCF téma' nie je nastavená na serveri (CLAUDE_BCF_ROUTINE_FIRE_URL, " +
        "CLAUDE_BCF_ROUTINE_TOKEN). Téma čaká; bcf_topic_update(start_session=true) ju spustí po nastavení.",
    };
  }
  const since = new Date(deps.now().getTime() - STALE_HOURS * 3600_000);
  const running = (await deps.store.runningSessions(since)).filter((t) => t.id !== topic.id);
  if (running.length >= deps.maxSessions) {
    return {
      ...base,
      queued: true,
      note:
        `Téma čaká vo fronte: bežia ${running.length} z ${deps.maxSessions} sessions ` +
        `(${running.map((t) => `#${t.number}`).join(", ")}). Spusť ju neskôr cez bcf_topic_update(start_session=true).`,
    };
  }
  let fired: RoutineFireResult;
  try {
    fired = await deps.fire(bcfFirePayload(topic));
  } catch (err) {
    return { ...base, queued: true, note: `Session sa nespustila: ${err instanceof Error ? err.message : String(err)}. Téma čaká.` };
  }
  const updated = await deps.store.update(topic.id, { session_url: fired.sessionUrl, status: "in_progress" });
  // Komentár je pohodlie: zlyhanie nemá zhodiť výsledok, session už beží.
  await deps.store.addComment(topic.id, DEFAULT_AUTHOR, `Claude session rieši tému: ${fired.sessionUrl}`).catch(() => null);
  return { session: { url: fired.sessionUrl }, queued: false, note: "Session beží; postup a otázky píše do komentárov témy.", topic: updated };
}

/** Krátky riadok zoznamu. */
export function summary(t: BcfTopicRow) {
  return {
    number: t.number,
    guid: t.id,
    title: t.title,
    status: t.status,
    type: t.topic_type,
    priority: t.priority,
    assigned_to: t.assigned_to,
    model: t.model,
    due_date: t.due_date,
    labels: t.labels,
    components: t.components.length,
    comments: t.comments.length,
    session_url: t.session_url,
    result_revision: t.result_revision,
    updated_at: t.updated_at,
  };
}

/** Detail témy pre model: komentáre, pohľad a orezaný zoznam GlobalId. */
export function detail(t: BcfTopicRow) {
  return {
    ...summary(t),
    description: t.description,
    author: t.author,
    modified_by: t.modified_by,
    created_at: t.created_at,
    stage: t.stage,
    run_url: t.run_url,
    base_revision: t.base_revision,
    global_ids: t.components.slice(0, DETAIL_COMPONENTS),
    global_ids_truncated: t.components.length > DETAIL_COMPONENTS,
    viewpoint: t.viewpoint,
    comment_list: t.comments,
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

async function create(args: Record<string, unknown>, deps: BcfDeps) {
  const title = required(args.title, MAX_TITLE, "title");
  const { guids, viewpoint, viewNote } = await components(args, deps, "global_ids");
  const author = text(args.author, 200) || DEFAULT_AUTHOR;
  const row = await deps.store.create({
    title,
    description: text(args.description, MAX_TEXT) || null,
    author,
    modified_by: author,
    topic_type: text(args.type, 60) || "Issue",
    status: normalizeStatus(args.status) ?? "open",
    priority: text(args.priority, 60) || null,
    assigned_to: text(args.assigned_to, 200) || null,
    labels: labels(args.labels) ?? [],
    model: text(args.model, 40) || null,
    due_date: dueDate(args.due_date) ?? null,
    components: guids,
    viewpoint,
  });
  const s = await maybeStartSession(row, deps, args.start_session !== false);
  return {
    topic: summary(s.topic),
    viewpoint_saved: Boolean(viewpoint),
    view_note: viewNote,
    session: s.session,
    queued: s.queued,
    session_note: s.note,
    hint: guids.length ? "Prvky témy ukáž cez show_in_3d(global_ids)." : "Téma nemá prvky; doplň ich cez bcf_viewpoint_create.",
  };
}

async function list(args: Record<string, unknown>, deps: BcfDeps) {
  if (args.guid !== undefined && args.guid !== "") return { topic: detail(await loadTopic(deps, args.guid)) };
  const n = Number(args.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(LIST_MAX, Math.trunc(n)) : LIST_DEFAULT;
  const { rows, total } = await deps.store.list({
    status: normalizeStatus(args.status),
    model: text(args.model, 40) || undefined,
    assigned_to: text(args.assigned_to, 200) || undefined,
    limit,
  });
  return { count: total, returned: rows.length, topics: rows.map(summary) };
}

async function update(args: Record<string, unknown>, deps: BcfDeps) {
  const topic = await loadTopic(deps, args.guid);
  const wasClaude = isClaude(topic.assigned_to);
  const by = text(args.modified_by, 200) || DEFAULT_AUTHOR;
  const patch: BcfTopicWrite = { modified_by: by };
  const status = normalizeStatus(args.status);
  if (status) patch.status = status;
  if (typeof args.priority === "string") patch.priority = text(args.priority, 60) || null;
  if (typeof args.assigned_to === "string") patch.assigned_to = text(args.assigned_to, 200) || null;
  if (typeof args.title === "string") patch.title = required(args.title, MAX_TITLE, "title");
  if (typeof args.description === "string") patch.description = text(args.description, MAX_TEXT) || null;
  if (typeof args.type === "string") patch.topic_type = text(args.type, 60) || "Issue";
  const l = labels(args.labels);
  if (l) patch.labels = l;
  const due = dueDate(args.due_date);
  if (due !== undefined) patch.due_date = due;

  let row = Object.keys(patch).length > 1 ? await deps.store.update(topic.id, patch) : topic;
  const comment = text(args.comment, MAX_TEXT);
  if (comment) await deps.store.addComment(topic.id, by, comment);
  const assignedNow = patch.assigned_to !== undefined && isClaude(patch.assigned_to) && !wasClaude;
  const s =
    assignedNow || args.start_session === true
      ? await maybeStartSession(row, deps, args.start_session !== false)
      : null;
  if (s) row = s.topic;
  if (comment) row = (await deps.store.get({ id: topic.id })) ?? row;
  return {
    topic: summary(row),
    comment_added: Boolean(comment),
    ...(s ? { session: s.session, queued: s.queued, session_note: s.note } : {}),
  };
}

async function close(args: Record<string, unknown>, deps: BcfDeps) {
  const topic = await loadTopic(deps, args.guid);
  const by = text(args.modified_by, 200) || DEFAULT_AUTHOR;
  const comment = text(args.comment, MAX_TEXT);
  if (comment) await deps.store.addComment(topic.id, by, comment);
  const row = await deps.store.update(topic.id, { status: "closed", modified_by: by });
  return { topic: summary(row), closed: true };
}

async function viewpoint(args: Record<string, unknown>, deps: BcfDeps) {
  const topic = await loadTopic(deps, args.guid);
  const c = await components(args, deps, "selection_global_ids");
  if (c.guids.length === 0 && !c.viewpoint) {
    throw new BcfInputError(`Nie je čo uložiť: žiadne prvky a pohľad z viewera chýba (${c.viewNote ?? "capture_view=false"}).`);
  }
  const row = await deps.store.update(topic.id, {
    components: c.guids,
    viewpoint: c.viewpoint ?? { guid: randomUUID(), source: "selection" },
    modified_by: DEFAULT_AUTHOR,
  });
  return { topic: summary(row), selection: c.guids.length, viewpoint_from_viewer: Boolean(c.viewpoint), view_note: c.viewNote };
}

const WRITES: Record<string, (args: Record<string, unknown>, deps: BcfDeps) => Promise<unknown>> = {
  bcf_topic_create: create,
  bcf_topic_update: update,
  bcf_topic_close: close,
  bcf_viewpoint_create: viewpoint,
};

export async function execBcfTool(
  name: string,
  args: Record<string, unknown>,
  deps: BcfDeps,
): Promise<{ text: string; isError: boolean }> {
  try {
    if (name === "bcf_topic_list") return { text: json(await list(args, deps)), isError: false };
    const write = WRITES[name];
    if (!write) return { text: `Neznámy tool: ${name}`, isError: true };
    const result = await write(args, deps);
    // Oznámenie je pohodlie: zlyhanie nemá zhodiť zápis, ktorý už prebehol.
    await deps.notify?.().catch(() => undefined);
    return { text: json(result), isError: false };
  } catch (err) {
    if (err instanceof BcfInputError || err instanceof ViewInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
