import "server-only";

import { queryLiveViewer, type QueryOutcome } from "./query";

/**
 * Section confirmation (D-092): after broadcasting `set_section` to the live viewer the
 * server asks for the state over the same channel (`view_state`, D-085) and returns where
 * the plane really is. This way Claude does not confirm a section only by what it sent.
 */

/** Shorter than a normal question: the confirmation is an add-on, the section was already sent. */
export const SECTION_READBACK_TIMEOUT_MS = 4000;

type Query = (channel: string) => Promise<QueryOutcome>;

const defaultQuery: Query = (channel) =>
  queryLiveViewer(channel, "view_state", [], { timeoutMs: SECTION_READBACK_TIMEOUT_MS });

/** Line for the tool answer: the actual section from the viewer, or why we do not know it. */
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
