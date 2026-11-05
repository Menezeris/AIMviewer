import "server-only";

import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

/**
 * Deterministic mock provider (D-056) - the whole agentic loop of `/api/ask`
 * (tool-calling, source collection, error path) can be verified without an API key and without
 * a network (devtest/e2e, verify skill). It is switched on via `LLM_PROVIDER=mock`.
 *
 * Behavior: on the first user input it calls `search_objects` with the text of the question;
 * after the tool result it answers with text (including an error result - it verifies that the
 * loop survives a DB outage). Input with the prefix `notool:` answers directly.
 */
export function createMockProvider(): LlmProvider {
  return {
    id: "mock",
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const last = req.messages[req.messages.length - 1];

      const lastToolResult = last?.content.find((b) => b.type === "tool_result");
      if (lastToolResult) {
        const status = lastToolResult.isError ? "s chybou" : "úspešne";
        return {
          content: [
            {
              type: "text",
              text:
                `Mock odpoveď: tool dobehol ${status}. ` +
                `Výsledok (skrátený): ${lastToolResult.content.slice(0, 200)}`,
            },
          ],
          stopReason: "end_turn",
        };
      }

      const lastText =
        last?.content.find((b) => b.type === "text")?.text ?? "";
      if (lastText.startsWith("notool:")) {
        return {
          content: [
            { type: "text", text: `Mock odpoveď bez toolu: ${lastText.slice(7).trim()}` },
          ],
          stopReason: "end_turn",
        };
      }

      return {
        content: [
          { type: "text", text: "Hľadám v grafe…" },
          {
            type: "tool_use",
            id: "mock-tool-1",
            name: "search_objects",
            input: { query: lastText.slice(0, 80), limit: 5 },
          },
        ],
        stopReason: "tool_use",
      };
    },
  };
}
