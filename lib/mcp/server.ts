/**
  * Minimal MCP server (Streamable HTTP, stateless, JSON responses) for a custom
  * connector in Claude (D-079). A pure function over JSON-RPC messages - the transport
  * (Next route) and the tool execution are injected, so it is testable without the
  * Next runtime and without the DB.
 *
  * Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`;
  * notifications (without `id`) are acknowledged without a response. No more is needed - the server
  * does not expose resources, prompts or sampling.
 */

import type { ToolDefinition } from "@/lib/llm/provider";

/** Protocol versions we understand (we answer with the client's version if we know it). */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";

export interface McpToolResult {
    /** Text blocks of the result (the tool's JSON result + a possible note about the live channel). */
  text: string[];
  isError: boolean;
}

export interface McpServerDeps {
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: ToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
    /** A call rejected before `callTool` (unknown parameter), so that it is visible in the log. */
  onRejected?: (name: string, unknown: string[]) => void;
}

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string } };

const ok = (id: JsonRpcId | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result,
});
const fail = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
  * The client (claude.ai) glues text blocks together without a separator, so a line after a block
  * would stick to its end - e.g. the fallback link to "Vykonané vo vieweri" (done in the viewer).
  * So every block except the last ends with a line break (JSON tolerates it as whitespace).
 */
function separated(text: string, more: boolean): string {
  return more && !text.endsWith("\n") ? `${text}\n` : text;
}

/**
  * An unknown tool parameter is an error, not silently ignored input (D-126, #181:
  * `offset` in query_view and `ifc_type` at the top of aggregate_objects returned wrong
  * data without a warning). A schema with `additionalProperties: true` lets anything through.
 */
export function unknownArguments(tool: ToolDefinition, args: Record<string, unknown>): { unknown: string[]; text: string } | null {
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
  if (!isObject(schema.properties) || schema.additionalProperties === true) return null;
  const allowed = Object.keys(schema.properties);
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return null;
  return {
    unknown,
    text:
      `Chyba toolu: ${tool.name} nepozná parameter ${unknown.map((k) => `'${k}'`).join(", ")}; nič sa nevykonalo. ` +
      `Povolené: ${allowed.join(", ") || "(žiadne)"}. Filtre patria do parametra filters, ak ho tool má.`,
  };
}

async function handleOne(
  msg: unknown,
  deps: McpServerDeps,
): Promise<JsonRpcResponse | null> {
  if (!isObject(msg)) return fail(null, INVALID_REQUEST, "Správa musí byť JSON-RPC objekt.");
  const req = msg as JsonRpcRequest;
  const hasId = typeof req.id === "string" || typeof req.id === "number";
  const id = hasId ? (req.id as JsonRpcId) : null;

    // A client response (e.g. to sampling) and a notification get no response.
  if (typeof req.method !== "string") {
    return hasId && ("result" in msg || "error" in msg)
      ? null
      : fail(id, INVALID_REQUEST, "Chýba method.");
  }
  if (!hasId) return null;

  const params = isObject(req.params) ? req.params : {};

  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : FALLBACK_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: deps.serverInfo,
        instructions: deps.instructions,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: deps.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
                    // Default: the tool does not change data (UI actions change only the view in the viewer);
                    // a tool that writes overrides this with its own annotations (D-084).
          annotations: { readOnlyHint: true, openWorldHint: false, ...t.annotations },
          ...(t.meta ? { _meta: t.meta } : {}),
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = deps.tools.find((t) => t.name === name);
      if (!tool) {
        return fail(id, INVALID_PARAMS, `Neznámy tool: ${name || "(chýba name)"}`);
      }
      const args = isObject(params.arguments) ? params.arguments : {};
      const bad = unknownArguments(tool, args);
      if (bad) {
        deps.onRejected?.(name, bad.unknown);
        return ok(id, { content: [{ type: "text", text: bad.text }], isError: true });
      }
      try {
        const res = await deps.callTool(name, args);
        return ok(id, {
          content: res.text.map((text, i) => ({ type: "text", text: separated(text, i < res.text.length - 1) })),
          isError: res.isError,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return ok(id, {
          content: [{ type: "text", text: `Chyba toolu: ${message.slice(0, 300)}` }],
          isError: true,
        });
      }
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `Metóda nie je podporovaná: ${req.method}`);
  }
}

/**
  * Handles the body of a POST request (one message or a batch). `null` = answer
  * nothing (notifications only) -> the transport returns 202.
 */
export async function handleMcpPayload(
  payload: unknown,
  deps: McpServerDeps,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return fail(null, INVALID_REQUEST, "Prázdna dávka.");
    const out: JsonRpcResponse[] = [];
    for (const m of payload) {
      const r = await handleOne(m, deps);
      if (r) out.push(r);
    }
    return out.length > 0 ? out : null;
  }
  return handleOne(payload, deps);
}

/** JSON-RPC methods in a message or batch (D-100: the route uses them to preload the IFC engine). */
export function payloadMethods(payload: unknown): string[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.flatMap((m) => (isObject(m) && typeof m.method === "string" ? [m.method] : []));
}

/** Response to an unreadable body (invalid JSON). */
export const parseErrorResponse = (): JsonRpcResponse =>
  fail(null, PARSE_ERROR, "Telo nie je platný JSON.");
