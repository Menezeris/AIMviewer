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

const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_ITEMS = 10;

const PRIVACY =
  "Issue je VEREJNÉ (repo konektora je verejné): nepíš mená, telefóny ani e-maily osôb a firiem z modelu, " +
  "heslá ani tokeny. object_ref, IFC triedy, názvy psetov a tools sú v poriadku.";

export const FEEDBACK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "request_tool",
    description:
      "Zapíše POŽIADAVKU NA NOVÝ TOOL (GitHub issue) a hneď spustí Claude Code session, ktorá ho navrhne a " +
      "naprogramuje (D-090). Volaj, keď používateľ potrebuje niečo, čo žiadny tool nevie, AŽ PO vyčerpaní " +
      "existujúcich tools (query_view, search_everything, aggregate_objects, ifc_*...) - nie po prvom prázdnom " +
      "výsledku. Opíš potrebu, nie riešenie: čo chcel používateľ, čo si skúsil a prečo to nestačí. Rovnaká " +
      "požiadavka (rovnaký title alebo proposal.name) sa pripíše k otvorenému issue ako ďalší výskyt. " +
      PRIVACY,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: `Čo má nový tool vedieť, krátko (max ${MAX_TITLE} znakov).` },
        user_request: {
          type: "string",
          description: "Otázka alebo úloha používateľa, ideálne doslovne.",
        },
        why_existing_fail: {
          type: "string",
          description: "Prečo existujúce tools nestačia (čo chýba: dáta, filter, výpočet, akcia vo vieweri...).",
        },
        tried_tools: {
          type: "array",
          items: { type: "string" },
          description: "Skúšané volania a čo vrátili, napr. 'query_view v_space_elements: nemá stĺpec plochy'.",
        },
        proposal: {
          type: "object",
          description: "Voliteľný návrh toolu; session ho môže zmeniť.",
          properties: {
            name: { type: "string", description: "snake_case meno, napr. list_rooms_without_lighting" },
            description: { type: "string" },
            inputs: { type: "string", description: "Parametre a ich význam." },
            output: { type: "string", description: "Čo má vrátiť." },
          },
        },
        area: {
          type: "string",
          enum: [...AREAS],
          description:
            "Kde to asi patrí: aim_data (DB), viewer (3D), ifc_engine (ifc_*), model_change (úprava IFC), " +
            "requirements_library (knižnica požiadaviek), other.",
        },
        examples: {
          type: "array",
          items: { type: "string" },
          description: "Ďalšie otázky, ktoré by tool pokryl.",
        },
      },
      required: ["title", "user_request", "why_existing_fail"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "report_feedback",
    description:
      "Zapíše PRIPOMIENKU ku konektoru (GitHub issue, D-090): chyba toolu (bug), zlé alebo chýbajúce dáta " +
      "(wrong_data), zlá odpoveď alebo postup (wrong_answer), návrh na zlepšenie (improvement). Volaj, keď to " +
      "používateľ povie ('zapíš si to', 'toto je zle', 'pripomienka') alebo keď tool zjavne zlyhal. " +
      "start_session=true hneď spustí Claude Code session, ktorá to rieši - len keď to používateľ chce. " +
      "Opravu dát IFC modelu nezapisuj sem, to je úloha úpravy modelu (F13). " +
      PRIVACY,
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...FEEDBACK_KINDS], description: "Druh pripomienky." },
        title: { type: "string", description: `Jedna veta (max ${MAX_TITLE} znakov).` },
        description: { type: "string", description: "Čo je zle a čo by bolo správne." },
        tool: { type: "string", description: "Tool, ktorého sa to týka (ak nejaký)." },
        example: { type: "string", description: "Otázka alebo volanie (argumenty), na ktorom sa to ukázalo." },
        object_refs: {
          type: "array",
          items: { type: "string" },
          description: "object_ref prvkov, ktorých sa to týka.",
        },
        start_session: { type: "boolean", description: "Hneď spustiť session, ktorá to rieši (predvolene nie)." },
      },
      required: ["kind", "title", "description"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "feedback_status",
    description:
      "Stav pripomienok a požiadaviek na tools (D-090). Bez issue_number vráti otvorené issues konektora " +
      "(číslo, názov, druh, či beží session); s issue_number stav issue, odkaz na session, PR a posledné " +
      "komentáre (otázky session na používateľa). Použi pred request_tool, keď tušíš, že požiadavka už existuje.",
    inputSchema: {
      type: "object",
      properties: {
        issue_number: { type: "integer", description: "Číslo issue; bez neho zoznam otvorených." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

export const FEEDBACK_TOOL_NAMES = new Set(FEEDBACK_TOOL_DEFINITIONS.map((t) => t.name));

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
  "existujúcim toolom alebo postupom (potom stačí úprava inštrukcií), potom záznam D-0xx, pri nástroji " +
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
  if (proposal.name || proposal.description || proposal.inputs || proposal.output) {
    const rows = [
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
    start: true,
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
  const repo = `${client.target.owner}/${client.target.repo}`;

  let issue: GithubIssue;
  let duplicate = false;
  try {
    const open = await client.listOpenIssues(LABEL_MCP);
    const same = open.find((i) => parseMarker(i.body)?.fp === draft.fp);
    if (same) {
      duplicate = true;
      issue = same;
      await client.addComment(same.number, draft.repeat);
    } else {
      issue = await createWithLabels(client, draft);
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

  const hasSession = issue.labels.some((l) => l.name === LABEL_SESSION);
  let session: { url: string } | null = null;
  let sessionNote: string;
  if (!draft.start) {
    sessionNote = "Session sa nespúšťala (start_session nebolo zapnuté).";
  } else if (hasSession) {
    sessionNote = "Session pre toto issue už bola spustená - odkaz je v komentároch issue (feedback_status).";
  } else if (!deps.fire) {
    sessionNote =
      "Session sa nespustila: routine nie je nastavená na serveri (CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN). " +
      "Issue čaká; opakované zavolanie po nastavení session spustí.";
  } else {
    try {
      const fired = await deps.fire(firePayload(repo, issue, draft.kind, duplicate));
      session = { url: fired.sessionUrl };
      sessionNote = "Session beží; otázky položí v nej aj ako komentár v issue.";
      // Odkaz pri issue je pohodlie: zlyhanie nemá zhodiť výsledok, session už beží.
      await client
        .addComment(
          issue.number,
          `Claude session pre túto požiadavku: ${fired.sessionUrl}\n\n<!-- aim-mcp-session ${JSON.stringify({ url: fired.sessionUrl })} -->`,
        )
        .catch(() => undefined);
      await client.addLabels(issue.number, [LABEL_SESSION]).catch(() => undefined);
    } catch (err) {
      sessionNote = `Session sa nespustila: ${err instanceof Error ? err.message : String(err)}. Issue čaká.`;
    }
  }

  return {
    text: json({
      issue: { number: issue.number, url: issue.html_url, title: issue.title },
      duplicate,
      session,
      session_note: sessionNote,
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
    const open = await client.listOpenIssues(LABEL_MCP, 50);
    return {
      text: json({
        open: open.map((i) => ({
          number: i.number,
          title: i.title,
          kind: parseMarker(i.body)?.kind ?? null,
          session: i.labels.some((l) => l.name === LABEL_SESSION),
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
    switch (name) {
      case "request_tool":
        return await record(draftToolRequest(args, deps.now()), deps);
      case "report_feedback":
        return await record(draftFeedback(args, deps.now()), deps);
      case "feedback_status":
        return await status(args, deps);
      default:
        return { text: `Neznámy tool: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof FeedbackInputError) return { text: err.message, isError: true };
    return { text: `Chyba: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
