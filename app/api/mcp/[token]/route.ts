import { randomUUID, timingSafeEqual } from "node:crypto";

import { NextResponse, after } from "next/server";

import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { BCF_TOOL_NAMES, execBcfTool } from "@/lib/bcf/tools";
import { SEARCH_ALL_TOOL } from "@/lib/engine/search-all";
import { ENGINE_TOOL_NAMES } from "@/lib/engine/tool-defs";
import { FEEDBACK_TOOL_NAMES, execFeedbackTool } from "@/lib/feedback/tools";
import { broadcastLive, liveChannel } from "@/lib/live/broadcast";
import { readBackSection } from "@/lib/live/section-readback";
import {
  VIEWER_QUERY_TOOL_NAMES,
  execViewerQueryTool,
} from "@/lib/live/viewer-query-tools";
import { lensCountsText } from "@/lib/live/lens-counts";
import { ACK_TIMEOUT_MS, appliedText, notAppliedText } from "@/lib/live/applied-text";
import { expectApplied } from "@/lib/live/warm-channel";
import { mcpInstructions } from "@/lib/llm/system-prompt";
import { AskToolRuntime } from "@/lib/llm/tools";
import { callAction, writeCallLog } from "@/lib/mcp/call-log";
import { mcpLegacyToolNames, mcpToolDefinitions } from "@/lib/mcp/tool-list";
import {
  handleMcpPayload,
  parseErrorResponse,
  payloadMethods,
  type McpServerDeps,
  type McpToolResult,
} from "@/lib/mcp/server";
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
/** Predčítanie motora už v tejto inštancii beží alebo dobehlo (D-101). */
let enginePreloaded = false;

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
    if (name === SEARCH_ALL_TOOL.name || ENGINE_TOOL_NAMES.has(name)) {
      const loadMs = await engineLoadMs(since).catch(() => 0);
      if (loadMs > 0) timer.add("engine_load", loadMs);
    }
    const { ms, phases } = timer.done();
    const row = { tool: name, action: callAction(args), ms, ok: !res.isError, cold, phases, region: process.env.VERCEL_REGION ?? null };
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
  if (FEEDBACK_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execFeedbackTool(name, args));
    return { text: [res.text], isError: res.isError };
  }
  if (VIEWER_QUERY_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execViewerQueryTool(name, args, siteUrl()));
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
    return { text: [res.content], isError: res.isError };
  }
  const runtime = new AskToolRuntime();
  const res = await timer.phase("exec", () => runtime.exec(name, args));
  const text = [res.content];
  const actions = runtime.finalActions();
  if (!res.isError && actions.length > 0) {
    const site = siteUrl();
    const links = actions.map((a) => `${a.label}: ${site}${a.url}`).join("\n");
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
      text.push(
        sent.ok
          ? `Odoslané do živého viewera. Záložný odkaz:\n${links}`
          : `Odoslanie do živého viewera zlyhalo (HTTP ${sent.status}). Odkaz na otvorenie:\n${links}`,
      );
      // Potvrdzuje len viewer (`/ifc`); karta prvku alebo výkres je len navigácia.
      if (sent.ok && waitApplied && actions.some((a) => a.url.startsWith("/ifc"))) {
        const t0 = Date.now();
        const applied = await timer.phase("ack", () => waitApplied(ACK_TIMEOUT_MS));
        text.push(applied ? appliedText(name, applied, Date.now() - t0) : notAppliedText(ACK_TIMEOUT_MS));
      } else if (sent.ok) {
        // Bez teplého kanála pôvodné čítanie stavu (D-096 počty Lens, D-092 poloha rezu).
        const lensRev = runtime.lensRev;
        if (lensRev) text.push(await timer.phase("lens", () => lensCountsText(channel, lensRev)));
        if (name === "set_section" && args.action === "set") {
          text.push(await timer.phase("readback", () => readBackSection(channel)));
        }
      }
    }
  }
  return { text, isError: res.isError };
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

  const deps: McpServerDeps = {
    serverInfo: { name: "aim-viewer", version: "1.0.0" },
    instructions: mcpInstructions(siteUrl(), ENGINE_ENABLED),
    tools: mcpToolDefinitions({ engine: ENGINE_ENABLED, spike: ENGINE_SPIKE }),
    legacyTools: mcpLegacyToolNames({ engine: ENGINE_ENABLED }),
    callTool,
  };
  // D-100: Claude sa pripája (initialize / tools/list) -> modely motora sa načítajú vopred,
  // prvé ifc_* volanie potom nečaká na stiahnutie a parsovanie.
  // D-101: aj prvá požiadavka na studenú inštanciu (Claude sa nepripája nanovo, ale
  // volanie trafí novú inštanciu) - import motora a modely, kým beží DB tool.
  if (ENGINE_ENABLED && (!enginePreloaded || payloadMethods(payload).some((m) => m === "initialize" || m === "tools/list"))) {
    enginePreloaded = true;
    after(async () => {
      const [{ preloadEngineModels }] = await Promise.all([import("@/lib/engine/preload"), import("@/lib/engine/run")]);
      await preloadEngineModels();
    });
  }
  const response = await handleMcpPayload(payload, deps);
  if (response === null) return new NextResponse(null, { status: 202, headers: NO_STORE });
  return NextResponse.json(response, { headers: NO_STORE });
}

/** Bez SSE streamu zo servera — klient používa len POST (Streamable HTTP). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenMatches(token)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export const DELETE = GET;
