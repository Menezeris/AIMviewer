import "server-only";

import type { ToolDefinition } from "@/lib/llm/provider";
import { GithubClient, GithubError, parseRepo, type GithubIssue } from "../github/client";

import { fireRoutine, routineConfigured, type RoutineFireResult } from "./routine";

/**
 * Pripomienky a požiadavky na nové tools z MCP konektora (D-090), len v MCP.
 * Claude zapíše, čo mu chýba alebo čo nefunguje, ako GitHub issue v repe
 * konektora; požiadavka na nový tool (a pripomienka, keď o to používateľ
 * požiada) hneď spustí Claude Code session cez routine, ktorá issue rieši.
 * Issue je jediný záznam: žiadna tabuľka v DB, stav sa číta z GitHubu.
 */

/** Štítky; GitHub chýbajúci štítok pri zakladaní issue sám vytvorí. */
export const LABEL_MCP = "mcp";
export const LABEL_TOOL = "novy-tool";
export const LABEL_FEEDBACK = "pripomienka";
export const LABEL_SESSION = "session";
/** Čaká na voľné miesto (strop súbežných sessions). */
export const LABEL_QUEUE = "fronta";

export const AREAS = ["aim_data", "viewer", "ifc_engine", "model_change", "requirements_library", "other"] as const;
export const FEEDBACK_KINDS = ["bug", "wrong_data", "wrong_answer", "improvement"] as const;
type Area = (typeof AREAS)[number];
type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "bug",
  wrong_data: "data",
  wrong_answer: "odpoved",
  improvement: "enhancement",
};
const KIND_TEXT: Record<FeedbackKind, string> = {
  bug: "Chyba toolu",
  wrong_data: "Zlé alebo chýbajúce dáta",
  wrong_answer: "Zlá odpoveď alebo postup",
  improvement: "Návrh na zlepšenie",
};
const AREA_TEXT: Record<Area, string> = {
  aim_data: "dáta AIM v DB (tools nad grafom, RPC, views)",
  viewer: "3D viewer (fork ifc-lite, bridge, D-087)",
  ifc_engine: "IFC motor (tools ifc_*, D-084)",
  model_change: "úpravy IFC modelu (F13, D-086)",
  requirements_library: "knižnica požiadaviek (assetin-library, IDS)",
  other: "neurčené",
};

export const COMMENT_KINDS = ["eval_round", "result", "note"] as const;
type CommentKind = (typeof COMMENT_KINDS)[number];
const COMMENT_TEXT: Record<CommentKind, string> = {
  eval_round: "Kolo evalov",
  result: "Výsledok",
  note: "Poznámka",
};

const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_ITEMS = 10;
/** Kolo evalov s tabuľkou pred / po je dlhšie než pripomienka (GitHub berie do 65 536). */
const MAX_COMMENT = 16000;

const PRIVACY =
  "Issue je VEREJNÉ (repo konektora je verejné): nepíš mená, telefóny ani e-maily osôb a firiem z modelu, " +
  "heslá ani tokeny. object_ref, IFC triedy, názvy psetov a tools sú v poriadku.";

/** `feedback` action -> handler (D-115); staré mená sú to isté pod vlastným menom. */
export const FEEDBACK_ACTIONS = {
  report: "report_feedback",
  request_tool: "request_tool",
  comment: "feedback_comment",
  start_session: "start_queued_session",
} as const;

export const FEEDBACK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "feedback_status",
    description:
      "Stav pripomienok a požiadaviek na tools (D-090). Bez issue_number vráti otvorené issues konektora " +
      "(číslo, názov, druh, či beží session); s issue_number stav issue, odkaz na session, PR a posledné " +
      "komentáre (otázky session na používateľa). Zoznam ukáže aj sessions: koľko beží z koľkých a čo je vo " +
      "fronte. Použi pred feedback(action=request_tool), keď tušíš, že požiadavka už existuje.",
    inputSchema: {
      type: "object",
      properties: {
        issue_number: { type: "integer", description: "Číslo issue; bez neho zoznam otvorených." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "feedback",
    description:
      "Zápis do GitHub issues konektora (D-090). Volaj LEN na výslovný pokyn používateľa ('zapíš to', 'založ " +
      "pripomienku', 'dopíš do #97'); sám to len ponúkni. action=report: PRIPOMIENKA - chyba toolu (bug), zlé " +
      "dáta (wrong_data), zlá odpoveď (wrong_answer), návrh (improvement); kind, title, description, " +
      "start_session len keď to používateľ chce. request_tool: POŽIADAVKA NA NOVÝ TOOL až po vyčerpaní existujúcich " +
      "tools; opíš potrebu (user_request, why_existing_fail, tried_tools s konkrétnymi tools); ak stačí rozšíriť " +
      "existujúci tool (parameter, akcia, pole vo výsledku), uveď ho v proposal.extend - rozšírenie má prednosť " +
      "(D-114); spustí session alebo ide do fronty, rovnaká požiadavka sa pripíše ako ďalší výskyt. comment: " +
      "komentár do existujúceho issue (issue_number, text, kind eval_round | result | note; reopen len na " +
      "výslovný pokyn). start_session: spustí session pre ďalšie issue z fronty (over_limit len na výslovnú " +
      "žiadosť). Chyba v IFC modeli sem nepatrí, to je BCF téma (bcf_topic). " +
      PRIVACY,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: Object.keys(FEEDBACK_ACTIONS) },
        kind: {
          type: "string",
          enum: [...FEEDBACK_KINDS, ...COMMENT_KINDS],
          description: "report: bug | wrong_data | wrong_answer | improvement; comment: eval_round | result | note",
        },
        title: { type: "string", description: `report, request_tool: jedna veta (max ${MAX_TITLE} znakov)` },
        description: { type: "string", description: "report: čo je zle a čo by bolo správne" },
        tool: { type: "string", description: "report: tool, ktorého sa to týka" },
        example: { type: "string", description: "report: otázka alebo volanie, na ktorom sa to ukázalo" },
        object_refs: { type: "array", items: { type: "string" }, description: "report: object_ref dotknutých prvkov" },
        user_request: { type: "string", description: "request_tool: otázka používateľa, ideálne doslovne" },
        why_existing_fail: {
          type: "string",
          description: "request_tool: prečo existujúce tools nestačia (dáta, filter, výpočet, akcia vo vieweri...)",
        },
        tried_tools: {
          type: "array",
          items: { type: "string" },
          description: "request_tool: skúšané volania (tool a parametre) a čo vrátili",
        },
        proposal: {
          type: "object",
          description: "request_tool: voliteľný návrh; session ho môže zmeniť",
          properties: {
            extend: { type: "string", description: "Existujúci tool na rozšírenie a ako, napr. 'get_object: include=qto'" },
            name: { type: "string", description: "snake_case meno nového toolu" },
            description: { type: "string" },
            inputs: { type: "string" },
            output: { type: "string" },
          },
        },
        area: {
          type: "string",
          enum: [...AREAS],
          description: "request_tool: aim_data | viewer | ifc_engine | model_change | requirements_library | other",
        },
        examples: { type: "array", items: { type: "string" }, description: "request_tool: ďalšie otázky, ktoré by tool pokryl" },
        issue_number: { type: "integer", description: "comment: číslo issue; start_session: konkrétne issue z fronty" },
        text: { type: "string", description: `comment: text v markdown (max ${MAX_COMMENT} znakov)` },
        reopen: { type: "boolean", description: "comment: znovu otvoriť zatvorené issue (len na výslovný pokyn)" },
        over_limit: { type: "boolean", description: "start_session: aj nad strop 3 sessions (len na výslovnú žiadosť)" },
        start_session: { type: "boolean", description: "report: hneď spustiť session; request_tool: false = len zapísať" },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

/** Staré mená zápisových tools (D-115): nevypisujú sa, ale vykonajú sa. */
export const LEGACY_FEEDBACK_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(FEEDBACK_ACTIONS));

export const FEEDBACK_TOOL_NAMES = new Set([...FEEDBACK_TOOL_DEFINITIONS.map((t) => t.name), ...LEGACY_FEEDBACK_TOOL_NAMES]);

export interface FeedbackDeps {
  client: GithubClient | null;
  /** Spustí session; `null` = routine nie je nastavená. */
  fire: ((text: string) => Promise<RoutineFireResult>) | null;
  now: () => Date;
  /** Tajomstvá, ktoré sa do verejného issue nesmú dostať. */
  secrets: string[];
}

export function defaultFeedbackDeps(): FeedbackDeps {
  const token = process.env.FEEDBACK_GITHUB_TOKEN?.trim();
  return {
    client: token ? new GithubClient(token, parseRepo(process.env.FEEDBACK_REPO)) : null,
    fire: routineConfigured() ? (text) => fireRoutine(text) : null,
    now: () => new Date(),
    secrets: [
      process.env.MCP_TOKEN,
      process.env.MCP_WRITE_TOKEN,
      process.env.LIVE_CHANNEL,
      process.env.FEEDBACK_GITHUB_TOKEN,
      process.env.CLAUDE_ROUTINE_TOKEN,
    ].filter((s): s is string => Boolean(s && s.trim().length >= 6)),
  };
}

export class FeedbackInputError extends Error {}

const str = (v: unknown, max: number, field: string, required = false): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new FeedbackInputError(`Chýba ${field}.`);
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
};

const list = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, MAX_ITEMS)
        .map((x) => str(x, max, "položka"))
    : [];

/** Bez diakritiky, malé písmená, len [a-z0-9-] - kľúč na zhodu opakovanej požiadavky. */
export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Skrytá značka v tele issue: druh a odtlačok (zhoda opakovanej požiadavky). */
const MARKER_RE = /<!-- aim-mcp (\{[^}]*\}) -->/;
const SESSION_RE = /<!-- aim-mcp-session (\{[^}]*\}) -->/;

export interface IssueMarker {
  v: 1;
  kind: "tool" | "feedback";
  fp: string;
}

export function marker(m: IssueMarker): string {
  return `<!-- aim-mcp ${JSON.stringify(m)} -->`;
}

export function parseMarker(body: string | null | undefined): IssueMarker | null {
  const m = body ? MARKER_RE.exec(body) : null;
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as IssueMarker;
    return typeof parsed.fp === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseSessionUrl(body: string): string | null {
  const m = SESSION_RE.exec(body);
  if (!m) return null;
  try {
    const url = (JSON.parse(m[1]) as { url?: unknown }).url;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[skryté]");
  return out;
}

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

interface Draft {
  kind: "tool" | "feedback";
  fp: string;
  title: string;
  labels: string[];
  body: string;
  /** Text komentára, keď už rovnaké issue existuje. */
  repeat: string;
  /** Spustiť session hneď. */
  start: boolean;
}

const SESSION_NOTE =
  "## Pre session, ktorá to rieši\n" +
  "Postup je v skille `.claude/skills/mcp-poziadavka/SKILL.md` (D-090): najprv over, či to nejde " +
  "existujúcim toolom alebo postupom (potom stačí úprava inštrukcií); ak nie, skús rozšíriť existujúci " +
  "tool z inventára `MCP-TOOLS.md` (parameter, akcia, pole vo výsledku) - nový tool až keď to nejde " +
  "(D-114). Potom záznam D-0xx, pri nástroji " +
  "viewera alebo motora pravidlo D-087. Otázky na Samuela patria do session a sem ako komentár. Výsledok je " +
  "PR s `Closes #<číslo>`, nikdy merge.";

export function draftToolRequest(args: Record<string, unknown>, now: Date): Draft {
  const title = str(args.title, MAX_TITLE, "title", true);
  const userRequest = str(args.user_request, MAX_TEXT, "user_request", true);
  const why = str(args.why_existing_fail, MAX_TEXT, "why_existing_fail", true);
  const tried = list(args.tried_tools, 500);
  const examples = list(args.examples, 500);
  const area: Area = (AREAS as readonly string[]).includes(args.area as string) ? (args.area as Area) : "other";
  const p = typeof args.proposal === "object" && args.proposal !== null ? (args.proposal as Record<string, unknown>) : {};
  const proposal = {
    extend: str(p.extend, MAX_TEXT, "proposal.extend"),
    name: slug(str(p.name, 80, "proposal.name")).replace(/-/g, "_"),
    description: str(p.description, MAX_TEXT, "proposal.description"),
    inputs: str(p.inputs, MAX_TEXT, "proposal.inputs"),
    output: str(p.output, MAX_TEXT, "proposal.output"),
  };
  const fp = `tool:${proposal.name ? slug(proposal.name) : slug(title)}`;

  const parts = [
    `> Zapísal Claude cez MCP konektor AIM (\`request_tool\`, D-090), ${stamp(now)}. Oblasť: **${area}** (${AREA_TEXT[area]}).`,
    `## Čo používateľ potreboval\n${userRequest}`,
    `## Prečo existujúce tools nestačia\n${why}`,
  ];
  if (tried.length) parts.push(`### Skúšané tools\n${bullets(tried)}`);
  if (proposal.extend || proposal.name || proposal.description || proposal.inputs || proposal.output) {
    const rows = [
      proposal.extend && `- **Rozšíriť existujúci:** ${proposal.extend}`,
      proposal.name && `- **Meno:** \`${proposal.name}\``,
      proposal.description && `- **Čo robí:** ${proposal.description}`,
      proposal.inputs && `- **Vstupy:** ${proposal.inputs}`,
      proposal.output && `- **Výstup:** ${proposal.output}`,
    ].filter(Boolean);
    parts.push(`## Návrh toolu (od Claude v konverzácii, nie záväzný)\n${rows.join("\n")}`);
  }
  if (examples.length) parts.push(`## Ďalšie otázky, ktoré by tool pokryl\n${bullets(examples)}`);
  parts.push(SESSION_NOTE, marker({ v: 1, kind: "tool", fp }));

  return {
    kind: "tool",
    fp,
    title: `Nový tool: ${title}`,
    labels: [LABEL_MCP, LABEL_TOOL, `oblast:${area}`],
    body: parts.join("\n\n"),
    repeat: [
      `**Ďalší výskyt** (${stamp(now)}, \`request_tool\`)`,
      `**Používateľ:** ${userRequest}`,
      `**Prečo nestačí:** ${why}`,
      tried.length ? `**Skúšané:**\n${bullets(tried)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    start: args.start_session !== false,
  };
}

export function draftFeedback(args: Record<string, unknown>, now: Date): Draft {
  const kind = args.kind as FeedbackKind;
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    throw new FeedbackInputError(`kind musí byť jedno z: ${FEEDBACK_KINDS.join(", ")}.`);
  }
  const title = str(args.title, MAX_TITLE, "title", true);
  const description = str(args.description, MAX_TEXT, "description", true);
  const tool = str(args.tool, 80, "tool");
  const example = str(args.example, MAX_TEXT, "example");
  const refs = list(args.object_refs, 80);
  const fp = `feedback:${kind}:${slug(title)}`;

  const parts = [
    `> Zapísal Claude cez MCP konektor AIM (\`report_feedback\`, D-090), ${stamp(now)}. Druh: **${KIND_TEXT[kind]}**${tool ? `, tool \`${tool}\`` : ""}.`,
    `## Čo je zle\n${description}`,
  ];
  if (example) parts.push(`## Príklad\n${example}`);
  if (refs.length) parts.push(`## Prvky\n${refs.map((r) => `\`${r}\``).join(", ")}`);
  parts.push(SESSION_NOTE, marker({ v: 1, kind: "feedback", fp }));

  return {
    kind: "feedback",
    fp,
    title: `${KIND_TEXT[kind]}: ${title}`,
    labels: [LABEL_MCP, LABEL_FEEDBACK, KIND_LABEL[kind]],
    body: parts.join("\n\n"),
    repeat: [`**Ďalší výskyt** (${stamp(now)}, \`report_feedback\`)`, description, example && `**Príklad:** ${example}`]
      .filter(Boolean)
      .join("\n\n"),
    start: args.start_session === true,
  };
}

/** Text pre `<routine-fire-payload>`; session si podrobnosti prečíta z issue. */
export function firePayload(repo: string, issue: GithubIssue, kind: Draft["kind"], repeated: boolean): string {
  return [
    "Požiadavka z MCP konektora AIM (D-090).",
    `repo: ${repo}`,
    `issue: ${issue.number}`,
    `url: ${issue.html_url}`,
    `druh: ${kind === "tool" ? "novy-tool" : "pripomienka"}`,
    `nazov: ${issue.title}`,
    `opakovanie: ${repeated ? "ano" : "nie"}`,
  ].join("\n");
}

const json = (v: unknown) => JSON.stringify(v, null, 1);

const MAX_OTHERS = 15;

/** Strop súbežných sessions (env `FEEDBACK_MAX_SESSIONS`, predvolene 3). */
export function maxSessions(): number {
  const n = Number.parseInt(process.env.FEEDBACK_MAX_SESSIONS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Session bez pohybu v issue dlhšie než toto sa do stropu nepočíta (spadla alebo zabudnutá). */
export const STALE_HOURS = 24;

/** Bežiace sessions = otvorené issues so štítkom `session`, ktoré sa hýbali v posledných STALE_HOURS. */
export function runningSessions(open: GithubIssue[], now: Date): { running: GithubIssue[]; stale: GithubIssue[] } {
  const withSession = open.filter((i) => hasLabel(i, LABEL_SESSION));
  const limit = now.getTime() - STALE_HOURS * 3600_000;
  const fresh = (i: GithubIssue) => {
    const t = Date.parse(i.updated_at);
    return Number.isNaN(t) || t >= limit;
  };
  return { running: withSession.filter(fresh), stale: withSession.filter((i) => !fresh(i)) };
}

/** Fronta = otvorené issues so štítkom `fronta` bez session, najstaršie prvé. */
export function queuedIssues(open: GithubIssue[]): GithubIssue[] {
  return open
    .filter((i) => hasLabel(i, LABEL_QUEUE) && !hasLabel(i, LABEL_SESSION))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Spustí session k issue a zapíše odkaz; štítok `fronta` sa vymení za `session`. */
async function startSession(
  client: GithubClient,
  fire: NonNullable<FeedbackDeps["fire"]>,
  issue: GithubIssue,
  kind: Draft["kind"],
  repeated: boolean,
): Promise<{ url: string }> {
  const repo = `${client.target.owner}/${client.target.repo}`;
  const fired = await fire(firePayload(repo, issue, kind, repeated));
  // Odkaz a štítky pri issue sú pohodlie: zlyhanie nemá zhodiť výsledok, session už beží.
  await client
    .addComment(
      issue.number,
      `Claude session pre túto požiadavku: ${fired.sessionUrl}\n\n<!-- aim-mcp-session ${JSON.stringify({ url: fired.sessionUrl })} -->`,
    )
    .catch(() => undefined);
  await client.addLabels(issue.number, [LABEL_SESSION]).catch(() => undefined);
  if (hasLabel(issue, LABEL_QUEUE)) await client.removeLabel(issue.number, LABEL_QUEUE).catch(() => undefined);
  return { url: fired.sessionUrl };
}

const queueText = (running: GithubIssue[], max: number) =>
  `Bežia ${running.length} z ${max} sessions (${running.map((i) => `#${i.number}`).join(", ")}).`;

const hasLabel = (i: GithubIssue, name: string) => i.labels.some((l) => l.name === name);

/**
 * Otvorené požiadavky v čase zápisu idú do tela nového issue: session, ktorá
 * ho rieši, z nich vidí možné prekrytie so súbežnou prácou (koordinácia, D-090).
 */
export function withOthers(body: string, others: GithubIssue[]): string {
  if (others.length === 0) return body;
  const rows = others.map((i) => `- #${i.number} ${i.title}${hasLabel(i, LABEL_SESSION) ? " (session beží)" : ""}`);
  const section = `## Otvorené požiadavky v čase zápisu\nSkontroluj prekrytie pred plánom (skill, krok Koordinácia).\n${rows.join("\n")}`;
  const at = body.indexOf("<!-- aim-mcp ");
  return at < 0 ? `${body}\n\n${section}` : `${body.slice(0, at)}${section}\n\n${body.slice(at)}`;
}

async function createWithLabels(client: GithubClient, d: Draft): Promise<GithubIssue> {
  try {
    return await client.createIssue({ title: d.title, body: d.body, labels: d.labels });
  } catch (err) {
    // 422 = štítok sa nedá použiť (práva tokenu); issue je dôležitejšie než štítky.
    if (err instanceof GithubError && err.status === 422) {
      return client.createIssue({ title: d.title, body: d.body, labels: [] });
    }
    throw err;
  }
}

async function record(d: Draft, deps: FeedbackDeps): Promise<{ text: string; isError: boolean }> {
  const draft = { ...d, body: redact(d.body, deps.secrets), repeat: redact(d.repeat, deps.secrets) };
  if (!deps.client) {
    return {
      text: json({
        error:
          "Zápis do GitHubu nie je nastavený (chýba FEEDBACK_GITHUB_TOKEN na serveri). Nič sa neuložilo - " +
          "ukáž používateľovi koncept nižšie, nech ho založí ručne alebo doplní token.",
        draft: { title: draft.title, labels: draft.labels, body: draft.body },
      }),
      isError: true,
    };
  }
  const client = deps.client;

  let issue: GithubIssue;
  let duplicate = false;
  let others: GithubIssue[] = [];
  let open: GithubIssue[] = [];
  try {
    open = await client.listOpenIssues(LABEL_MCP);
    const same = open.find((i) => parseMarker(i.body)?.fp === draft.fp);
    others = open.filter((i) => i.number !== same?.number).slice(0, MAX_OTHERS);
    if (same) {
      duplicate = true;
      issue = same;
      await client.addComment(same.number, draft.repeat);
    } else {
      issue = await createWithLabels(client, { ...draft, body: withOthers(draft.body, others) });
    }
  } catch (err) {
    return {
      text: json({
        error: `GitHub zápis zlyhal: ${err instanceof Error ? err.message : String(err)}. Nič sa neuložilo.`,
        draft: { title: draft.title, labels: draft.labels, body: draft.body },
      }),
      isError: true,
    };
  }

  const hasSession = hasLabel(issue, LABEL_SESSION);
  const max = maxSessions();
  const { running } = runningSessions(open, deps.now());
  let session: { url: string } | null = null;
  let queued = false;
  let sessionNote: string;
  if (!draft.start) {
    sessionNote = "Session sa nespúšťala (start_session nebolo zapnuté).";
  } else if (hasSession) {
    sessionNote = "Session pre toto issue už bola spustená - odkaz je v komentároch issue (feedback_status).";
  } else if (!deps.fire) {
    sessionNote =
      "Session sa nespustila: routine nie je nastavená na serveri (CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN). " +
      "Issue čaká; opakované zavolanie po nastavení session spustí.";
  } else if (running.length >= max) {
    queued = true;
    if (!hasLabel(issue, LABEL_QUEUE)) await client.addLabels(issue.number, [LABEL_QUEUE]).catch(() => undefined);
    const position = queuedIssues(open).filter((i) => i.number !== issue.number).length + 1;
    sessionNote =
      `Issue je vo fronte (pozícia ${position}). ${queueText(running, max)} ` +
      "Keď niektorá skončí, Samuel dostane notifikáciu; ďalšiu spustí feedback(action=start_session).";
  } else {
    try {
      session = await startSession(client, deps.fire, issue, draft.kind, duplicate);
      sessionNote = "Session beží; otázky položí v nej aj ako komentár v issue.";
    } catch (err) {
      sessionNote = `Session sa nespustila: ${err instanceof Error ? err.message : String(err)}. Issue čaká.`;
    }
  }

  return {
    text: json({
      issue: { number: issue.number, url: issue.html_url, title: issue.title },
      duplicate,
      session,
      queued,
      session_note: sessionNote,
      // Súbežné požiadavky: Claude ich vie spomenúť, session ich má v tele issue.
      other_open: others.map((i) => ({ number: i.number, title: i.title, session: hasLabel(i, LABEL_SESSION) })),
    }),
    isError: false,
  };
}

async function startQueued(
  args: Record<string, unknown>,
  deps: FeedbackDeps,
): Promise<{ text: string; isError: boolean }> {
  if (!deps.client) {
    return { text: "Zápis do GitHubu nie je nastavený (chýba FEEDBACK_GITHUB_TOKEN na serveri).", isError: true };
  }
  if (!deps.fire) {
    return {
      text: "Routine nie je nastavená na serveri (CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN), session sa nedá spustiť.",
      isError: true,
    };
  }
  const client = deps.client;
  const open = await client.listOpenIssues(LABEL_MCP);
  const max = maxSessions();
  const { running, stale } = runningSessions(open, deps.now());
  const queue = queuedIssues(open);
  const wanted = typeof args.issue_number === "number" ? Math.trunc(args.issue_number) : null;
  const target = wanted === null ? queue[0] : open.find((i) => i.number === wanted);
  if (!target) {
    return {
      text: json({
        started: null,
        note: wanted === null ? "Fronta je prázdna." : `Issue #${wanted} nie je otvorené issue konektora (štítok mcp).`,
        running: running.map((i) => ({ number: i.number, title: i.title })),
      }),
      isError: wanted !== null,
    };
  }
  if (hasLabel(target, LABEL_SESSION)) {
    return { text: `Pre #${target.number} už session beží (feedback_status ukáže odkaz).`, isError: true };
  }
  if (running.length >= max && args.over_limit !== true) {
    return {
      text: json({
        started: null,
        note:
          `${queueText(running, max)} Miesto nie je voľné. Spusti po skončení niektorej, alebo s over_limit=true ` +
          "len keď to používateľ výslovne chce.",
        running: running.map((i) => ({ number: i.number, title: i.title, updated_at: i.updated_at })),
        stale: stale.map((i) => ({ number: i.number, title: i.title, updated_at: i.updated_at })),
        queue: queue.map((i) => ({ number: i.number, title: i.title })),
      }),
      isError: false,
    };
  }
  const kind = parseMarker(target.body)?.kind ?? "tool";
  const session = await startSession(client, deps.fire, target, kind, false);
  return {
    text: json({
      started: { number: target.number, title: target.title, url: target.html_url },
      session,
      running_after: running.length + 1,
      max,
      queue_left: queue.filter((i) => i.number !== target.number).map((i) => ({ number: i.number, title: i.title })),
    }),
    isError: false,
  };
}

/** Skrytá značka komentára dopísaného cez `feedback_comment`. */
const COMMENT_RE = /<!-- aim-mcp-comment (\{[^}]*\}) -->/;

export function parseCommentKind(body: string): CommentKind | null {
  const m = COMMENT_RE.exec(body);
  if (!m) return null;
  try {
    const kind = (JSON.parse(m[1]) as { kind?: unknown }).kind;
    return (COMMENT_KINDS as readonly string[]).includes(kind as string) ? (kind as CommentKind) : null;
  } catch {
    return null;
  }
}

export function draftComment(args: Record<string, unknown>, now: Date): { number: number; body: string } {
  const number = typeof args.issue_number === "number" ? Math.trunc(args.issue_number) : NaN;
  if (!(number >= 1)) throw new FeedbackInputError("Chýba issue_number (kladné číslo).");
  const text = str(args.text, MAX_COMMENT, "text", true);
  if (args.kind !== undefined && !(COMMENT_KINDS as readonly string[]).includes(args.kind as string)) {
    throw new FeedbackInputError(`kind musí byť jedno z: ${COMMENT_KINDS.join(", ")}.`);
  }
  const kind = (args.kind as CommentKind | undefined) ?? "note";
  return {
    number,
    body: [
      `**${COMMENT_TEXT[kind]}** (${stamp(now)}, \`feedback_comment\`)`,
      text,
      `<!-- aim-mcp-comment ${JSON.stringify({ v: 1, kind })} -->`,
    ].join("\n\n"),
  };
}

/**
 * Komentár do issue konektora (otvoreného aj zatvoreného); issue a PR mimo štítku `mcp` odmietne.
 * `reopen=true` zatvorené issue najprv znovu otvorí, aby sa komentár nezapísal bez neho.
 */
async function comment(args: Record<string, unknown>, deps: FeedbackDeps): Promise<{ text: string; isError: boolean }> {
  const d = draftComment(args, deps.now());
  const body = redact(d.body, deps.secrets);
  if (!deps.client) {
    return {
      text: json({
        error: "Zápis do GitHubu nie je nastavený (chýba FEEDBACK_GITHUB_TOKEN na serveri). Nič sa neuložilo.",
        draft: { issue_number: d.number, body },
      }),
      isError: true,
    };
  }
  const client = deps.client;
  const issue = await client.getIssue(d.number);
  if (issue.pull_request || !hasLabel(issue, LABEL_MCP)) {
    return { text: `#${d.number} nie je issue konektora (štítok ${LABEL_MCP}), komentár sa nezapísal.`, isError: true };
  }
  const reopened = args.reopen === true && issue.state !== "open";
  if (reopened) await client.reopenIssue(d.number);
  const c = await client.addComment(d.number, body);
  return {
    text: json({
      issue: { number: issue.number, url: issue.html_url, title: issue.title, state: reopened ? "open" : issue.state },
      comment: { id: c.id, url: c.html_url },
      reopened,
    }),
    isError: false,
  };
}

const excerpt = (s: string, n = 500) => {
  const clean = s.replace(/<!--[\s\S]*?-->/g, "").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}...` : clean;
};

async function status(args: Record<string, unknown>, deps: FeedbackDeps): Promise<{ text: string; isError: boolean }> {
  if (!deps.client) {
    return { text: "Čítanie z GitHubu nie je nastavené (chýba FEEDBACK_GITHUB_TOKEN na serveri).", isError: true };
  }
  const client = deps.client;
  const n = typeof args.issue_number === "number" ? Math.trunc(args.issue_number) : null;
  if (n === null) {
    const open = await client.listOpenIssues(LABEL_MCP);
    const { running, stale } = runningSessions(open, deps.now());
    return {
      text: json({
        sessions: {
          running: running.map((i) => i.number),
          max: maxSessions(),
          stale: stale.map((i) => i.number),
          queue: queuedIssues(open).map((i) => i.number),
        },
        open: open.map((i) => ({
          number: i.number,
          title: i.title,
          kind: parseMarker(i.body)?.kind ?? null,
          session: hasLabel(i, LABEL_SESSION),
          queued: hasLabel(i, LABEL_QUEUE),
          labels: i.labels.map((l) => l.name),
          updated_at: i.updated_at,
          url: i.html_url,
        })),
      }),
      isError: false,
    };
  }
  if (n < 1) throw new FeedbackInputError("issue_number musí byť kladné číslo.");
  const [issue, comments, prs] = await Promise.all([
    client.getIssue(n),
    client.listComments(n),
    client.linkedPullRequests(n).catch(() => []),
  ]);
  const sessionUrl = comments.map((c) => parseSessionUrl(c.body)).find(Boolean) ?? null;
  return {
    text: json({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      state_reason: issue.state_reason ?? null,
      labels: issue.labels.map((l) => l.name),
      url: issue.html_url,
      session_url: sessionUrl,
      pull_requests: prs,
      comments_total: comments.length,
      last_comments: comments.slice(-3).map((c) => ({
        author: c.user?.login ?? null,
        at: c.created_at,
        // Dopísané cez feedback_comment (kolo evalov, výsledok, poznámka).
        via_connector: parseCommentKind(c.body),
        text: excerpt(c.body),
      })),
    }),
    isError: false,
  };
}

export async function execFeedbackTool(
  name: string,
  args: Record<string, unknown>,
  deps: FeedbackDeps = defaultFeedbackDeps(),
): Promise<{ text: string; isError: boolean }> {
  try {
    if (name === "feedback") {
      const action = typeof args.action === "string" ? args.action : "";
      if (!(action in FEEDBACK_ACTIONS)) throw new FeedbackInputError(`action: ${Object.keys(FEEDBACK_ACTIONS).join(" | ")}.`);
      name = FEEDBACK_ACTIONS[action as keyof typeof FEEDBACK_ACTIONS];
    }
    switch (name) {
      case "request_tool":
        return await record(draftToolRequest(args, deps.now()), deps);
      case "report_feedback":
        return await record(draftFeedback(args, deps.now()), deps);
      case "feedback_status":
        return await status(args, deps);
      case "feedback_comment":
        return await comment(args, deps);
      case "start_queued_session":
        return await startQueued(args, deps);
      default:
        return { text: `Neznámy tool: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof FeedbackInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
