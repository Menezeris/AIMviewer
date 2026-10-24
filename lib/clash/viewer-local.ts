/**
 * `view_state.clash_local` (D-164): panel clash vo vieweri. Pre `get_viewer_state` sa vyhodia zoznamy
 * (`reviews` zmenené stavy kolízií, `results`), ostane test, `from_aim`, `dirty`, súhrn behu a vybraná kolízia
 * a počty; zoznamy číta `clash action=from_viewer` (test a zmenené stavy). Bez závislosti na tools.
 */

const LISTS = ["reviews", "results"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Stav panela bez zoznamov; undefined, ak viewer `clash_local` nehlási (panel zatvorený alebo starší fork). */
export function compactClashLocal(state: unknown): Record<string, unknown> | undefined {
  const raw = isObj(state) ? state.clash_local : undefined;
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if ((LISTS as readonly string[]).includes(key)) {
      if (Array.isArray(value)) out[`${key}_count`] = value.length;
    } else out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
