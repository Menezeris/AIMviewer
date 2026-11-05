import { randomUUID, timingSafeEqual } from "node:crypto";

import { NextResponse, after } from "next/server";

import { bcfToolDeps } from "@/lib/bcf/runtime-tools";
import { BCF_TOOL_NAMES, execBcfTool } from "@/lib/bcf/tools";
import { SEARCH_ALL_TOOL } from "@/lib/engine/search-all";
import { ENGINE_TOOL_NAMES } from "@/lib/engine/tool-defs";
import { isControlMode } from "@/lib/engine/underlay-control";
import { CALIBRATE_UNDERLAY_TOOL } from "@/lib/engine/underlay-tool-def";
import { FEEDBACK_TOOL_NAMES, execFeedbackTool } from "@/lib/feedback/tools";
import { broadcastLive, isTestChannel, liveChannel } from "@/lib/live/broadcast";
import { currentCaller, currentProject, currentProjectId, withCaller } from "@/lib/live/caller";
import type { IfcModel } from "@/lib/data/ifc-models";
import { ProjectNotFoundError, defaultProjectCode, resolveProject, type Project } from "@/lib/project/current";
import { withProjectParam } from "@/lib/live/viewer-apply-bus";
import { requestIfcModels } from "@/lib/project/models";
import { projectNotFoundResponse, requestProjectCode, runWithRequestProject } from "@/lib/project/request";
import { readBackSection } from "@/lib/live/section-readback";
import {
  TEST_CHANNEL_NO_VIEWER,
  VIEWER_QUERY_TOOL_NAMES,
  execViewerQueryTool,
} from "@/lib/live/viewer-query-tools";
import { lensCountsText } from "@/lib/live/lens-counts";
import { ackTimeoutMs, appliedText, notAppliedText } from "@/lib/live/applied-text";
import { expectApplied, recentViewerCount } from "@/lib/live/warm-channel";
import type { AskAction } from "@/lib/llm/actions";
import { AskToolRuntime } from "@/lib/llm/tools";
import { callAction, engineUseQuery, rejectedCallRow, writeCallLog } from "@/lib/mcp/call-log";
import { ENGINE_WANT_WINDOW_MS, engineUsedSince, engineWarmDecision, isEngineTool, payloadToolNames, type EngineWarmState } from "@/lib/mcp/engine-warm";
import { mcpServerInstructions } from "@/lib/mcp/tool-loading";
import { mcpToolDefinitions, mcpToolGroups } from "@/lib/mcp/tool-list";
import { IDS_TOOL_NAMES } from "@/lib/ids/tool-defs";
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
import { UNDERLAYS_LOAD_OP, underlaysSetOp } from "@/lib/viewer-underlays";
import { startTimer, type CallTimer } from "@/lib/mcp/timing";

/**
 * MCP connector for Claude (D-079): `POST /api/mcp/<MCP_TOKEN>`. The same
 * read-only tools as `/api/ask`; UI actions are broadcast to the live viewer
 * (Supabase Realtime, channel `LIVE_CHANNEL`); get_viewer_state (state and bounds) is
 * requested from the viewer over the same channel (D-085); feedback and requests for new
 * tools go to GitHub issues and start Claude sessions (D-090); BCF topics over the models live in the DB
 * and a topic for Claude starts a session (D-099). Without `MCP_TOKEN` the endpoint is
 * disabled (404). Stateless - no session ID, no SSE stream.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
/** A longer fallback link is not printed into the response. */
const MAX_LINK = 2000;
/** Viewer windows that responded within this period are counted into the multiple-windows warning (D-125). */
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

/** Diagnostics of the IFC engine (D-084 phase 0) - only when enabled by the env gate. */
const ENGINE_SPIKE = process.env.ENGINE_SPIKE === "1";
/** `ifc_*` tools of the IFC engine (D-084 phase 1) - env gate; diagnostics enables them too. */
const ENGINE_ENABLED = process.env.ENGINE_ENABLED === "1" || ENGINE_SPIKE;

/** First call in this function instance = cold start (D-100). */
let instanceWarm = false;
/** Engine warm-up in this instance (D-101, D-135): preloaded / when use was last checked. */
let engineWarm: EngineWarmState = { preloaded: false, checkedAt: null };

const ENGINE_TOOLS_LOGGED = [...ENGINE_TOOL_NAMES, SEARCH_ALL_TOOL.name, CALIBRATE_UNDERLAY_TOOL.name];

async function preloadEngine(models: IfcModel[]): Promise<void> {
  const [{ preloadEngineModels }] = await Promise.all([import("@/lib/engine/preload"), import("@/lib/engine/run")]);
  await preloadEngineModels(models);
}

/** Engine warm-up per D-135 (`lib/mcp/engine-warm.ts`); runs in `after()`, the response does not wait. */
function warmEngine(payload: unknown): void {
  const methods = payloadMethods(payload);
  const req = {
    engineCall: payloadToolNames(payload).some((n) => isEngineTool(n, ENGINE_TOOL_NAMES)),
    connect: methods.some((m) => m === "initialize" || m === "tools/list"),
  };
  const { decision, state } = engineWarmDecision(engineWarm, Date.now(), req);
  engineWarm = state;
  // D-189: the models of the request project, captured before `after()`.
  const models = requestIfcModels();
  if (decision === "preload") after(() => preloadEngine(models));
  if (decision === "check") {
    after(async () => {
      const since = new Date(Date.now() - ENGINE_WANT_WINDOW_MS);
      if (engineWarm.preloaded || !(await engineUsedSince(since, ENGINE_TOOLS_LOGGED, engineUseQuery))) return;
      engineWarm = { ...engineWarm, preloaded: true };
      await preloadEngine(models);
    });
  }
}

/** Time the call spent loading models into the engine cache (0 = they were warm). */
async function engineLoadMs(since: number): Promise<number> {
  const { cacheSnapshot } = await import("@/lib/engine/cache");
  return cacheSnapshot()
    .filter((e) => e.loadedAt >= since)
    .reduce((sum, e) => sum + e.loadMs, 0);
}

/** Tool with measurement (D-100): time and phases go to `mcp_call_log` only after the response is sent. */
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
    const row = { tool: name, action: callAction(args), ms, ok: !res.isError, cold, phases, region: process.env.VERCEL_REGION ?? null, client: callerLabel(currentCaller()), project_id: currentProjectId() };
    after(() => writeCallLog(row));
  }
}

async function runTool(name: string, args: Record<string, unknown>, timer: CallTimer): Promise<McpToolResult> {
  if (ENGINE_SPIKE && name === "ifc_engine_probe") {
    // Lazy import: DB tools must not pay the engine cold start.
    const { runProbe } = await import("@/lib/engine/probe");
    try {
      return { text: [await runProbe(args)], isError: false };
    } catch (err) {
      return { text: [`Chyba motora: ${err instanceof Error ? err.message : String(err)}`], isError: true };
    }
  }
  if (BCF_TOOL_NAMES.has(name)) {
    const res = await timer.phase("exec", () => execBcfTool(name, args, bcfToolDeps()));
    return { text: [res.text], isError: res.isError };
  }
  if (IDS_TOOL_NAMES.has(name)) {
    // Lazy import: the IDS package (@ifc-lite/ids) is loaded only when the tool is called (D-162).
    const { runIdsTool } = await import("@/lib/ids/runtime");
    const res = await timer.phase("exec", () => runIdsTool(name, args));
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
  if (ENGINE_ENABLED && name === CALIBRATE_UNDERLAY_TOOL.name && isControlMode(args.mode)) {
    // Underlay control (D-168): list from the DB and the viewer, other modes only change the viewer state (nothing is computed).
    const { execUnderlayControl } = await import("@/lib/engine/underlay-control");
    const { defaultControlDeps } = await import("@/lib/engine/underlay-control-runtime");
    const res = await timer.phase("exec", () => execUnderlayControl(args, defaultControlDeps()));
    const text = [res.text];
    if (res.reload) {
      // Calibration restore (D-168): the viewer reloads the underlays from the DB.
      const action: AskAction = { type: "navigate", url: `/ifc?ops=${encodeURIComponent(UNDERLAYS_LOAD_OP)}&r=${Date.now().toString(36)}`, label: res.label ?? "Podklady nanovo" };
      text.push(...(await deliverActions(name, args, [action], timer)));
    } else if (res.command) {
      const action: AskAction = {
        type: "navigate",
        url: `/ifc?ops=${encodeURIComponent(underlaysSetOp(res.command))}&r=${Date.now().toString(36)}`,
        label: res.label ?? "Podklady v 3D",
      };
      text.push(...(await deliverActions(name, args, [action], timer)));
    }
    return { text, isError: res.isError };
  }
  if (ENGINE_ENABLED && name === CALIBRATE_UNDERLAY_TOOL.name) {
    // Underlay calibration (D-133): IFC engine + _georef write; lazy like the other engine tools.
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
    // Lazy import: the engine (hundreds of MB after loading models) only when Claude calls it.
    const { runEngineTool } = await import("@/lib/engine/run");
    const res = await timer.phase("exec", () => runEngineTool(name, args));
    const text = [res.content];
    // The dimension from ifc_measure show (D-124) goes to the viewer the same way as DB tool actions.
    if (!res.isError && res.actions?.length) text.push(...(await deliverActions(name, args, res.actions, timer)));
    return { text, isError: res.isError };
  }
  const runtime = new AskToolRuntime(currentProjectId());
  const res = await timer.phase("exec", () => runtime.exec(name, args));
  const text = [res.content];
  const actions = runtime.finalActions();
  if (!res.isError && actions.length > 0) text.push(...(await deliverActions(name, args, actions, timer, runtime.lensRev)));
  return { text, isError: res.isError };
}

const TEST_CHANNEL_SENT =
  "Pracovná session (Claude Code): príkaz išiel na testovací kanál sessions, nie do živého viewera používateľa (D-159). " +
  "Odkaz na produkciu sa nedáva; produkčný viewer na overenie neotváraj (D-135), overuj lokálne (skill verify).";

/** Tool actions into the live viewer (D-079) with confirmation (D-101); returns rows for the response. */
async function deliverActions(
  name: string,
  args: Record<string, unknown>,
  projectActions: AskAction[],
  timer: CallTimer,
  lensRev?: string | null,
): Promise<string[]> {
  // D-189: commands of a non-default project carry `?project=` (the viewer switches to it).
  const code = currentProject().code;
  const actions = projectActions.map((a) => ({ ...a, url: withProjectParam(a.url, code, defaultProjectCode()) }));
  const text: string[] = [];
  const site = siteUrl();
  // Restoring a saved view carries hundreds of GUIDs (D-122): such a link tells Claude nothing.
  const links = actions
    .map((a) => `${a.label}: ${a.url.length > MAX_LINK ? "(príkaz je na odkaz pridlhý, ide len do živého viewera)" : `${site}${a.url}`}`)
    .join("\n");
  const channel = liveChannel();
  if (!channel) {
    text.push(`Živý viewer nie je nastavený (chýba LIVE_CHANNEL). Odkaz na otvorenie:\n${links}`);
  } else {
    // D-101: waiting for confirmation is registered before the command is sent (warm channel of the instance).
    const cmdId = randomUUID();
    const waitApplied = await timer.phase("channel", () => expectApplied(channel, cmdId).catch(() => null));
    const sent = await timer.phase("broadcast", () =>
      broadcastLive(channel, actions, fetch, cmdId).catch(() => ({ ok: false, status: 0 })),
    );
    // A working session does not go into the user's viewer and does not get a link to production (D-159, D-135).
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
    // Only the viewer (`/ifc`) confirms; an element card or drawing is only navigation.
    if (sent.ok && waitApplied && actions.some((a) => a.url.startsWith("/ifc"))) {
      const t0 = Date.now();
      const ackMs = ackTimeoutMs(name, args);
      const applied = await timer.phase("ack", () => waitApplied(ackMs));
      // More viewer windows in the last minute (D-125): confirmation comes from only one.
      const viewers = applied ? await recentViewerCount(channel, VIEWERS_WINDOW_MS).catch(() => 0) : 0;
      const missing = test ? TEST_CHANNEL_NO_VIEWER : notAppliedText(ackMs);
      text.push(applied ? appliedText(name, applied, Date.now() - t0, { args, viewers }) : missing);
    } else if (sent.ok) {
      // Without a warm channel the original state read (D-096 Lens counts, D-092 section position).
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

  // D-189: the project comes from the connector URL (`/api/mcp/<token>?project=OCB`), else the default.
  let project: Project;
  try {
    project = await resolveProject({ code: requestProjectCode(req, { cookies: false }) });
  } catch (e) {
    if (e instanceof ProjectNotFoundError) return projectNotFoundResponse(e);
    throw e;
  }

  const { caller, issued } = mcpCaller(req.headers, payload, process.env.MCP_TOKEN?.trim() ?? "");
  const response = await withCaller(caller, () => runWithRequestProject(project, () => serveMcp(payload)));
  // D-159: the client sends the header on every further call, the server recognizes the conversation by it.
  const headers = issued ? { ...NO_STORE, "Mcp-Session-Id": issued } : NO_STORE;
  if (response === null) return new NextResponse(null, { status: 202, headers });
  return NextResponse.json(response, { headers });
}

/** One MCP payload inside the request context (caller and project, D-159, D-189). */
function serveMcp(payload: unknown) {
  const projectId = currentProjectId();
  const deps: McpServerDeps = {
    serverInfo: { name: "aim-viewer", version: "1.0.0" },
    instructions: mcpServerInstructions(siteUrl(), ENGINE_ENABLED, mcpToolGroups({ engine: ENGINE_ENABLED })),
    tools: mcpToolDefinitions({ engine: ENGINE_ENABLED, spike: ENGINE_SPIKE }),
    callTool,
    onRejected: (name, unknown) => after(() => writeCallLog(rejectedCallRow(name, unknown, process.env.VERCEL_REGION ?? null, projectId))),
  };
  // D-100/D-101: the engine models are loaded in advance so that an ifc_* call does not wait; D-135: only when
  // the conversation uses the engine (an engine tool now or in the last 30 min), DB tools do not wait.
  if (ENGINE_ENABLED) warmEngine(payload);
  return handleMcpPayload(payload, deps);
}

/** No SSE stream from the server - the client uses only POST (Streamable HTTP). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!tokenMatches(token)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export const DELETE = GET;
