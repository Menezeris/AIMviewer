import { randomUUID, timingSafeEqual } from "node:crypto";

import { NextResponse, after } from "next/server";

import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { BCF_TOOL_NAMES, execBcfTool } from "@/lib/bcf/tools";
import { SEARCH_ALL_TOOL } from "@/lib/engine/search-all";
import { ENGINE_TOOL_NAMES } from "@/lib/engine/tool-defs";
import { CALIBRATE_UNDERLAY_TOOL } from "@/lib/engine/underlay-tool-def";
import { FEEDBACK_TOOL_NAMES, execFeedbackTool } from "@/lib/feedback/tools";
import { broadcastLive, isTestChannel, liveChannel } from "@/lib/live/broadcast";
import { currentCaller, withCaller } from "@/lib/live/caller";
import { readBackSection } from "@/lib/live/section-readback";
import {
  TEST_CHANNEL_NO_VIEWER,
  VIEWER_QUERY_TOOL_NAMES,
  execViewerQueryTool,
} from "@/lib/live/viewer-query-tools";
import { lensCountsText } from "@/lib/live/lens-counts";
import { ACK_TIMEOUT_MS, appliedText, notAppliedText } from "@/lib/live/applied-text";
import { expectApplied, recentViewerCount } from "@/lib/live/warm-channel";
import type { AskAction } from "@/lib/llm/actions";
import { AskToolRuntime } from "@/lib/llm/tools";
import { callAction, engineUseQuery, rejectedCallRow, writeCallLog } from "@/lib/mcp/call-log";
import { ENGINE_WANT_WINDOW_MS, engineUsedSince, engineWarmDecision, isEngineTool, payloadToolNames, type EngineWarmState } from "@/lib/mcp/engine-warm";
import { mcpServerInstructions } from "@/lib/mcp/tool-loading";
import { mcpToolDefinitions, mcpToolGroups } from "@/lib/mcp/tool-list";
import { defaultSavedViewDeps } from "@/lib/views/runtime";
import { SAVED_VIEW_TOOL_NAMES, execSavedViewTool } from "@/lib/views/tools";
import {
  handleMcpPayload,
  parseErrorResponse,
  payloadMethods,
  type McpServerDeps,
  type McpToolResult,
} from "@/lib/mcp/server";
import { callerLabel, mcpCaller } from "@/lib/mcp/session-id";
import { startTimer, type CallTimer } from "@/lib/mcp/timing";

/**
 * MCP konektor pre Claude (D-079): `POST /api/mcp/<MCP_TOKEN>`. Tie isté
 * read-only tools ako `/api/ask`; UI akcie sa odvysielajú do živého viewera
 * (Supabase Realtime, kanál `LIVE_CHANNEL`); get_viewer_state (stav aj obálky) sa
 * tým istým kanálom viewera pýtajú (D-085); pripomienky a požiadavky na nové
 * tools idú do GitHub issues a spúšťajú Claude session (D-090); BCF témy nad modelmi sú v DB
 * a téma pre Claude spúšťa session (D-099). Bez `MCP_TOKEN` je endpoint
 * vypnutý (404). Bezstavový — žiadne session ID, žiadny SSE stream.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
/** Dlhší záložný odkaz sa do odpovede nevypisuje. */
const MAX_LINK = 2000;
/** Okná viewera, ktoré odpovedali za toto obdobie, sa rátajú do varovania o viacerých oknách (D-125). */
const VIEWERS_WINDOW_MS = 60_000;

function tokenMatches(given: string): boolean {
  const expected = process.env.MCP_TOKEN?.trim();
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "https://ai-mviewer.vercel.app";
}

/** Diagnostika IFC motora (D-084 fáza 0) - len keď je zapnutá env bránou. */
const ENGINE_SPIKE = process.env.ENGINE_SPIKE === "1";
/** `ifc_*` tools IFC motora (D-084 fáza 1) - env brána; diagnostika ich zapína tiež. */
const ENGINE_ENABLED = process.env.ENGINE_ENABLED === "1" || ENGINE_SPIKE;

/** Prvé volanie v tejto inštancii funkcie = studený štart (D-100). */
let instanceWarm = false;
/** Zahriatie motora v tejto inštancii (D-101, D-135): predčítané / kedy sa overovalo použitie. */
let engineWarm: EngineWarmState = { preloaded: false, checkedAt: null };

const ENGINE_TOOLS_LOGGED = [...ENGINE_TOOL_NAMES, SEARCH_ALL_TOOL.name, CALIBRATE_UNDERLAY_TOOL.name];

async function preloadEngine(): Promise<void> {
  const [{ preloadEngineModels }] = await Promise.all([import("@/lib/engine/preload"), import("@/lib/engine/run")]);
  await preloadEngineModels();
}

/** Zahriatie motora podľa D-135 (`lib/mcp/engine-warm.ts`); beží v `after()`, odpoveď nečaká. */
function warmEngine(payload: unknown): void {
  const methods = payloadMethods(payload);
  const req = {
    engineCall: payloadToolNames(payload).some((n) => isEngineTool(n, ENGINE_TOOL_NAMES)),
    connect: methods.some((m) => m === "initialize" || m === "tools/list"),
  };
  const { decision, state } = engineWarmDecision(engineWarm, Date.now(), req);
  engineWarm = state;
  if (decision === "preload") after(preloadEngine);
  if (decision === "check") {
    after(async () => {
      const since = new Date(Date.now() - ENGINE_WANT_WINDOW_MS);
      if (engineWarm.preloaded || !(await engineUsedSince(since, ENGINE_TOOLS_LOGGED, engineUseQuery))) return;
      engineWarm = { ...engineWarm, preloaded: true };
      await preloadEngine();
    });
  }
}

/** Čas, ktorý volanie strávilo načítaním modelov do cache motora (0 = boli teplé). */
async function engineLoadMs(since: number): Promise<number> {
  const { cacheSnapshot } = await import("@/lib/engine/cache");
  return cacheSnapshot()
    .filter((e) => e.loadedAt >= since)
    .reduce((sum, e) => sum + e.loadMs, 0);
}

/** Tool s meraním (D-100): čas a fázy idú do `mcp_call_log` až po odoslaní odpovede. */
async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const cold = !instanceWarm;
  instanceWarm = true;
  const timer = startTimer();
  const since = Date.now();
  let res: McpToolResult = { text: ["Chyba toolu"], isError: true };
  try {
    res = await runTool(name, args, timer);
    return res;
  } finally {
    if (name === SEARCH_ALL_TOOL.name || name === CALIBRATE_UNDERLAY_TOOL.name || ENGINE_TOOL_NAMES.has(name)) {
      const loadMs = await engineLoadMs(since).catch(() => 0);
      if (loadMs > 0) timer.add("engine_load", loadMs);
    }
    const { ms, phases } = timer.done();
    const row = { tool: name, action: callAction(args), ms, ok: !res.isError, cold, phases, region: process.env.VERCEL_REGION ?? null, client: callerLabel(currentCaller()) };
    after(() => writeCallLog(row));
  }
}

async function runTool(name: string, args: Record<string, unknown>, timer: CallTimer): Promise<McpToolResult> {
  if (ENGINE_SPIKE && name === "ifc_engine_probe") {
    // Lenivý import: DB tools nesmú platiť studený štart motora.
    const { runProbe } = await import("@/lib/engine/probe");
    try {
      return { text: [await runProbe(args)], isError: false };
    } catch (err) {
      return { text: [`Chyba motora: ${err instanceof Error ? err.message : String(err)}`], isError: true };
    }
  }
  if (BCF_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execBcfTool(name, args, defaultBcfDeps()));
    return { text: [res.text], isError: res.isError };
  }
  if (SAVED_VIEW_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execSavedViewTool(name, args, defaultSavedViewDeps()));
    return { text: [res.text], isError: res.isError };
  }
  if (FEEDBACK_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execFeedbackTool(name, args));
    return { text: [res.text], isError: res.isError };
  }
  if (VIEWER_QUERY_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execViewerQueryTool(name, args, siteUrl()));
    return { text: [res.text], isError: res.isError };
  }
  if (ENGINE_ENABLED && name === CALIBRATE_UNDERLAY_TOOL.name) {
    // Kalibrácia podkladu (D-133): IFC motor + zápis _georef; lenivo ako ostatné tools motora.
    const [{ execCalibrateUnderlay }, { defaultUnderlayDeps }] = await Promise.all([
      import("@/lib/engine/underlay-tool"),
      import("@/lib/engine/underlay-runtime"),
    ]);
    const res = await timer.phase("exec", () => execCalibrateUnderlay(args, defaultUnderlayDeps()));
    return { text: [res.text], isError: res.isError };
  }
  if (ENGINE_ENABLED && name === SEARCH_ALL_TOOL.name) {
    const { runSearchAll } = await import("@/lib/engine/run");
    const res = await timer.phase("exec", () => runSearchAll(args));
    return { text: [res.content], isError: res.isError };
  }
  if (ENGINE_ENABLED && ENGINE_TOOL_NAMES.has(name)) {
    // Lenivý import: motor (stovky MB po načítaní modelov) len keď ho Claude volá.
    const { runEngineTool } = await import("@/lib/engine/run");
    const res = await timer.phase("exec", () => runEngineTool(name, args));
    const text = [res.content];
    // Kóta z ifc_measure show (D-124) ide do viewera rovnako ako akcie DB tools.
    if (!res.isError && res.actions?.length) text.push(...(await deliverActions(name, args, res.actions, timer)));
    return { text, isError: res.isError };
  }
  const runtime = new AskToolRuntime();
  const res = await timer.phase("exec", () => runtime.exec(name, args));
  const text = [res.content];
  const actions = runtime.finalActions();
  if (!res.isError && actions.length > 0) text.push(...(await deliverActions(name, args, actions, timer, runtime.lensRev)));
  return { text, isError: res.isError };
}

const TEST_CHANNEL_SENT =
  "Pracovná session (Claude Code): príkaz išiel na testovací kanál sessions, nie do živého viewera používateľa (D-159). " +
  "Odkaz na produkciu sa nedáva; produkčný viewer na overenie neotváraj (D-135), overuj lokálne (skill verify).";

/** Akcie toolu do živého viewera (D-079) s potvrdením (D-101); vráti riadky pre odpoveď. */
async function deliverActions(
  name: string,
  args: Record<string, unknown>,
  actions: AskAction[],
  timer: CallTimer,
  lensRev?: string | null,
): Promise<string[]> {
  const text: string[] = [];
  const site = siteUrl();
  // Obnova uloženého pohľadu nesie stovky GUID (D-122): taký odkaz Claudovi nič nepovie.
  const links = actions
    .map((a) => `${a.label}: ${a.url.length > MAX_LINK ? "(príkaz je na odkaz pridlhý, ide len do živého viewera)" : `${site}${a.url}`}`)
    .join("\n");
  const channel = liveChannel();
  if (!channel) {
    text.push(`Živý viewer nie je nastavený (chýba LIVE_CHANNEL). Odkaz na otvorenie:\n${links}`);
  } else {
    // D-101: čakanie na potvrdenie sa prihlási ešte pred odoslaním príkazu (teplý kanál inštancie).
    const cmdId = randomUUID();
    const waitApplied = await timer.phase("channel", () => expectApplied(channel, cmdId).catch(() => null));
    const sent = await timer.phase("broadcast", () =>
      broadcastLive(channel, actions, fetch, cmdId).catch(() => ({ ok: false, status: 0 })),
    );
    // Pracovná session nejde do viewera používateľa a odkaz na produkciu nedostane (D-159, D-135).
    const test = isTestChannel(channel);
    if (test) text.push(TEST_CHANNEL_SENT);
    else {
      text.push(
        sent.ok
          ? `Odoslané do živého viewera. Záložný odkaz:\n${links}`
          : `Odoslanie do živého viewera zlyhalo (HTTP ${sent.status}). Odkaz na otvorenie:\n${links}`,
      );
    }
    if (test && !sent.ok) text.push(`Odoslanie na testovací kanál zlyhalo (HTTP ${sent.status}).`);
    // Potvrdzuje len viewer (`/ifc`); karta prvku alebo výkres je len navigácia.
    if (sent.ok && waitApplied && actions.some((a) => a.url.startsWith("/ifc"))) {
      const t0 = Date.now();
      const applied = await timer.phase("ack", () => waitApplied(ACK_TIMEOUT_MS));
      // Viac okien viewera za poslednú minútu (D-125): potvrdenie je len z jedného.
      const viewers = applied ? await recentViewerCount(channel, VIEWERS_WINDOW_MS).catch(() => 0) : 0;
      const missing = test ? TEST_CHANNEL_NO_VIEWER : notAppliedText(ACK_TIMEOUT_MS);
      text.push(applied ? appliedText(name, applied, Date.now() - t0, { args, viewers }) : missing);
    } else if (sent.ok) {
      // Bez teplého kanála pôvodné čítanie stavu (D-096 počty Lens, D-092 poloha rezu).
      if (lensRev) text.push(await timer.phase("lens", () => lensCountsText(channel, lensRev)));
      if (name === "set_section" && args.action === "set") {
        text.push(await timer.phase("readback", () => readBackSection(channel)));
      }
    }
  }
  return text;
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenMatches(token)) return new NextResponse("Not found", { status: 404 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(parseErrorResponse(), { status: 400, headers: NO_STORE });
  }

  const { caller, issued } = mcpCaller(req.headers, payload, process.env.MCP_TOKEN?.trim() ?? "");
  const deps: McpServerDeps = {
    serverInfo: { name: "aim-viewer", version: "1.0.0" },
    instructions: mcpServerInstructions(siteUrl(), ENGINE_ENABLED, mcpToolGroups({ engine: ENGINE_ENABLED })),
    tools: mcpToolDefinitions({ engine: ENGINE_ENABLED, spike: ENGINE_SPIKE }),
    callTool,
    onRejected: (name, unknown) => after(() => writeCallLog(rejectedCallRow(name, unknown, process.env.VERCEL_REGION ?? null))),
  };
  // D-100/D-101: modely motora sa načítajú vopred, aby ifc_* volanie nečakalo; D-135: len keď
  // rozhovor motor používa (tool motora teraz alebo v posledných 30 min), DB tools nečakajú.
  if (ENGINE_ENABLED) warmEngine(payload);
  const response = await withCaller(caller, () => handleMcpPayload(payload, deps));
  // D-159: klient hlavičku posiela pri každom ďalšom volaní, server podľa nej pozná rozhovor.
  const headers = issued ? { ...NO_STORE, "Mcp-Session-Id": issued } : NO_STORE;
  if (response === null) return new NextResponse(null, { status: 202, headers });
  return NextResponse.json(response, { headers });
}

/** Bez SSE streamu zo servera — klient používa len POST (Streamable HTTP). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenMatches(token)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export const DELETE = GET;
