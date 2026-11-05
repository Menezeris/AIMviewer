import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { LiveCaller } from "../live/caller";

/**
  * Identity of an MCP connector conversation without a DB (D-159). On `initialize` the server returns the
  * `Mcp-Session-Id` header (MCP Streamable HTTP) and the client sends it on every further call.
  * The value is signed (HMAC, key `MCP_TOKEN`), so the server verifies it without storage:
  * `<sid>.<client name in base64url>.<signature>`. The client name is `clientInfo.name` from `initialize`.
 */

const MAX_CLIENT = 40;
const SIG_LEN = 22;

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url").slice(0, SIG_LEN);

export interface McpSession {
    /** Random identity of the conversation (8 characters). */
  sid: string;
  /** `clientInfo.name` z `initialize` (napr. "claude-ai", "claude-code"). */
  client: string;
}

export function issueSessionId(client: string, secret: string, sid = randomBytes(6).toString("base64url")): string {
  const body = `${sid}.${b64url(client.slice(0, MAX_CLIENT))}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSessionId(value: string | null | undefined, secret: string): McpSession | null {
  if (!value || value.length > 200) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [sid, client, sig] = parts;
  const want = Buffer.from(sign(`${sid}.${client}`, secret));
  const got = Buffer.from(sig);
  if (!sid || want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { sid, client: Buffer.from(client, "base64url").toString("utf8") };
}

/** `clientInfo.name` from `initialize` in the request (also in a batch); null = the request is not `initialize`. */
export function initializeClientName(payload: unknown): string | null {
  const msgs = Array.isArray(payload) ? payload : [payload];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || (m as { method?: unknown }).method !== "initialize") continue;
    const info = (m as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo;
    return typeof info?.name === "string" && info.name.trim() ? info.name.trim().slice(0, MAX_CLIENT) : "unknown";
  }
  return null;
}

/**
  * A working session (Claude Code: manual, routine, fork, eval), not a user chat. It recognizes it by
  * the client name or User-Agent; its commands go to the test channel (D-159).
 */
export function isWorkClient(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => !!n && /claude[-_ ]?code/i.test(n));
}

/**
  * Caller of the request: the conversation from the signed `Mcp-Session-Id` header (new on `initialize`,
  * `issued` goes into the response), the client name and the working session by name or User-Agent.
 */
export function mcpCaller(
  headers: { get(name: string): string | null },
  payload: unknown,
  secret: string,
): { caller: LiveCaller; issued?: string } {
  const ua = headers.get("user-agent")?.slice(0, 60) ?? "";
  const initName = initializeClientName(payload);
  const issued = initName !== null && secret ? issueSessionId(initName, secret) : undefined;
  const session = secret ? readSessionId(issued ?? headers.get("mcp-session-id"), secret) : null;
  const client = session?.client ?? (ua ? `ua:${ua}` : "unknown");
  return { caller: { sid: session?.sid, client, work: isWorkClient(session?.client, ua) }, issued };
}

/** Into `mcp_call_log.client`: the client name and conversation (whether the chat keeps one `sid`). */
export function callerLabel(c: LiveCaller | null): string | null {
  if (!c) return null;
  return `${c.client}${c.sid ? `#${c.sid}` : ""}${c.work ? " (work)" : ""}`.slice(0, 80);
}
