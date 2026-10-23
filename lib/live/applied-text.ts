import { inactiveRuleWarnings } from "../llm/style-overlap";
import type { LiveAppliedPayload } from "./protocol";
import { withSectionOrientation } from "./section-orientation";
import { visibleArea, type ViewerCamera } from "../viewer-camera";

/**
 * Text pre model po potvrdení príkazu vo vieweri (D-101). Stav je ten, ktorý
 * viewer hlási PO vykonaní príkazu (rez, izolácia, zvýraznenie, súhrn Lens),
 * takže netreba ďalšie get_viewer_state; problémy povedia, čo sa nevykonalo.
 * D-125: upozorní na zmeny mimo príkazov, aktívny rez pri izolácii a farbení a
 * na viac okien viewera na kanáli.
 */

export const ACK_TIMEOUT_MS = 3000;

/** Po `set_camera` k stavu pridá viditeľnú oblasť z koncovej kamery (D-128). */
function withVisibleArea(tool: string, state: unknown): unknown {
  if (tool !== "set_camera" || !state || typeof state !== "object") return state;
  const camera = (state as { camera?: unknown }).camera;
  if (!camera || typeof camera !== "object") return state;
  const visible = visibleArea(camera as ViewerCamera);
  return visible ? { ...state, visible } : state;
}

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
  if (tool === "style_in_3d") out.push(...inactiveRuleWarnings(((a.state ?? {}) as { lens?: { rules?: unknown } }).lens?.rules));
  if ((ctx.viewers ?? 0) > 1) {
    out.push(
      `Na živý kanál odpovedá ${ctx.viewers} okien viewera; potvrdenie je z jedného z nich a ich stav sa môže líšiť. ` +
        "Ak používateľ vidí niečo iné, nech zavrie ostatné okná s ?live=.",
    );
  }
  return out;
}

/** Stav tabuľky po `open_list` (D-148): beží, hotová alebo prečo nie. */
export function listStateText(tool: string, state: unknown, run: boolean): string {
  if (tool !== "open_list") return "";
  const l = state && typeof state === "object" ? (state as { list?: { name?: string; status?: string; rows?: number; error?: string; reason?: string } }).list : undefined;
  if (!l) return run ? " Viewer neposlal stav zoznamu (staršia verzia viewera?): netvrď, že tabuľka beží; nech používateľ stlačí Run." : "";
  if (l.status === "done") return ` Tabuľka je spustená a hotová: ${l.rows ?? 0} riadkov.`;
  if (l.status === "running") return " Tabuľka beží, výsledok sa ešte počíta; používateľ ho uvidí v paneli Lists.";
  if (l.status === "failed") return ` Tabuľka sa nespustila: ${l.error ?? "chyba výpočtu"}.`;
  if (l.status === "not_started") return ` Tabuľka sa nespustila: ${l.reason ?? "panel Lists sa nezobrazil"}. Používateľ ju spustí tlačidlom Run.`;
  return run ? "" : " Zoznam je otvorený v builderi, Run stlačí používateľ.";
}

type ListState = {
  status?: string;
  visible_rows?: number;
  sums?: Array<{ column?: string; value?: number; unit?: string }>;
  maximized?: boolean;
  sort?: { column?: string; dir?: string } | null;
  color_by?: string;
  export_ready?: string;
};

const VIEW_ARGS = ["maximize", "sort_by", "sum", "group_by", "search", "color_by", "export"];

/**
 * Úpravy zoznamu (D-149): súčty povedané vetou, a čo sa z `maximize`/`sort_by`/`sum` nevykonalo;
 * krok 2: farby podľa stĺpca a ponuka exportu (stiahnutie je na kliku používateľa).
 */
export function listViewText(tool: string, state: unknown, args: Record<string, unknown> = {}): string {
  if (tool !== "open_list") return "";
  const l = state && typeof state === "object" ? (state as { list?: ListState }).list : undefined;
  const asked = VIEW_ARGS.some((k) => args[k] !== undefined) || args.action === "update";
  if (!l || l.status === "failed" || l.status === "not_started") return "";
  if (asked && l.sums === undefined) return " Viewer neposlal stav tabuľky (staršia verzia viewera?): zoradenie, súčty a maximalizáciu nepotvrdzuj.";
  const out: string[] = [];
  const sums = (l.sums ?? []).filter((x) => typeof x.value === "number");
  if (sums.length > 0) {
    const rows = typeof l.visible_rows === "number" ? ` za ${l.visible_rows} zobrazených riadkov` : "";
    out.push(`Súčty${rows}: ${sums.map((x) => `${x.column} = ${x.value}${x.unit ? ` ${x.unit}` : ""}`).join(", ")}.`);
  } else if (Array.isArray(args.sum) && args.sum.length > 0 && l.status === "done") {
    out.push("Súčet sa v tabuľke nezobrazil (stĺpec v zozname nie je alebo tabuľka nie je zobrazená): súčet nehlás.");
  }
  if (args.maximize === true && l.maximized === false) {
    out.push("Panel Lists sa nemaximalizoval (nie je v spodnom pruhu viewera alebo tabuľka ešte nie je zobrazená).");
  }
  if (typeof args.sort_by === "string" && args.sort_by.trim() && !l.sort && l.status === "done") {
    out.push("Zoradenie sa neprejavilo (stĺpec v zozname nie je).");
  }
  if (typeof args.color_by === "string" && args.color_by.trim()) {
    if (l.color_by) out.push(`Prvky v 3D sú ofarbené podľa stĺpca ${l.color_by}, legenda je v paneli Lens.`);
    else if (l.status === "done") out.push("Farby podľa stĺpca sa nepoužili (pozri problémy viewera): ofarbenie nepotvrdzuj.");
  }
  if (typeof args.export === "string") {
    if (l.export_ready) {
      out.push(`Vo vieweri svieti tlačidlo Stiahnuť ${l.export_ready.toUpperCase()}: povedz používateľovi, nech naň klikne (bez kliku prehliadač súbor nestiahne).`);
    } else if (l.status === "done") {
      out.push("Ponuka exportu sa nezobrazila: nech používateľ exportuje tlačidlom Export v tabuľke.");
    }
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

export function appliedText(tool: string, a: LiveAppliedPayload, elapsedMs?: number, ctx: AppliedContext = {}): string {
  const head = a.ok
    ? `Vykonané vo vieweri${elapsedMs !== undefined ? ` (${elapsedMs} ms)` : ""}.`
    : `Vo vieweri sa nevykonalo všetko: ${a.issues.join("; ")}.`;
  const state = a.state === undefined ? "" : ` Stav po príkaze: ${JSON.stringify(withVisibleArea(tool, withSectionOrientation(a.state)))}.`;
  // D-092: rez nad podlažím má sedieť s eleváciou z DB, inak ho nepotvrdzuj.
  const section =
    tool === "set_section"
      ? " Pri reze nad podlažím má section.coordinate zodpovedať floor_elevation_model_units + offset_m; ak nie, povedz to a rez nepotvrdzuj."
      : "";
  const warnings = appliedWarnings(tool, a, ctx).map((w) => ` POZOR: ${w}`).join("");
  const list = listStateText(tool, a.state, ctx.args?.run === true) + listViewText(tool, a.state, ctx.args);
  return `${head}${state}${section}${list}${warnings}`;
}

export function notAppliedText(timeoutMs: number): string {
  return (
    `Viewer príkaz nepotvrdil do ${Math.round(timeoutMs / 1000)} s: nie je otvorený s ?live= alebo beží staršia ` +
    "verzia stránky (obnoviť ju). Netvrď, že sa príkaz vykonal; over cez get_viewer_state."
  );
}
