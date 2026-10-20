/**
 * Minimálny MCP server (Streamable HTTP, bezstavový, JSON odpovede) pre custom
 * connector v Claude (D-079). Čistá funkcia nad JSON-RPC správami — transport
 * (Next route) a vykonanie tools sa injektujú, takže je testovateľná bez
 * Next runtime aj bez DB.
 *
 * Podporované metódy: `initialize`, `ping`, `tools/list`, `tools/call`;
 * notifikácie (bez `id`) sa potvrdia bez odpovede. Viac netreba — server
 * nevystavuje resources, prompts ani sampling.
 */

import type { ToolDefinition } from "@/lib/llm/provider";

/** Verzie protokolu, ktorým rozumieme (odpovedáme verziou klienta, ak ju poznáme). */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";

export interface McpToolResult {
  /** Textové bloky výsledku (JSON výsledok toolu + prípadná poznámka o živom kanáli). */
  text: string[];
  isError: boolean;
}

export interface McpServerDeps {
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: ToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
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
 * Klient (claude.ai) lepí textové bloky bez oddeľovača, takže riadok za blokom
 * by sa prilepil na jeho koniec - napr. záložný odkaz na "Vykonané vo vieweri".
 * Každý blok okrem posledného preto končí zalomením (JSON ho ako biely znak znesie).
 */
function separated(text: string, more: boolean): string {
  return more && !text.endsWith("\n") ? `${text}\n` : text;
}

async function handleOne(
  msg: unknown,
  deps: McpServerDeps,
): Promise<JsonRpcResponse | null> {
  if (!isObject(msg)) return fail(null, INVALID_REQUEST, "Správa musí byť JSON-RPC objekt.");
  const req = msg as JsonRpcRequest;
  const hasId = typeof req.id === "string" || typeof req.id === "number";
  const id = hasId ? (req.id as JsonRpcId) : null;

  // Odpoveď klienta (napr. na sampling) ani notifikácia nedostanú odpoveď.
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
          // Default: tool nemení dáta (UI akcie menia len pohľad vo vieweri);
          // tool, ktorý zapisuje, to prepíše vlastnými anotáciami (D-084).
          annotations: { readOnlyHint: true, openWorldHint: false, ...t.annotations },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!deps.tools.some((t) => t.name === name)) {
        return fail(id, INVALID_PARAMS, `Neznámy tool: ${name || "(chýba name)"}`);
      }
      const args = isObject(params.arguments) ? params.arguments : {};
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
 * Spracuje telo POST požiadavky (jedna správa alebo dávka). `null` = nič
 * neodpovedať (len notifikácie) → transport vráti 202.
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

/** Metódy JSON-RPC v správe alebo dávke (D-100: route podľa nich predčíta IFC motor). */
export function payloadMethods(payload: unknown): string[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.flatMap((m) => (isObject(m) && typeof m.method === "string" ? [m.method] : []));
}

/** Odpoveď na nečitateľné telo (neplatný JSON). */
export const parseErrorResponse = (): JsonRpcResponse =>
  fail(null, PARSE_ERROR, "Telo nie je platný JSON.");
