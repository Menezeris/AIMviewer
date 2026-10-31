import "server-only";

import { randomUUID } from "node:crypto";

import type { RoutineFireResult } from "@/lib/feedback/routine";
import type { ToolDefinition } from "@/lib/llm/provider";

import { selectionGuids, type ViewerSelection } from "../live/selection-summary";
import { ViewInputError } from "../llm/view-plan";

import { documentView, MAX_TOPIC_DOCUMENTS, resolveDocumentArg, TopicDocumentError } from "./documents";
import { reviewState, type ReviewState } from "./document-review";
import { topicInScope, type EntityScope } from "./entity-scope";
import type { RegionElement } from "./region-model";
import {
  TOPIC_STATUSES,
  type BcfStore,
  type BcfTopicRow,
  type BcfTopicWrite,
  type DocumentInfo,
  type TopicDocumentRow,
  type TopicFilter,
  type TopicStatus,
} from "./store";

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
export const MAX_COMPONENTS = 2000;
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

/** `bcf_topic` action -> zápisový handler (D-115); hodnoty sú už len vnútorné kľúče handlerov. */
export const BCF_ACTIONS = {
  create: "bcf_topic_create",
  update: "bcf_topic_update",
  close: "bcf_topic_close",
  viewpoint: "bcf_viewpoint_create",
  from_viewer: "bcf_topic_from_viewer",
  locate: "bcf_topic_locate",
  import: "bcf_topic_import",
} as const;

export const BCF_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "bcf_topic_list",
    description:
      "BCF témy nad modelmi federácie (D-099; issues a požiadavky konektora dá feedback_status), najnovšie prvé: číslo, guid, názov, stav, typ, priorita, " +
      "komu, model, počet prvkov a komentárov, odkaz na Claude session. Filtre status, model, assigned_to " +
      "('claude' = témy pre Claude). S guid (alebo číslom témy) vráti detail: popis, komentáre, pohľad " +
      "(kamera, rez, výber) a GlobalId prvkov - prvky ukáž cez show_in_3d(global_ids). S filtrom vráti aj " +
      "by_status (počty tém podľa stavu pri ostatných filtroch): na otázku o stave stačí jedno volanie, " +
      "iné stavy ani bez filtra už nevolaj. document (+ page) = pripomienky na dokumente / strane (D-158); detail " +
      "témy nesie documents s pripravenými argumentmi open_drawing (strana a oblasť) a snapshot_url (výrez s rámikom). " +
      "entity = témy nad podlažím, priestorom, budovou alebo prvkom vrátane všetkého v ňom (prvky, priestory, pôdorys " +
      "podlažia); entity='projekt' = len témy na celý projekt (IfcProject). context = druh kontextu témy (D-158): " +
      "3d (má 3D pohľad), pdf (má odkaz na dokument), both, none (ani jedno); každý riadok nesie pole context. " +
      "Pripomienka na dokumente sa pri novej revízii dokumentu prenáša sama (D-158 krok 6): detail témy označí odkaz, " +
      "ktorého revízia sa od založenia zmenila (revision_changed, revision_current, original = pôvodná revízia, strana a oblasť), " +
      "otvorená téma dostane needs_review (skontrolovať po revízii) a position_uncertain, keď sa zmenil počet alebo veľkosť strán; " +
      "uzavretá (closed, resolved) príznak nemá. Riadok zoznamu nesie needs_review (počet odkazov na kontrolu). " +
      "needs_review=true = len témy s odkazom na kontrolu po revízii.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: STATUS_TEXT },
        model: { type: "string", description: "Model federácie (ASR, VZT...)." },
        assigned_to: { type: "string", description: "Komu je téma priradená." },
        guid: { type: "string", description: "guid témy alebo číslo (#12) - detail jednej témy." },
        document: { type: "string", description: "Len témy s odkazom na dokument: objects.id, object_ref alebo kód dokumentu." },
        page: { type: "number", description: "S document: len odkazy na túto stranu." },
        entity: {
          type: "string",
          description: "Len témy nad entitou a tým, čo je v nej: podlažie (1NP), priestor, budova, object_ref, objects.id, GlobalId; 'projekt' = témy na celý projekt.",
        },
        context: { type: "string", enum: ["3d", "pdf", "both", "none"], description: "Len témy s týmto kontextom: 3d = má 3D pohľad, pdf = má odkaz na dokument, both = oboje, none = ani jedno." },
        needs_review: { type: "boolean", description: "true = len otvorené témy s odkazom na dokument, ktorý dostal novú revíziu a nikto ešte nepotvrdil kontrolu (D-158 krok 6)." },
        limit: { type: "number", description: `Koľko tém (predvolene ${LIST_DEFAULT}, max ${LIST_MAX}).` },
      },
    },
  },
  {
    name: "bcf_topic",
    description:
      "Zápis BCF témy nad modelom federácie (D-099). action=create: založí tému (chyba, kolízia, pripomienka, " +
      "požiadavka na úpravu modelu), keď používateľ povie 'založ BCF / tému / issue'; prvky cez target_ids_or_refs " +
      "alebo global_ids, s capture_view (predvolene) sa vezme výber, kamera, rez a režim z otvoreného viewera. " +
      "assigned_to='claude' = tému rieši Claude: spustí sa Claude Code session (úprava IFC v OCB, nová revízia); " +
      "ľudí priraď menom alebo e-mailom. update: stav, priorita, komu, popis, štítky, termín alebo comment; " +
      "start_session spustí session pre tému Claudovi. close: uzavrie tému bez úpravy modelu. viewpoint: nastaví " +
      "jediný pohľad témy (selection_global_ids, capture_view). PRIPOMIENKA NA DOKUMENTE (D-158): create alebo update s " +
      "document = {id_or_ref, page, region, description} pripojí k téme dokument, stranu a oblasť strany (region v % ako " +
      "open_drawing); prvky, ktorých sa týka (aj IfcSpace, podlažie, IfcProject = celý projekt), daj do target_ids_or_refs. " +
      "remove_document = guid odkazu alebo 'all'. from_viewer: uloží témy založené v BCF paneli viewera (aj pripomienky " +
      "na PDF, get_viewer_state ich ukáže v bcf_local) do AIM s tým istým guid, na pokyn 'ulož moje pripomienky', aj s ich " +
      "značkami na strane (markup: obláčik, šípka, text, pin; detail odkazu ich nesie v markup a markup_count); guids " +
      "= len vybrané. locate (guid, document_guid): oblasť strany z odkazu témy prepočíta cez kalibráciu strany (D-133) " +
      "na IFC súradnice a navrhne prvky v oblasti, nadradené priestory a podlažie a 3D pohľad nad oblasťou; bez apply " +
      "len návrh, apply=components|viewpoint|all zapíše (pohľad témy prepíše len replace=true). review_document = guid odkazu " +
      "alebo 'all' (update): potvrdí kontrolu po novej revízii dokumentu a zruší príznak needs_review (kto a kedy sa zapíše). " +
      "import: uloží témy z .bcfzip (BCF 2.1 aj 3.0, aj s odkazmi na PDF z nášho exportu) do AIM; url (https, verejné úložisko " +
      "projektu) alebo data_base64; idempotentne podľa guid témy (opakovaný import nič nezdvojí, zmenené polia sa aktualizujú, " +
      "komentáre a odkazy sa len pridávajú); téma v DB novšia než súbor = konflikt, len sa ohlási (conflict=overwrite ju prepíše); " +
      "dry_run=true len ukáže, čo by sa stalo; guids = len vybrané témy. " +
      "Vráti guid a číslo témy (#N).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: Object.keys(BCF_ACTIONS) },
        guid: { type: "string", description: "update, close, viewpoint: guid témy alebo číslo (#12)" },
        title: { type: "string", description: `create: názov témy (max ${MAX_TITLE} znakov)` },
        description: { type: "string", description: "Čo je zle a čo by bolo správne" },
        comment: { type: "string", description: "update, close: komentár k téme" },
        status: { type: "string", description: STATUS_TEXT },
        priority: { type: "string", description: "High, Normal, Low" },
        assigned_to: { type: "string", description: "'claude' alebo meno/e-mail; prázdny reťazec zruší priradenie" },
        type: { type: "string", description: "BCF topic_type: Issue (predvolené), Clash, Request, Remark..." },
        labels: { type: "array", items: { type: "string" }, description: "Štítky (update ich nahradí)" },
        model: { type: "string", description: "create: model federácie; bez neho téma nad celou federáciou" },
        due_date: { type: "string", description: "YYYY-MM-DD; prázdny reťazec zruší termín" },
        author: { type: "string", description: `create: kto zakladá (predvolene '${DEFAULT_AUTHOR}')` },
        modified_by: { type: "string", description: `Kto mení (predvolene '${DEFAULT_AUTHOR}')` },
        ...TARGET_PROPS,
        selection_global_ids: { type: "array", items: { type: "string" }, description: "viewpoint: IFC GlobalId prvkov" },
        capture_view: { type: "boolean", description: "create, viewpoint: pohľad z otvoreného viewera (predvolene true)" },
        start_session: { type: "boolean", description: "Pri téme pre Claude: false = nespúšťať session; update: true = spustiť" },
        document: {
          type: "object",
          description: "create, update: pripojí odkaz na dokument (BCF DocumentReference); update pridá ďalší",
          properties: {
            id_or_ref: { type: "string", description: "objects.id, object_ref alebo kód dokumentu (search_documents, get_object include=documents)" },
            page: { type: "number", description: "Strana (od 1); bez nej celý dokument" },
            region: {
              type: "object",
              description: "Oblasť strany v % (0-100, vľavo hore) ako open_drawing region, napr. {x:50,y:0,width:50,height:50}",
              properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
            },
            description: { type: "string", description: "Čo je na tomto mieste dokumentu" },
          },
          required: ["id_or_ref"],
        },
        remove_document: { type: "string", description: "update: guid odkazu na dokument (z bcf_topic_list) alebo 'all'" },
        review_document: { type: "string", description: "update: guid odkazu na dokument alebo 'all' - potvrdí kontrolu po novej revízii dokumentu (zruší needs_review); modified_by je kto" },
        guids: { type: "array", items: { type: "string" }, description: "from_viewer: len tieto témy z bcf_local (predvolene všetky); import: len tieto témy zo súboru" },
        url: { type: "string", description: "import: https adresa .bcfzip vo verejnom úložisku projektu (alebo z BCF_IMPORT_HOSTS)" },
        data_base64: { type: "string", description: "import: .bcfzip v base64 (malé súbory; väčšie cez url)" },
        dry_run: { type: "boolean", description: "import: nič nezapísať, len ukázať, čo by sa vytvorilo, zmenilo alebo skonfliktovalo" },
        conflict: { type: "string", enum: ["keep", "overwrite"], description: "import: téma v DB novšia než súbor - keep (predvolené, len ohlási) alebo overwrite (prepíše súborom)" },
        document_guid: { type: "string", description: "locate: guid odkazu na dokument (predvolene prvý so stranou)" },
        apply: { type: "string", enum: ["components", "viewpoint", "all"], description: "locate: zapísať návrh do témy (bez neho len návrh)" },
        replace: { type: "boolean", description: "locate: nahradiť existujúci pohľad témy" },
        include_parents: { type: "boolean", description: "locate s apply: pridať do prvkov aj podlažie a priestory v oblasti" },
      },
      required: ["action"],
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
  /** Celý `view_state` viewera (lokálne témy, D-158); string = prečo sa nedal prečítať. */
  viewState?: () => Promise<Record<string, unknown> | string>;
  /** object_ref / objects.id / GlobalId -> GlobalId (vzor view tools). */
  resolve: (input: Record<string, unknown>) => Promise<string[]>;
  now: () => Date;
  maxSessions: number;
  /** Po zápise: oznámenie otvoreným viewerom, že sa témy zmenili (D-099 dodatok). */
  notify?: () => Promise<void>;
  /** Prvky federácie v IFC svete a výšky podlaží (`locate`, D-158 krok 4). */
  regionModel?: () => Promise<{ elements: Iterable<RegionElement>; elevations: number[] }>;
  /** Rozsah entity pre filter `entity` zoznamu tém (D-158 krok 4). */
  entityScope?: (ref: string) => Promise<EntityScope>;
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

export async function loadTopic(deps: BcfDeps, v: unknown): Promise<BcfTopicRow> {
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
        "CLAUDE_BCF_ROUTINE_TOKEN). Téma čaká; bcf_topic(action=update, start_session=true) ju spustí po nastavení.",
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
        `(${running.map((t) => `#${t.number}`).join(", ")}). Spusť ju neskôr cez bcf_topic(action=update, start_session=true).`,
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

/** Krátky riadok zoznamu; `docs` = počet odkazov na dokumenty, keď sa čítali. */
export function summary(t: BcfTopicRow, docs?: number) {
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
    ...(docs ? { documents: docs } : {}),
    session_url: t.session_url,
    result_revision: t.result_revision,
    updated_at: t.updated_at,
  };
}

export type TopicContext = "3d" | "pdf" | "both" | "none";
const CONTEXTS: readonly TopicContext[] = ["3d", "pdf", "both", "none"];

/** Druh kontextu témy (D-158): 3D pohľad (`viewpoint`), odkaz na dokument, oboje, ani jedno. */
export function topicContext(t: Pick<BcfTopicRow, "viewpoint">, docs: number): TopicContext {
  const has3d = t.viewpoint != null;
  if (has3d && docs > 0) return "both";
  return has3d ? "3d" : docs > 0 ? "pdf" : "none";
}

function contextFilter(v: unknown): TopicContext | undefined {
  if (v === undefined || v === "") return undefined;
  const c = String(v).toLowerCase() as TopicContext;
  if (!CONTEXTS.includes(c)) throw new BcfInputError(`context: ${CONTEXTS.join(" | ")}`);
  return c;
}

/** Zhoda kontextu témy s filtrom: 3d a pdf berú aj `both`. */
const contextMatches = (c: TopicContext, want: TopicContext) =>
  want === c || (want === "3d" && c === "both") || (want === "pdf" && c === "both");

/** Detail témy pre model: komentáre, pohľad, odkazy na dokumenty a orezaný zoznam GlobalId. */
export function detail(t: BcfTopicRow, docs: TopicDocumentRow[] = []) {
  return {
    ...summary(t, docs.length),
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
    documents: docs.map(documentView),
    comment_list: t.comments,
  };
}

/** Pripojí odkaz na dokument z argumentu `document` (D-158); strop odkazov na tému. */
async function attachDocument(
  deps: BcfDeps,
  topicId: string,
  prepared: Awaited<ReturnType<typeof resolveDocumentArg>>,
): Promise<TopicDocumentRow> {
  const existing = await deps.store.documents([topicId]);
  if (existing.length >= MAX_TOPIC_DOCUMENTS) {
    throw new BcfInputError(`Téma má už ${existing.length} odkazov na dokumenty (strop ${MAX_TOPIC_DOCUMENTS}); zmaž niektorý cez remove_document.`);
  }
  return deps.store.addDocument({ ...prepared, task_id: topicId });
}

/** Stav kontroly po novej revízii každého odkazu témy (aktuálna revízia dokumentu sa číta raz na dokument). */
async function reviewStates(
  deps: BcfDeps,
  t: Pick<BcfTopicRow, "status">,
  docs: TopicDocumentRow[],
  cache: Map<string, DocumentInfo | null> = new Map(),
): Promise<ReviewState[]> {
  for (const d of docs) if (d.document_id && !cache.has(d.document_id)) cache.set(d.document_id, await deps.store.findDocument(d.document_id));
  return docs.map((d) => reviewState(d, t.status, d.document_id ? (cache.get(d.document_id) ?? null) : null));
}

/** Odkaz v detaile s príznakmi kontroly; zmenený odkaz nesie aj pôvodné miesto (kotva v histórii). */
function annotate(view: ReturnType<typeof documentView>, link: TopicDocumentRow, st: ReviewState) {
  if (!st.revision_changed) return view;
  return {
    ...view,
    revision_changed: true,
    revision_current: st.revision_current,
    original: { revision: link.document_revision, sha256: link.document_sha256, page: link.page, region: link.region },
    needs_review: st.needs_review,
    ...(st.position_uncertain ? { position_uncertain: true, position_reason: st.position_reason } : {}),
    ...(link.reviewed_at ? { reviewed: { revision: link.reviewed_revision, by: link.reviewed_by, at: link.reviewed_at } } : {}),
  };
}

/** Počet odkazov na kontrolu po novej revízii pri každej téme (len témy, ktoré ho majú > 0). */
async function reviewCounts(deps: BcfDeps, rows: BcfTopicRow[], docs: TopicDocumentRow[]): Promise<Map<string, number>> {
  const byTopic = new Map<string, TopicDocumentRow[]>();
  for (const d of docs) byTopic.set(d.task_id, [...(byTopic.get(d.task_id) ?? []), d]);
  const cache = new Map<string, DocumentInfo | null>();
  const out = new Map<string, number>();
  for (const r of rows) {
    const links = byTopic.get(r.id) ?? [];
    if (links.length === 0) continue;
    const n = (await reviewStates(deps, r, links, cache)).filter((x) => x.needs_review).length;
    if (n > 0) out.set(r.id, n);
  }
  return out;
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

async function create(args: Record<string, unknown>, deps: BcfDeps) {
  const title = required(args.title, MAX_TITLE, "title");
  const author = text(args.author, 200) || DEFAULT_AUTHOR;
  // Dokument sa overí pred založením, aby chybný odkaz nenechal tému bez neho.
  const doc = args.document !== undefined ? await resolveDocumentArg(deps.store, args.document, author) : null;
  const { guids, viewpoint, viewNote } = await components(args, deps, "global_ids");
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
  const attached = doc ? await deps.store.addDocument({ ...doc, task_id: row.id }) : null;
  const s = await maybeStartSession(row, deps, args.start_session !== false);
  return {
    topic: summary(s.topic, attached ? 1 : 0),
    ...(attached ? { document: documentView(attached) } : {}),
    viewpoint_saved: Boolean(viewpoint),
    view_note: viewNote,
    session: s.session,
    queued: s.queued,
    session_note: s.note,
    hint: [
      guids.length ? "Prvky témy ukáž cez show_in_3d(global_ids)." : "Téma nemá prvky; doplň ich cez bcf_topic(action=viewpoint).",
      ...(attached?.document_id ? ["Miesto v dokumente ukáž cez open_drawing s argumentmi document.open_drawing."] : []),
    ].join(" "),
  };
}

async function list(args: Record<string, unknown>, deps: BcfDeps) {
  if (args.guid !== undefined && args.guid !== "") {
    const t = await loadTopic(deps, args.guid);
    const docs = await deps.store.documents([t.id]);
    const out = detail(t, docs);
    // Odkaz sa na novú revíziu prenáša sám (D-158 krok 6); pôvodná revízia, strana a oblasť ostávajú.
    const states = await reviewStates(deps, t, docs);
    out.documents = out.documents.map((v, i) => annotate(v, docs[i], states[i]));
    return { topic: out };
  }
  const n = Number(args.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(LIST_MAX, Math.trunc(n)) : LIST_DEFAULT;
  const filter = {
    status: normalizeStatus(args.status),
    model: text(args.model, 40) || undefined,
    assigned_to: text(args.assigned_to, 200) || undefined,
    ...(await documentFilter(args, deps)),
  };
  const entity = text(args.entity, 200);
  const context = contextFilter(args.context);
  const onlyReview = args.needs_review === true;
  if (entity) return listInEntity(entity, filter, limit, deps, context, onlyReview);
  if (context || onlyReview) return listInContext(context, filter, limit, deps, onlyReview);
  const { rows, total } = await deps.store.list({ ...filter, limit });
  const docs = await deps.store.documents(rows.map((r) => r.id));
  const docCount = new Map<string, number>();
  for (const d of docs) docCount.set(d.task_id, (docCount.get(d.task_id) ?? 0) + 1);
  // Počty podľa stavu, inak agent skúša stav po stave a potom bez filtra (#97, C12: 3 volania).
  const filtered = Boolean(filter.status || filter.model || filter.assigned_to || filter.document_id);
  const byStatus = filtered ? await countByStatus(deps, filter) : undefined;
  const review = await reviewCounts(deps, rows, docs);
  return {
    count: total,
    ...(byStatus ? { by_status: byStatus } : {}),
    returned: rows.length,
    topics: rows.map((r) => ({ ...summary(r, docCount.get(r.id)), context: topicContext(r, docCount.get(r.id) ?? 0), ...(review.has(r.id) ? { needs_review: review.get(r.id) } : {}) })),
  };
}

/** Filter `context` a `needs_review` bez entity: témy sa prejdú ako pri entite (obe vlastnosti sú odvodené). */
async function listInContext(want: TopicContext | undefined, filter: Omit<TopicFilter, "limit">, limit: number, deps: BcfDeps, onlyReview = false) {
  const { rows, total } = await deps.store.list({ ...filter, limit: ENTITY_SCAN });
  const docs = await deps.store.documents(rows.map((r) => r.id));
  const docCount = new Map<string, number>();
  for (const d of docs) docCount.set(d.task_id, (docCount.get(d.task_id) ?? 0) + 1);
  const review = await reviewCounts(deps, rows, docs);
  const hits = rows
    .map((r) => ({ r, c: topicContext(r, docCount.get(r.id) ?? 0) }))
    .filter((h) => !want || contextMatches(h.c, want))
    .filter((h) => !onlyReview || review.has(h.r.id));
  const byStatus: Record<string, number> = {};
  for (const { r } of hits) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    ...(want ? { context: want } : {}),
    ...(onlyReview ? { needs_review: true } : {}),
    count: hits.length,
    by_status: byStatus,
    returned: Math.min(limit, hits.length),
    ...(total > rows.length ? { note: `Prejdených ${rows.length} z ${total} tém (najnovšie); zúž filtrom status alebo model.` } : {}),
    topics: hits.slice(0, limit).map(({ r, c }) => ({ ...summary(r, docCount.get(r.id)), context: c, ...(review.has(r.id) ? { needs_review: review.get(r.id) } : {}) })),
  };
}

/** Najviac tém, ktoré filter entity prejde (tabuľka tém je malá; viac = upozornenie). */
const ENTITY_SCAN = 1000;

/** Filter `entity` (D-158 krok 4): témy s prvkom entity alebo v nej, alebo s dokumentom entity. */
async function listInEntity(ref: string, filter: Omit<TopicFilter, "limit">, limit: number, deps: BcfDeps, context?: TopicContext, onlyReview = false) {
  if (!deps.entityScope) throw new BcfInputError("Filter entity nie je v tomto prostredí k dispozícii.");
  const scope = await deps.entityScope(ref);
  const { rows, total } = await deps.store.list({ ...filter, limit: ENTITY_SCAN });
  const docs = await deps.store.documents(rows.map((r) => r.id));
  const byTopic = new Map<string, TopicDocumentRow[]>();
  for (const d of docs) byTopic.set(d.task_id, [...(byTopic.get(d.task_id) ?? []), d]);
  const review = await reviewCounts(deps, rows, docs);
  const hits = rows
    .map((r) => ({ r, how: topicInScope(r, byTopic.get(r.id) ?? [], scope) }))
    .filter((h): h is { r: BcfTopicRow; how: NonNullable<typeof h.how> } => h.how !== null)
    .filter((h) => !context || contextMatches(topicContext(h.r, byTopic.get(h.r.id)?.length ?? 0), context))
    .filter((h) => !onlyReview || review.has(h.r.id));
  const byStatus: Record<string, number> = {};
  for (const { r } of hits) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    entity: { ref: scope.label, object_type: scope.object_type, global_id: scope.self, elements: scope.guids.size, documents: scope.documents.size },
    count: hits.length,
    by_status: byStatus,
    returned: Math.min(limit, hits.length),
    ...(total > rows.length ? { note: `Prejdených ${rows.length} z ${total} tém (najnovšie); zúž filtrom status alebo model.` } : {}),
    topics: hits.slice(0, limit).map(({ r, how }) => ({ ...summary(r, byTopic.get(r.id)?.length), context: topicContext(r, byTopic.get(r.id)?.length ?? 0), match: how, ...(review.has(r.id) ? { needs_review: review.get(r.id) } : {}) })),
  };
}

/** Filter `document` (+ `page`) zoznamu -> objects.id dokumentu; neznámy dokument = chyba, nie prázdny zoznam. */
async function documentFilter(args: Record<string, unknown>, deps: BcfDeps): Promise<{ document_id?: string; page?: number }> {
  const ref = text(args.document, 200);
  if (!ref) return {};
  const info = await deps.store.findDocument(ref);
  if (!info) throw new BcfInputError(`Dokument '${ref}' v AIM nie je (search_documents ho nájde).`);
  const n = Number(args.page);
  return { document_id: info.id, ...(args.page !== undefined && Number.isInteger(n) && n >= 1 ? { page: n } : {}) };
}

/** Nenulové počty tém podľa stavu pri filtroch model a assigned_to (tabuľka tém je malá). */
async function countByStatus(deps: BcfDeps, filter: { model?: string; assigned_to?: string; document_id?: string; page?: number }) {
  const counts = await Promise.all(
    TOPIC_STATUSES.map(async (status) => [status, (await deps.store.list({ ...filter, status, limit: 1 })).total] as const),
  );
  return Object.fromEntries(counts.filter(([, n]) => n > 0));
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
  const doc = args.document !== undefined ? await resolveDocumentArg(deps.store, args.document, by) : null;
  const remove = text(args.remove_document, 60);
  const removed = remove ? await removeDocuments(deps, topic.id, remove) : 0;
  const attached = doc ? await attachDocument(deps, topic.id, doc) : null;
  const reviewRef = text(args.review_document, 60);
  const reviewed = reviewRef ? await reviewDocuments(deps, topic, reviewRef, by) : 0;

  // Zmena odkazov na dokumenty je zmena témy (modified_by, updated_at).
  let row = Object.keys(patch).length > 1 || attached || removed || reviewed ? await deps.store.update(topic.id, patch) : topic;
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
    ...(attached ? { document: documentView(attached) } : {}),
    ...(remove ? { documents_removed: removed } : {}),
    ...(reviewRef ? { documents_reviewed: reviewed } : {}),
    ...(s ? { session: s.session, queued: s.queued, session_note: s.note } : {}),
  };
}

async function removeDocuments(deps: BcfDeps, topicId: string, ref: string): Promise<number> {
  const all = ref.toLowerCase() === "all";
  if (!all && !UUID_RE.test(ref)) throw new BcfInputError("remove_document: guid odkazu na dokument (bcf_topic_list s guid témy) alebo 'all'.");
  const n = await deps.store.removeDocuments(topicId, all ? null : ref.toLowerCase());
  if (!all && n === 0) throw new BcfInputError(`Odkaz ${ref} pri téme nie je.`);
  return n;
}

/**
 * Potvrdenie kontroly po novej revízii dokumentu (D-158 krok 6): zapíše revíziu, kto a kedy. Príznak sa tým
 * zruší len pre túto revíziu; ďalšia revízia dokumentu ho vráti. 'all' = všetky odkazy, ktoré kontrolu čakajú.
 */
async function reviewDocuments(deps: BcfDeps, topic: BcfTopicRow, ref: string, by: string): Promise<number> {
  const all = ref.toLowerCase() === "all";
  if (!all && !UUID_RE.test(ref)) throw new BcfInputError("review_document: guid odkazu na dokument (bcf_topic_list s guid témy) alebo 'all'.");
  const docs = await deps.store.documents([topic.id]);
  const picked = all ? docs : docs.filter((d) => d.id === ref.toLowerCase());
  if (!all && picked.length === 0) throw new BcfInputError(`Odkaz ${ref} pri téme nie je.`);
  const states = await reviewStates(deps, topic, picked);
  let n = 0;
  for (let i = 0; i < picked.length; i++) {
    if (!states[i].needs_review) continue;
    const now = picked[i].document_id ? await deps.store.findDocument(picked[i].document_id!) : null;
    await deps.store.updateDocument(topic.id, picked[i].id, {
      reviewed_revision: now?.revision ?? null,
      reviewed_sha256: now?.sha256 ?? null,
      reviewed_by: by,
      reviewed_at: deps.now().toISOString(),
    });
    n++;
  }
  if (!all && n === 0) throw new BcfInputError(`Odkaz ${ref} nečaká na kontrolu (revízia dokumentu sa nezmenila, kontrola je potvrdená alebo je téma vybavená).`);
  return n;
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
  // Lenivo: modul lokálnych tém viewera (D-158) importuje tento.
  bcf_topic_from_viewer: async (args, deps) => (await import("./viewer-topics")).fromViewer(args, deps),
  // Lenivo: návrh prvkov a pohľadu z oblasti strany (D-158 krok 4).
  bcf_topic_locate: async (args, deps) => (await import("./locate")).locate(args, deps),
  // Lenivo: import .bcfzip do DB (D-158 krok 8); parser BCF sa nenačíta pri iných akciách.
  bcf_topic_import: async (args, deps) => (await import("./import-tool")).importFromArgs(args, deps),
};

function bcfAction(raw: unknown): string {
  if (typeof raw === "string" && raw in BCF_ACTIONS) return BCF_ACTIONS[raw as keyof typeof BCF_ACTIONS];
  throw new BcfInputError(`action: ${Object.keys(BCF_ACTIONS).join(" | ")}.`);
}

export async function execBcfTool(
  name: string,
  args: Record<string, unknown>,
  deps: BcfDeps,
): Promise<{ text: string; isError: boolean }> {
  try {
    if (name === "bcf_topic_list") return { text: json(await list(args, deps)), isError: false };
    const write = name === "bcf_topic" ? WRITES[bcfAction(args.action)] : undefined;
    if (!write) return { text: `Neznámy tool: ${name}`, isError: true };
    const result = await write(args, deps);
    // Oznámenie je pohodlie: zlyhanie nemá zhodiť zápis, ktorý už prebehol.
    await deps.notify?.().catch(() => undefined);
    return { text: json(result), isError: false };
  } catch (err) {
    if (err instanceof BcfInputError || err instanceof ViewInputError || err instanceof TopicDocumentError) {
      return { text: err.message, isError: true };
    }
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
