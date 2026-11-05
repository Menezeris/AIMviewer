import "server-only";

import { inactiveRuleWarnings } from "@/lib/llm/style-overlap";

import { queryLiveViewer } from "./query";

/** The server waits longer than the client (7 s) and the fork (6 s): navigation, zone and lens evaluation. */
const LENS_QUERY_TIMEOUT_MS = 10_000;

/**
 * Counts of the AIM chat lens after `style_in_3d` (D-096): a `lens_state` question with version
 * `rev` over the back channel; the viewer answers only after evaluating exactly this version.
 * Returns text for the model - the counts, or why they are not available (the lens was applied anyway).
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
  const result = outcome.reply.result;
  const warn = inactiveRuleWarnings((result as { rules?: unknown } | null)?.rules).map((w) => `POZOR: ${w}\n`).join("");
  return `${warn}Počty vo vieweri (Lens AIM chat): ${JSON.stringify(result)}`;
}
