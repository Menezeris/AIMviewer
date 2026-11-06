import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import {
  getLlmProvider,
  LlmConfigError,
  type LlmMessage,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/llm/system-prompt";
import { AskToolRuntime, TOOL_DEFINITIONS } from "@/lib/llm/tools";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * LLM interface over the graph (D-056, F6): an agentic tool-calling loop over
 * whitelisted views. Read-only, row caps in tools, max number of rounds - the model
 * has no direct access to SQL or to writes. Sources (trust loop) are collected by the server
 * deterministically from tool results; the UI renders deep links from them.
 */

/** Max tool-call rounds per question (protects costs and loops). */
const MAX_TOOL_ROUNDS = 8;
/** Max tokens of the model response. 4000: a show_in_3d tool call with dozens of UUIDs
 *  has 1000+ tokens - at 1500 it was cut off in the middle and the response stayed empty. */
const MAX_TOKENS = 4000;
/** How many of the latest history messages we send to the model. */
const MAX_HISTORY = 20;
/** Max length of a single user message. */
const MAX_INPUT_CHARS = 2000;

export const maxDuration = 60;

// D-068: the endpoint triggers up to MAX_TOOL_ROUNDS+1 LLM calls per request -
// without a limit it is a vector for exhausting the provider's credit. Per-IP sliding
// window; default only in production - the eval runner (`npm run eval`, D-057) hammers
// the dev server with dozens of questions and must not be limited. Override in both
// directions via ASK_RATE_LIMIT_MAX (0 = off).
const RATE_LIMIT_MAX = Number(
  process.env.ASK_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 20 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(process.env.ASK_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const askLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

interface AskRequestBody {
  messages?: { role?: string; content?: string }[];
}

async function postHandler(req: Request) {
  // A foreign page firing at the API from the user's browser (CSRF-style
  // layer; requests without Origin - curl/eval - pass on to the limiter).
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }

  if (RATE_LIMIT_MAX > 0) {
    const rate = askLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  let body: AskRequestBody;
  try {
    body = (await req.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // History validation: alternating user/assistant TEXTS from the client; tool blocks
  // live only server-side within a single request (the client never sends them).
  const history = (body.messages ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content.slice(0, MAX_INPUT_CHARS) } as TextBlock],
    })) satisfies LlmMessage[];

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "posledná správa musí byť od používateľa" },
      { status: 400 }
    );
  }

  let provider;
  try {
    provider = await getLlmProvider();
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return NextResponse.json({ error: err.message, configured: false }, { status: 503 });
    }
    throw err;
  }

  const runtime = new AskToolRuntime(currentProjectId());
  const messages: LlmMessage[] = [...history];

  try {
    let answer = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await provider.complete({
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFINITIONS,
        maxTokens: MAX_TOKENS,
      });

      const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      const texts = res.content.filter((b): b is TextBlock => b.type === "text");
      answer = texts.map((t) => t.text).join("\n").trim() || answer;

      if (res.stopReason !== "tool_use" || toolUses.length === 0) break;

      // Last round: we no longer send tool results, the last text answer remains.
      if (round === MAX_TOOL_ROUNDS) break;

      messages.push({ role: "assistant", content: res.content });
      const results: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        const out = await runtime.exec(tu.name, tu.input);
        results.push({
          type: "tool_result",
          toolUseId: tu.id,
          content: out.content,
          isError: out.isError || undefined,
        });
      }
      messages.push({ role: "user", content: results });
    }

    // Safeguard against confabulation: when ALL tool calls failed, the model has
    // no data - its text must not pose as fact (verified: lite models
    // make up numbers after errors despite the prompt).
    const allToolsFailed =
      runtime.trace.length > 0 && runtime.trace.every((t) => !t.ok);
    if (allToolsFailed) {
      return NextResponse.json({
        answer:
          "Dáta sa nepodarilo načítať (chyba pripojenia k databáze) — odpoveď " +
          "nemám z čoho podložiť. Skús to o chvíľu znova.",
        sources: [],
        trace: runtime.trace,
        provider: provider.id,
      });
    }

    const sources = await runtime.finalizeSources();
    return NextResponse.json({
      answer: answer || "Nepodarilo sa zostaviť odpoveď — skús otázku preformulovať.",
      sources,
      trace: runtime.trace,
      actions: runtime.finalActions(),
      provider: provider.id,
    });
  } catch (err) {
    console.error("[api/ask]", err);
    return NextResponse.json(
      { error: "Spracovanie otázky zlyhalo. Skús to znova." },
      { status: 500 }
    );
  }
}

export const POST = withRequestAuth(withRequestProject(postHandler), { source: "app:/api/ask", write: false });
