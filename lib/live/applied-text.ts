import type { LiveAppliedPayload } from "./protocol";
import { withSectionOrientation } from "./section-orientation";

/**
 * Text pre model po potvrdení príkazu vo vieweri (D-101). Stav je ten, ktorý
 * viewer hlási PO vykonaní príkazu (rez, izolácia, zvýraznenie, súhrn Lens),
 * takže netreba ďalšie get_viewer_state; problémy povedia, čo sa nevykonalo.
 * D-125: upozorní na zmeny mimo príkazov, aktívny rez pri izolácii a farbení a
 * na viac okien viewera na kanáli.
 */

export const ACK_TIMEOUT_MS = 3000;

/** Akcie `style_in_3d`, pri ktorých rez skryje časť výsledku (#177). */
const CUT_SENSITIVE = new Set(["isolate", "xray", "colorize"]);

export interface AppliedContext {
  /** Argumenty toolu (action, clear_section...). */
  args?: Record<string, unknown>;
  /** Koľko okien viewera nedávno odpovedalo na kanáli (D-125). */
  viewers?: number;
}

/** Upozornenia k stavu po príkaze (D-125): zmeny mimo príkazov, rez pri farbení a izolácii, viac okien. */
export function appliedWarnings(tool: string, a: LiveAppliedPayload, ctx: AppliedContext = {}): string[] {
  const out: string[] = [];
  const state = (a.state ?? {}) as { changed_outside_commands?: unknown; section?: { crosses?: string; coordinate?: number } | null };
  const outside = Array.isArray(state.changed_outside_commands) ? state.changed_outside_commands.filter((c) => typeof c === "string") : [];
  if (outside.length > 0) {
    out.push(
      `Od predošlého príkazu sa vo vieweri zmenilo mimo príkazov (používateľ alebo iné okno): ${outside.join("; ")}. ` +
        "Nestavaj na stave pred touto zmenou; ak treba, povedz to používateľovi.",
    );
  }
  const action = typeof ctx.args?.action === "string" ? ctx.args.action : "";
  if (tool === "style_in_3d" && CUT_SENSITIVE.has(action) && state.section && ctx.args?.clear_section !== true) {
    const where = state.section.crosses && state.section.coordinate !== undefined ? ` (${state.section.crosses} = ${state.section.coordinate} m)` : "";
    out.push(
      `Aktívny rez${where} skrýva časť prvkov, výsledok môže vyzerať neúplne. Ak rez k úlohe nepatrí, zruš ho ` +
        "(set_section action=clear alebo style_in_3d clear_section=true) a povedz to používateľovi.",
    );
  }
  if ((ctx.viewers ?? 0) > 1) {
    out.push(
      `Na živý kanál odpovedá ${ctx.viewers} okien viewera; potvrdenie je z jedného z nich a ich stav sa môže líšiť. ` +
        "Ak používateľ vidí niečo iné, nech zavrie ostatné okná s ?live=.",
    );
  }
  return out;
}

export function appliedText(tool: string, a: LiveAppliedPayload, elapsedMs?: number, ctx: AppliedContext = {}): string {
  const head = a.ok
    ? `Vykonané vo vieweri${elapsedMs !== undefined ? ` (${elapsedMs} ms)` : ""}.`
    : `Vo vieweri sa nevykonalo všetko: ${a.issues.join("; ")}.`;
  const state = a.state === undefined ? "" : ` Stav po príkaze: ${JSON.stringify(withSectionOrientation(a.state))}.`;
  // D-092: rez nad podlažím má sedieť s eleváciou z DB, inak ho nepotvrdzuj.
  const section =
    tool === "set_section"
      ? " Pri reze nad podlažím má section.coordinate zodpovedať floor_elevation_model_units + offset_m; ak nie, povedz to a rez nepotvrdzuj."
      : "";
  const warnings = appliedWarnings(tool, a, ctx).map((w) => ` POZOR: ${w}`).join("");
  return `${head}${state}${section}${warnings}`;
}

export function notAppliedText(timeoutMs: number): string {
  return (
    `Viewer príkaz nepotvrdil do ${Math.round(timeoutMs / 1000)} s: nie je otvorený s ?live= alebo beží staršia ` +
    "verzia stránky (obnoviť ju). Netvrď, že sa príkaz vykonal; over cez get_viewer_state."
  );
}
