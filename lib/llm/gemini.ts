import "server-only";

import {
  LlmConfigError,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type TextBlock,
  type ToolUseBlock,
} from "./provider";

/**
 * Google Gemini provider (D-056) - generateContent API via plain `fetch`,
 * without an SDK. Key from `GEMINI_API_KEY`, model from `LLM_MODEL` (default alias
 * `gemini-flash-lite-latest` - follows the current flash-lite line; Google keeps switching off specific
 * models for new accounts and full flash is often overloaded on the free tier
 * -> 503, verified live 2026-07-10). 429/503 is retried.
 *
 * Gemini 3.x specifics (verified live 2026-07-10):
 * - functionCall parts carry `thoughtSignature` + a native `id` and the API **requires
 *   returning them** in the next round - round-trip via `providerMeta` on the blocks.
 * - `functionResponse` is paired via `name` (+ `id` if present), not via our
 *   synthetic tool-use ID -> when serializing tool_result the name/id is looked up
 *   in the previous assistant messages.
 * - `functionResponse.response` must be an object -> we wrap the tool JSON into
 *   `{ result: ... }` / `{ error: ... }`.
 */

const DEFAULT_MODEL = "gemini-flash-lite-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Retry on free tier overload/rate limit (429/503) - pauses in ms. */
const RETRY_DELAYS_MS = [1500, 3000];

interface GeminiPart {
  text?: string;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
}

/** Map of synthetic tool-use ID -> { name, nativeId } from all tool_use blocks. */
function collectToolUses(messages: LlmMessage[]): Map<string, { name: string; nativeId?: string }> {
  const map = new Map<string, { name: string; nativeId?: string }>();
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "tool_use") {
        map.set(b.id, {
          name: b.name,
          nativeId: typeof b.providerMeta?.id === "string" ? b.providerMeta.id : undefined,
        });
      }
    }
  }
  return map;
}

function toWireContents(messages: LlmMessage[]): unknown[] {
  const toolUses = collectToolUses(messages);
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.content.map((b): GeminiPart => {
      switch (b.type) {
        case "text": {
          const sig = b.providerMeta?.thoughtSignature;
          return {
            text: b.text,
            ...(typeof sig === "string" ? { thoughtSignature: sig } : {}),
          };
        }
        case "tool_use": {
          const sig = b.providerMeta?.thoughtSignature;
          const nativeId = b.providerMeta?.id;
          return {
            functionCall: {
              name: b.name,
              args: b.input,
              ...(typeof nativeId === "string" ? { id: nativeId } : {}),
            },
            ...(typeof sig === "string" ? { thoughtSignature: sig } : {}),
          };
        }
        case "tool_result": {
          const tu = toolUses.get(b.toolUseId);
          let parsed: unknown;
          try {
            parsed = JSON.parse(b.content);
          } catch {
            parsed = b.content;
          }
          return {
            functionResponse: {
              name: tu?.name ?? b.toolUseId,
              ...(tu?.nativeId ? { id: tu.nativeId } : {}),
              response: b.isError ? { error: parsed } : { result: parsed },
            },
          };
        }
      }
    }),
  }));
}

export function createGeminiProvider(): LlmProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "Chýba env premenná GEMINI_API_KEY. Doplň ju do .env.local (lokálne) " +
        "alebo do Vercel env (deploy) — LLM rozhranie je bez nej vypnuté."
    );
  }
  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL;
  // Across rounds of the loop (one instance = one /api/ask request) -
  // synthetic IDs must be unique, otherwise tool_result is paired with the wrong call.
  let callCounter = 0;

  return {
    id: `gemini:${model}`,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const body = JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents: toWireContents(req.messages),
        tools: [
          {
            function_declarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          },
        ],
        generationConfig: { maxOutputTokens: req.maxTokens },
      });

      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
        });
        if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        break;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `Gemini API ${res.status}: ${errBody.slice(0, 500) || res.statusText}`
        );
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
      };
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const content: (TextBlock | ToolUseBlock)[] = [];
      for (const p of parts) {
        const meta: Record<string, unknown> = {};
        if (p.thoughtSignature) meta.thoughtSignature = p.thoughtSignature;
        if (typeof p.text === "string" && p.text.length > 0) {
          content.push({
            type: "text",
            text: p.text,
            ...(Object.keys(meta).length ? { providerMeta: meta } : {}),
          });
        } else if (p.functionCall?.name) {
          if (p.functionCall.id) meta.id = p.functionCall.id;
          content.push({
            type: "tool_use",
            id: `fc:${p.functionCall.name}:${callCounter++}`,
            name: p.functionCall.name,
            input: p.functionCall.args ?? {},
            ...(Object.keys(meta).length ? { providerMeta: meta } : {}),
          });
        }
      }

      const hasToolUse = content.some((b) => b.type === "tool_use");
      const stopReason: LlmResponse["stopReason"] = hasToolUse
        ? "tool_use"
        : candidate?.finishReason === "STOP"
          ? "end_turn"
          : candidate?.finishReason === "MAX_TOKENS"
            ? "max_tokens"
            : "other";

      return { content, stopReason };
    },
  };
}
