import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { PROBE_TOOL } from "@/lib/engine/probe-def";
import { ENGINE_TOOL_NAMES, engineToolDefinitions } from "@/lib/engine/tool-defs";
import { broadcastLive, liveChannel } from "@/lib/live/broadcast";
import { mcpInstructions } from "@/lib/llm/system-prompt";
import { AskToolRuntime, TOOL_DEFINITIONS } from "@/lib/llm/tools";
import {
  handleMcpPayload,
  parseErrorResponse,
  type McpServerDeps,
  type McpToolResult,
} from "@/lib/mcp/server";

/**
 * MCP konektor pre Claude (D-079): `POST /api/mcp/<MCP_TOKEN>`. Tie isté
 * read-only tools ako `/api/ask`; UI akcie sa odvysielajú do živého viewera
 * (Supabase Realtime, kanál `LIVE_CHANNEL`). Bez `MCP_TOKEN` je endpoint
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

async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  if (ENGINE_SPIKE && name === "ifc_engine_probe") {
    // Lenivý import: DB tools nesmú platiť studený štart motora.
    const { runProbe } = await import("@/lib/engine/probe");
    try {
      return { text: [await runProbe(args)], isError: false };
    } catch (err) {
      return { text: [`Chyba motora: ${err instanceof Error ? err.message : String(err)}`], isError: true };
    }
  }
  if (ENGINE_ENABLED && ENGINE_TOOL_NAMES.has(name)) {
    // Lenivý import: motor (stovky MB po načítaní modelov) len keď ho Claude volá.
    const { runEngineTool } = await import("@/lib/engine/run");
    const res = await runEngineTool(name, args);
    return { text: [res.content], isError: res.isError };
  }
  const runtime = new AskToolRuntime();
  const res = await runtime.exec(name, args);
  const text = [res.content];
  const actions = runtime.finalActions();
  if (!res.isError && actions.length > 0) {
    const site = siteUrl();
    const links = actions.map((a) => `${a.label}: ${site}${a.url}`).join("\n");
    const channel = liveChannel();
    if (!channel) {
      text.push(`Živý viewer nie je nastavený (chýba LIVE_CHANNEL). Odkaz na otvorenie:\n${links}`);
    } else {
      const sent = await broadcastLive(channel, actions).catch(() => ({ ok: false, status: 0 }));
      text.push(
        sent.ok
          ? `Odoslané do živého viewera. Záložný odkaz:\n${links}`
          : `Odoslanie do živého viewera zlyhalo (HTTP ${sent.status}). Odkaz na otvorenie:\n${links}`,
      );
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
    tools: [
      ...TOOL_DEFINITIONS,
      ...(ENGINE_ENABLED ? engineToolDefinitions() : []),
      ...(ENGINE_SPIKE ? [PROBE_TOOL] : []),
    ],
    callTool,
  };
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
