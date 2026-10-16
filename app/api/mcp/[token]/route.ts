import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

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

async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
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
    instructions: mcpInstructions(siteUrl()),
    tools: TOOL_DEFINITIONS,
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
