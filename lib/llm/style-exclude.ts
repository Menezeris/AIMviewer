/**
 * Výnimka pri skrytí v `style_in_3d` (#246): "skry model VZT okrem trasy" jedným volaním.
 * Viewer pozná len hide a show nad GUIDmi alebo selektorom, preto host pošle za skrytím
 * `show` výnimiek (ops idú vo viewer postupne, D-098). Tu je len čistá logika; DB čítanie robí `tools.ts`.
 */

import { StyleInputError, styleOp } from "./style-plan";

/** Max výnimiek v jednom volaní: GUIDy idú v URL (~23 znakov), akcia klienta má limit 16 000 znakov. */
export const EXCLUDE_CAP = 300;

const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

export interface ExcludeInput {
  /** objects.id, object_ref alebo kód prvku. */
  refs: string[];
  /** IFC GlobalId z `ifc_*` toolov. */
  globalIds: string[];
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))] : [];

/** Výnimky z `exclude_ids_or_refs` a `exclude_global_ids`; `null`, keď žiadne nie sú. */
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

/** Op, ktorý výnimky znova zobrazí po skrytí; `undefined` bez výnimiek. */
export function excludeShowOp(guids: string[]): string | undefined {
  return guids.length > 0 ? styleOp("show", "", guids) : undefined;
}
