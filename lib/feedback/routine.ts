import "server-only";

/**
 * Spustenie Claude Code session z požiadavky (D-090): API trigger routine
 * "AIM: požiadavka z konektora" (claude.ai/code/routines), pre BCF tému
 * "AIM: BCF téma" (D-099, `RoutineConfig` z `lib/bcf/tools.ts`). Každé `/fire`
 * založí novú cloud session v účte vlastníka routine; session je bežná
 * interaktívna session, ktorú Samuel otvorí v Claude a môže v nej odpovedať.
 *
 * URL aj token sa kopírujú z routine (Edit -> API trigger -> Generate token),
 * token je viazaný na túto jednu routine. Bez nich sa session nespustí a
 * issue počká (požiadavka sa nestratí).
 */

/** Hlavička beta API routines; staršie dve hlavičky ostávajú platné po zmene. */
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";

export interface RoutineFireResult {
  sessionId: string;
  sessionUrl: string;
}

/** Token smie ísť len na API Anthropic; presnú cestu necháme na URL z routine. */
export function isFireUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "api.anthropic.com" && u.pathname.endsWith("/fire");
  } catch {
    return false;
  }
}

/** Ktorá routine: URL a token z API triggera + mená env do chybových hlášok. */
export interface RoutineConfig {
  url: string | undefined;
  token: string | undefined;
  env: string;
}

/** Routine "AIM: požiadavka z konektora" (D-090). */
export function feedbackRoutine(): RoutineConfig {
  return {
    url: process.env.CLAUDE_ROUTINE_FIRE_URL,
    token: process.env.CLAUDE_ROUTINE_TOKEN,
    env: "CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN",
  };
}

export function routineConfigured(cfg: RoutineConfig = feedbackRoutine()): boolean {
  return Boolean(cfg.url?.trim() && cfg.token?.trim());
}

/**
 * `text` príde do session ako blok `<routine-fire-payload>` (nedôveryhodné dáta);
 * uložený prompt routine hovorí, ako ho čítať.
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
