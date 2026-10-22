import "server-only";

/**
 * Provider vrstva LLM rozhrania (D-056, F6). API-pluggable: neutrálne typy správ
 * a tool-callov, konkrétny model sa vyberá cez env (`LLM_PROVIDER`, `LLM_MODEL`).
 * Server-only — API kľúč nikdy neopustí server (rovnaká línia ako D-026).
 */

/** Textový blok odpovede modelu. */
export interface TextBlock {
  type: "text";
  text: string;
  /** Opaque provider dáta (napr. Gemini `thoughtSignature`) — round-trip v slučke. */
  providerMeta?: Record<string, unknown>;
}

/** Model žiada zavolať tool s argumentami. */
export interface ToolUseBlock {
  type: "tool_use";
  /** Provider-špecifické ID callu — vracia sa v tool_result. */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Opaque provider dáta (Gemini 3 vyžaduje vrátiť `thoughtSignature` + `id`). */
  providerMeta?: Record<string, unknown>;
}

/** Výsledok toolu, ktorý posielame späť modelu. */
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  /** JSON-serializovaný výsledok (alebo chybová hláška). */
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LlmMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** JSON Schema definícia toolu (subset postačujúci pre naše tools). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * MCP anotácie toolu (D-084). Bez nich platí "len na čítanie"; tool, ktorý
   * zapisuje (fáza 3, D-086), ich musí prepísať, aby si klient vypýtal súhlas.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** MCP `_meta` toolu (D-153), napr. `anthropic/alwaysLoad`; posiela ho len konektor, nie chat. */
  meta?: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface LlmResponse {
  content: (TextBlock | ToolUseBlock)[];
  /** 'tool_use' → treba vykonať tools a pokračovať v slučke. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
}

export interface LlmProvider {
  /** Identifikátor pre trace/log (napr. 'anthropic:claude-sonnet-5'). */
  id: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Chyba konfigurácie (chýbajúci kľúč…) — API ju mapuje na 503 s návodom. */
export class LlmConfigError extends Error {}

/** Bez explicitného LLM_PROVIDER sa provider odvodí z dostupného kľúča. */
function detectProvider(): string {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  throw new LlmConfigError(
    "LLM rozhranie nie je nakonfigurované — doplň GEMINI_API_KEY alebo " +
      "ANTHROPIC_API_KEY do .env.local (lokálne) / Vercel env (deploy)."
  );
}

export async function getLlmProvider(): Promise<LlmProvider> {
  const provider = process.env.LLM_PROVIDER ?? detectProvider();
  switch (provider) {
    case "gemini": {
      const { createGeminiProvider } = await import("./gemini");
      return createGeminiProvider();
    }
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic");
      return createAnthropicProvider();
    }
    case "mock": {
      const { createMockProvider } = await import("./mock");
      return createMockProvider();
    }
    default:
      throw new LlmConfigError(
        `Neznámy LLM_PROVIDER '${provider}' — podporované: gemini, anthropic, mock.`
      );
  }
}
