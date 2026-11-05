/**
 * Exception when hiding in `style_in_3d` (#246): "hide the HVAC model except the route" in one call.
 * The viewer knows only hide and show over GUIDs or a selector, so the host sends after the hide
 * a `show` of the exceptions (ops run in the viewer sequentially, D-098). Only the pure logic is here; DB reading is done by `tools.ts`.
 */

import { StyleInputError, styleOp } from "./style-plan";

/** Max exceptions in one call: GUIDs go in the URL (~23 characters), the client action has a limit of 16 000 characters. */
export const EXCLUDE_CAP = 300;

const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

export interface ExcludeInput {
  /** objects.id, object_ref or element code. */
  refs: string[];
  /** IFC GlobalId from `ifc_*` tools. */
  globalIds: string[];
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))] : [];

/** Exceptions from `exclude_ids_or_refs` and `exclude_global_ids`; `null` when there are none. */
export function parseExclude(input: Record<string, unknown>, action: string): ExcludeInput | null {
  const refs = list(input.exclude_ids_or_refs);
  const all = list(input.exclude_global_ids);
  const globalIds = all.filter((g) => IFC_GUID_RE.test(g));
  if (refs.length === 0 && all.length === 0) return null;
  if (action !== "hide") {
    throw new StyleInputError(
      "exclude_ids_or_refs a exclude_global_ids platia len s action=hide. Izolácia len v rámci jedného modelu = " +
        "action=hide + model + výnimky (napr. hide, model=VZT, exclude_ids_or_refs=trasa).",
    );
  }
  if (refs.length + globalIds.length > EXCLUDE_CAP) {
    throw new StyleInputError(`Výnimiek je najviac ${EXCLUDE_CAP}, dostal som ${refs.length + globalIds.length}.`);
  }
  if (refs.length === 0 && globalIds.length === 0) {
    throw new StyleInputError("exclude_global_ids nemá žiadny platný IFC GlobalId (22 znakov).");
  }
  return { refs, globalIds };
}

/** Op that shows the exceptions again after hiding; `undefined` without exceptions. */
export function excludeShowOp(guids: string[]): string | undefined {
  return guids.length > 0 ? styleOp("show", "", guids) : undefined;
}
