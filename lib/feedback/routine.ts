import "server-only";

/**
 * Spustenie Claude Code session z požiadavky (D-090): API trigger routine
 * "AIM: požiadavka z konektora" (claude.ai/code/routines). Každé `/fire`
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

export function routineConfigured(): boolean {
  return Boolean(process.env.CLAUDE_ROUTINE_FIRE_URL?.trim() && process.env.CLAUDE_ROUTINE_TOKEN?.trim());
}

/**
 * `text` príde do session ako blok `<routine-fire-payload>` (nedôveryhodné dáta);
 * uložený prompt routine hovorí, ako ho čítať.
 */
export async function fireRoutine(text: string, fetchImpl: typeof fetch = fetch): Promise<RoutineFireResult> {
  const url = process.env.CLAUDE_ROUTINE_FIRE_URL?.trim();
  const token = process.env.CLAUDE_ROUTINE_TOKEN?.trim();
  if (!url || !token) throw new Error("Routine nie je nastavená (CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN).");
  if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[\w-]+\/fire$/.test(url)) {
    throw new Error("CLAUDE_ROUTINE_FIRE_URL nemá tvar https://api.anthropic.com/v1/claude_code/routines/<id>/fire.");
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
