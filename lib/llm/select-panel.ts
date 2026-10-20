import { PANEL_SECTIONS, PANEL_TABS, type SelectPanel } from "../viewer-ops";

/**
 * Vstup `select_in_3d` pre panel vlastností (D-113) -> `SelectPanel` op `select`.
 * Bez panela `undefined`; chybný vstup je chyba toolu (model ju vidí a opraví),
 * nie ticho zahodený panel.
 */
export function selectPanelInput(input: Record<string, unknown>): SelectPanel | undefined {
  const panel: SelectPanel = {};
  const tab = input.panel_tab;
  if (tab !== undefined) {
    if (!(PANEL_TABS as readonly unknown[]).includes(tab)) throw new Error("panel_tab: aim alebo ifc.");
    panel.tab = tab as SelectPanel["tab"];
  }
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
    if (/^Qto_/i.test(pset)) {
      // Výmery sú v sekcii Quantities, kde upstream focus riadok nezvýrazní.
      panel.tab = "ifc";
      panel.section = "quantities";
    } else {
      panel.focus = { pset, property };
    }
  }
  return panel.tab || panel.section || panel.focus ? panel : undefined;
}

/** Poznámka do výsledku toolu, keď sa highlight nedá splniť doslova. */
export function selectPanelNote(input: Record<string, unknown>): string | undefined {
  return typeof input.highlight === "string" && /^\s*Qto_/i.test(input.highlight)
    ? "Výmery (Qto) viewer zvýrazniť nevie: otvorená je sekcia Quantities, hodnotu povedz z ifc_get."
    : undefined;
}
