/**
 * `view_state.clash_local` (D-164): the clash panel in the viewer. For `get_viewer_state` the lists are dropped
 * (`reviews` changed clash states, `results`), what stays is the test, `from_aim`, `dirty`, run summary and the selected clash
 * and counts; the lists are read by `clash action=from_viewer` (test and changed states). No dependency on tools.
 */

const LISTS = ["reviews", "results"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Panel state without lists; undefined if the viewer does not report `clash_local` (panel closed or an older fork). */
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
