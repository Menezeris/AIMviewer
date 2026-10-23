import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { LiveCaller } from "../live/caller";

/**
 * Identita rozhovoru MCP konektora bez DB (D-159). Pri `initialize` server vráti hlavičku
 * `Mcp-Session-Id` (MCP Streamable HTTP) a klient ju posiela pri každom ďalšom volaní.
 * Hodnota je podpísaná (HMAC, kľúč `MCP_TOKEN`), takže server ju overí bez úložiska:
 * `<sid>.<meno klienta v base64url>.<podpis>`. Meno klienta je `clientInfo.name` z `initialize`.
 */

const MAX_CLIENT = 40;
const SIG_LEN = 22;

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url").slice(0, SIG_LEN);

export interface McpSession {
  /** Náhodná identita rozhovoru (8 znakov). */
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

/** `clientInfo.name` z `initialize` v požiadavke (aj v dávke); null = požiadavka nie je `initialize`. */
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
 * Pracovná session (Claude Code: ručná, routine, fork, eval), nie chat používateľa. Pozná ju podľa
 * mena klienta alebo User-Agent; jej príkazy idú na testovací kanál (D-159).
 */
export function isWorkClient(...names: (string | null | undefined)[]): boolean {
  return names.some((n) => !!n && /claude[-_ ]?code/i.test(n));
}

/**
 * Volajúci požiadavky: rozhovor z podpísanej hlavičky `Mcp-Session-Id` (pri `initialize` nová,
 * `issued` ide do odpovede), meno klienta a pracovná session podľa mena alebo User-Agent.
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

/** Do `mcp_call_log.client`: meno klienta a rozhovor (či chat drží jeden `sid`). */
export function callerLabel(c: LiveCaller | null): string | null {
  if (!c) return null;
  return `${c.client}${c.sid ? `#${c.sid}` : ""}${c.work ? " (work)" : ""}`.slice(0, 80);
}
