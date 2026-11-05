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

/**
 * LLM rozhranie nad grafom (D-056, F6): agentická tool-calling slučka nad
 * whitelistovanými views. Read-only, row-capy v tools, max počet kôl — model
 * nemá priamy prístup k SQL ani k zápisu. Zdroje (trust loop) zbiera server
 * deterministicky z tool výsledkov; UI z nich renderuje deep-linky.
 */

/** Max kôl tool-callov na jednu otázku (ochrana nákladov aj slučiek). */
const MAX_TOOL_ROUNDS = 8;
/** Max tokenov odpovede modelu. 4000: tool call show_in_3d s desiatkami UUID
 *  má 1000+ tokenov — pri 1500 sa odsekol uprostred a odpoveď ostala prázdna. */
const MAX_TOKENS = 4000;
/** Koľko posledných správ histórie posielame modelu. */
const MAX_HISTORY = 20;
/** Max dĺžka jednej user správy. */
const MAX_INPUT_CHARS = 2000;

export const maxDuration = 60;

// D-068: endpoint spúšťa až MAX_TOOL_ROUNDS+1 LLM volaní na požiadavku —
// bez limitu je to vektor na vyčerpanie kreditu providera. Per-IP sliding
// window; default len v produkcii — eval runner (`npm run eval`, D-057) búši
// do dev servera desiatkami otázok a nesmie sa limitovať. Override oboma
// smermi cez ASK_RATE_LIMIT_MAX (0 = vypnuté).
const RATE_LIMIT_MAX = Number(
  process.env.ASK_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 20 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(process.env.ASK_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const askLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

interface AskRequestBody {
  messages?: { role?: string; content?: string }[];
}

export async function POST(req: Request) {
  // Cudzia stránka strieľajúca na API z prehliadača používateľa (CSRF-ová
  // vrstva; požiadavky bez Origin — curl/eval — prechádzajú na limiter).
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

  // Validácia histórie: striedavé user/assistant TEXTY od klienta; tool bloky
  // žijú len server-side v rámci jednej požiadavky (klient ich nikdy neposiela).
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

  const runtime = new AskToolRuntime();
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

      // Posledné kolo: tool výsledky už neposielame, ostáva posledná textová odpoveď.
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

    // Poistka proti konfabulácii: keď VŠETKY tool cally zlyhali, model nemá
    // žiadne dáta — jeho text sa nesmie tváriť ako fakt (overené: lite modely
    // si po chybách vymyslia čísla napriek promptu).
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
