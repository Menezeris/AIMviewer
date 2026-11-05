import "server-only";

import {
  LlmConfigError,
  type ContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type TextBlock,
  type ToolUseBlock,
} from "./provider";

/**
 * Anthropic Messages API via plain `fetch` (D-056) - without an SDK, no new
 * dependency. Key from `ANTHROPIC_API_KEY`, model from `LLM_MODEL`.
 */

const DEFAULT_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Our neutral blocks -> Anthropic wire format. */
function toWireContent(blocks: ContentBlock[]): unknown[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "text":
        return { type: "text", text: b.text };
      case "tool_use":
        return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: b.toolUseId,
          content: b.content,
          ...(b.isError ? { is_error: true } : {}),
        };
    }
  });
}

function toWireMessages(messages: LlmMessage[]): unknown[] {
  return messages.map((m) => ({ role: m.role, content: toWireContent(m.content) }));
}

interface WireBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export function createAnthropicProvider(): LlmProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "Chýba env premenná ANTHROPIC_API_KEY. Doplň ju do .env.local (lokálne) " +
        "alebo do Vercel env (deploy) — LLM rozhranie je bez nej vypnuté."
    );
  }
  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL;

  return {
    id: `anthropic:${model}`,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: toWireMessages(req.messages),
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Anthropic API ${res.status}: ${body.slice(0, 500) || res.statusText}`
        );
      }

      const data = (await res.json()) as {
        content: WireBlock[];
        stop_reason: string | null;
      };

      const content: (TextBlock | ToolUseBlock)[] = [];
      for (const b of data.content ?? []) {
        if (b.type === "text" && typeof b.text === "string") {
          content.push({ type: "text", text: b.text });
        } else if (b.type === "tool_use" && b.id && b.name) {
          content.push({
            type: "tool_use",
            id: b.id,
            name: b.name,
            input: b.input ?? {},
          });
        }
      }

      const stopReason: LlmResponse["stopReason"] =
        data.stop_reason === "tool_use"
          ? "tool_use"
          : data.stop_reason === "end_turn"
            ? "end_turn"
            : data.stop_reason === "max_tokens"
              ? "max_tokens"
              : "other";

      return { content, stopReason };
    },
  };
}
