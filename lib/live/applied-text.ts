import type { LiveAppliedPayload } from "./protocol";
import { withSectionOrientation } from "./section-orientation";

/**
 * Text pre model po potvrdení príkazu vo vieweri (D-101). Stav je ten, ktorý
 * viewer hlási PO vykonaní príkazu (rez, izolácia, zvýraznenie, súhrn Lens),
 * takže netreba ďalšie get_viewer_state; problémy povedia, čo sa nevykonalo.
 */

export const ACK_TIMEOUT_MS = 3000;

export function appliedText(tool: string, a: LiveAppliedPayload, elapsedMs?: number): string {
  const head = a.ok
    ? `Vykonané vo vieweri${elapsedMs !== undefined ? ` (${elapsedMs} ms)` : ""}.`
    : `Vo vieweri sa nevykonalo všetko: ${a.issues.join("; ")}.`;
  const state = a.state === undefined ? "" : ` Stav po príkaze: ${JSON.stringify(withSectionOrientation(a.state))}.`;
  // D-092: rez nad podlažím má sedieť s eleváciou z DB, inak ho nepotvrdzuj.
  const section =
    tool === "set_section"
      ? " Pri reze nad podlažím má section.coordinate zodpovedať floor_elevation_model_units + offset_m; ak nie, povedz to a rez nepotvrdzuj."
      : "";
  return `${head}${state}${section}`;
}

export function notAppliedText(timeoutMs: number): string {
  return (
    `Viewer príkaz nepotvrdil do ${Math.round(timeoutMs / 1000)} s: nie je otvorený s ?live= alebo beží staršia ` +
    "verzia stránky (obnoviť ju). Netvrď, že sa príkaz vykonal; over cez get_viewer_state."
  );
}
