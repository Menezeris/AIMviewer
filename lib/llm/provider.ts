import "server-only";

/**
 * Provider layer of the LLM interface (D-056, F6). API-pluggable: neutral message types
 * and tool calls, the concrete model is chosen via env (`LLM_PROVIDER`, `LLM_MODEL`).
 * Server-only - the API key never leaves the server (the same line as D-026).
 */

/** Text block of the model answer. */
export interface TextBlock {
  type: "text";
  text: string;
  /** Opaque provider data (e.g. Gemini `thoughtSignature`) - round-trip in the loop. */
  providerMeta?: Record<string, unknown>;
}

/** The model asks to call a tool with arguments. */
export interface ToolUseBlock {
  type: "tool_use";
  /** Provider-specific call ID - returned in tool_result. */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Opaque provider data (Gemini 3 requires returning `thoughtSignature` + `id`). */
  providerMeta?: Record<string, unknown>;
}

/** Result of a tool that we send back to the model. */
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  /** JSON-serialized result (or an error message). */
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LlmMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** JSON Schema definition of a tool (a subset sufficient for our tools). */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * MCP annotations of the tool (D-084). Without them "read only" applies; a tool that
   * writes (phase 3, D-086) must override them so that the client asks for consent.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** MCP `_meta` of the tool (D-153), e.g. `anthropic/alwaysLoad`; sent only by the connector, not the chat. */
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
  /** 'tool_use' -> tools must be executed and the loop continues. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
}

export interface LlmProvider {
  /** Identifier for trace/log (e.g. 'anthropic:claude-sonnet-5'). */
  id: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Configuration error (missing key...) - the API maps it to 503 with instructions. */
export class LlmConfigError extends Error {}

/** Without an explicit LLM_PROVIDER the provider is derived from the available key. */
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
