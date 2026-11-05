import { PANEL_SECTIONS, type SelectPanel } from "../viewer-ops";

/**
 * Input of `select_in_3d` for the properties panel (D-113) -> `SelectPanel` op `select`.
 * Without a panel `undefined`; bad input is a tool error (the model sees it and fixes it),
 * not a silently dropped panel. Since D-127 the panel has only IFC content: `panel_tab` is no
 * longer offered and the old input is ignored; a quantity (Qto) is highlighted in the Quantities section.
 */
export function selectPanelInput(input: Record<string, unknown>): SelectPanel | undefined {
  const panel: SelectPanel = {};
  const section = input.panel_section;
  if (section !== undefined) {
    if (!(PANEL_SECTIONS as readonly unknown[]).includes(section)) throw new Error("panel_section: properties alebo quantities.");
    panel.section = section as SelectPanel["section"];
  }
  const highlight = typeof input.highlight === "string" ? input.highlight.trim() : input.highlight;
  if (highlight !== undefined && highlight !== "") {
    const dot = typeof highlight === "string" ? highlight.indexOf(".") : -1;
    const pset = dot > 0 ? (highlight as string).slice(0, dot).trim() : "";
    const property = dot > 0 ? (highlight as string).slice(dot + 1).trim() : "";
    if (!pset || !property || pset.length > 200 || property.length > 200) {
      throw new Error("highlight: 'Pset.Vlastnosť', napr. Pset_WallCommon.FireRating.");
    }
    panel.focus = { pset, property };
    // The section by set is determined by the viewer (Qto -> Quantities); an explicit section overrides the focus.
    delete panel.section;
  }
  return panel.section || panel.focus ? panel : undefined;
}

export interface PropertyLookup {
  /** The property is in the AIM element data (also inherited from the type). */
  in_aim: boolean;
  /** Exact names, if they differ in letter case from the given ones. */
  pset?: string;
  property?: string;
  value?: unknown;
  /** Psets of the element when the property was not found (for fixing the name). */
  psets?: string[];
}

const PSET_LIST_MAX = 30;

/**
 * Is `pset.property` in the properties of the element (D-127)? Case-insensitive match,
 * the exact one takes precedence. Reserved `_keys` are not psets.
 */
export function lookupProperty(properties: unknown, pset: string, property: string): PropertyLookup {
  const props = properties && typeof properties === "object" && !Array.isArray(properties) ? (properties as Record<string, unknown>) : {};
  const psets = Object.keys(props).filter((k) => !k.startsWith("_"));
  const pick = (names: string[], want: string) => names.find((n) => n === want) ?? names.find((n) => n.toLowerCase() === want.toLowerCase());
  const psetName = pick(psets, pset);
  const set = psetName ? props[psetName] : undefined;
  const fields = set && typeof set === "object" && !Array.isArray(set) ? (set as Record<string, unknown>) : null;
  const propName = fields ? pick(Object.keys(fields), property) : undefined;
  if (!fields || !propName) return { in_aim: false, psets: psets.slice(0, PSET_LIST_MAX) };
  return {
    in_aim: true,
    ...(psetName !== pset ? { pset: psetName } : {}),
    ...(propName !== property ? { property: propName } : {}),
    value: fields[propName],
  };
}
