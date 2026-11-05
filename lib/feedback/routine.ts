import "server-only";

/**
  * Launching a Claude Code session from a request (D-090): API trigger of the routine
  * "AIM: požiadavka z konektora" (connector request; claude.ai/code/routines), for a BCF topic
  * "AIM: BCF téma" (BCF topic; D-099, `RoutineConfig` from `lib/bcf/tools.ts`). Every `/fire`
  * creates a new cloud session in the routine owner's account; the session is an ordinary
  * interactive session that Samuel opens in Claude and can reply in.
 *
  * Both the URL and the token are copied from the routine (Edit -> API trigger -> Generate token),
  * the token is bound to this one routine. Without them the session does not start and
  * the issue waits (the request is not lost).
 */

/** Beta API header of routines; the older two headers stay valid after a change. */
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";

export interface RoutineFireResult {
  sessionId: string;
  sessionUrl: string;
}

/** The token may go only to the Anthropic API; the exact path is left to the URL from the routine. */
export function isFireUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "api.anthropic.com" && u.pathname.endsWith("/fire");
  } catch {
    return false;
  }
}

/** Which routine: URL and token from the API trigger + env names for error messages. */
export interface RoutineConfig {
  url: string | undefined;
  token: string | undefined;
  env: string;
}

/** Routine "AIM: Hard Issues" (D-090, renamed in D-134 from "AIM: požiadavka z konektora" (connector request); Opus). */
export function feedbackRoutine(): RoutineConfig {
  return {
    url: process.env.CLAUDE_ROUTINE_FIRE_URL,
    token: process.env.CLAUDE_ROUTINE_TOKEN,
    env: "CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN",
  };
}

/**
  * Routine "AIM: Standard Issues" (D-134, Sonnet): clear and local tasks. The model is
  * a property of the routine, `/fire` does not change it, hence a second routine next to "AIM: Hard Issues".
 */
export function standardRoutine(): RoutineConfig {
  return {
    url: process.env.CLAUDE_ROUTINE_STANDARD_FIRE_URL,
    token: process.env.CLAUDE_ROUTINE_STANDARD_TOKEN,
    env: "CLAUDE_ROUTINE_STANDARD_FIRE_URL, CLAUDE_ROUTINE_STANDARD_TOKEN",
  };
}

export function routineConfigured(cfg: RoutineConfig = feedbackRoutine()): boolean {
  return Boolean(cfg.url?.trim() && cfg.token?.trim());
}

/**
  * `text` arrives in the session as a `<routine-fire-payload>` block (untrusted data);
  * the stored prompt of the routine says how to read it.
 */
export async function fireRoutine(
  text: string,
  fetchImpl: typeof fetch = fetch,
  cfg: RoutineConfig = feedbackRoutine(),
): Promise<RoutineFireResult> {
  const url = cfg.url?.trim();
  const token = cfg.token?.trim();
  if (!url || !token) throw new Error(`Routine nie je nastavená (${cfg.env}).`);
  if (!isFireUrl(url)) {
    throw new Error(`URL routine (${cfg.env}) nemá tvar https://api.anthropic.com/.../fire (URL z API triggera routine).`);
  }
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": ROUTINE_BETA,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Routine /fire: HTTP ${res.status} ${raw.slice(0, 200)}`);
  let data: { claude_code_session_id?: string; claude_code_session_url?: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Routine /fire vrátila odpoveď, ktorá nie je JSON.");
  }
  if (!data.claude_code_session_url || !data.claude_code_session_id) {
    throw new Error("Routine /fire nevrátila odkaz na session.");
  }
  return { sessionId: data.claude_code_session_id, sessionUrl: data.claude_code_session_url };
}
