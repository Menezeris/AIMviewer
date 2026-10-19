import "server-only";

import { queryLiveViewer } from "./query";

/** Server čaká dlhšie než klient (7 s) a fork (6 s): navigácia, zóna a vyhodnotenie lens. */
const LENS_QUERY_TIMEOUT_MS = 10_000;

/**
 * Počty AIM chat lens po `style_in_3d` (D-096): otázka `lens_state` s verziou
 * `rev` cez spätný kanál; viewer odpovie až po vyhodnotení práve tejto verzie.
 * Vráti text pre model - počty, alebo prečo nie sú (lens sa aj tak použila).
 */
export async function lensCountsText(
  channel: string,
  rev: string,
  query: typeof queryLiveViewer = queryLiveViewer,
): Promise<string> {
  const outcome = await query(channel, "lens_state", [], { rev, timeoutMs: LENS_QUERY_TIMEOUT_MS }).catch(
    () => ({ ok: false, reason: "channel_error" }) as const,
  );
  if (!outcome.ok) {
    return outcome.reason === "timeout"
      ? "Počty z Lens neprišli (viewer neodpovedal včas); používateľ ich vidí v paneli Lens."
      : "Počty z Lens sa nepodarilo načítať; používateľ ich vidí v paneli Lens.";
  }
  if (!outcome.reply.ok) return `Počty z Lens: viewer odpovedal chybou (${outcome.reply.error}).`;
  return `Počty vo vieweri (Lens AIM chat): ${JSON.stringify(outcome.reply.result)}`;
}
