import "server-only";

import { queryLiveViewer, type QueryOutcome } from "./query";

/**
 * Potvrdenie rezu (D-092): po odvysielaní `set_section` do živého viewera sa
 * server tým istým kanálom spýta na stav (`view_state`, D-085) a vráti, kde
 * rovina naozaj je. Claude tak nepotvrdí rez len podľa toho, čo poslal.
 */

/** Kratší než bežná otázka: potvrdenie je doplnok, odoslanie rezu už prebehlo. */
export const SECTION_READBACK_TIMEOUT_MS = 4000;

type Query = (channel: string) => Promise<QueryOutcome>;

const defaultQuery: Query = (channel) =>
  queryLiveViewer(channel, "view_state", [], { timeoutMs: SECTION_READBACK_TIMEOUT_MS });

/** Riadok pre odpoveď toolu: skutočný rez z viewera, alebo prečo ho nevieme. */
export async function readBackSection(channel: string, query: Query = defaultQuery): Promise<string> {
  let outcome: QueryOutcome;
  try {
    outcome = await query(channel);
  } catch {
    outcome = { ok: false, reason: "channel_error" };
  }
  if (!outcome.ok) {
    return outcome.reason === "timeout"
      ? "Polohu roviny viewer nepotvrdil (neodpovedal); over ju cez get_viewer_state."
      : "Polohu roviny sa nepodarilo prečítať zo živého viewera; over ju cez get_viewer_state.";
  }
  if (!outcome.reply.ok) return `Polohu roviny sa nepodarilo prečítať: ${outcome.reply.error}`;
  const result = outcome.reply.result as { section?: unknown } | null;
  const section = result && typeof result === "object" ? (result.section ?? null) : null;
  return (
    `Rez vo vieweri (IFC súradnice): ${JSON.stringify({ viewer_section: section })}. ` +
    "Pri reze nad podlažím má súradnica zodpovedať floor_elevation_model_units + offset_m; ak nie, " +
    "povedz používateľovi, že viewer rez umiestnil inak, a rez nepotvrdzuj."
  );
}
