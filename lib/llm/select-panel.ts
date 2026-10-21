import { PANEL_SECTIONS, type SelectPanel } from "../viewer-ops";

/**
 * Vstup `select_in_3d` pre panel vlastností (D-113) -> `SelectPanel` op `select`.
 * Bez panela `undefined`; chybný vstup je chyba toolu (model ju vidí a opraví),
 * nie ticho zahodený panel. Panel má od D-127 len IFC obsah: `panel_tab` sa už
 * neponúka a starý vstup sa ignoruje; výmera (Qto) sa zvýrazní v sekcii Quantities.
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
    // Sekciu podľa sady určí viewer (Qto -> Quantities); explicitnú sekciu focus prebije.
    delete panel.section;
  }
  return panel.section || panel.focus ? panel : undefined;
}

export interface PropertyLookup {
  /** Vlastnosť je v dátach AIM prvku (aj zdedená z typu). */
  in_aim: boolean;
  /** Presné mená, ak sa líšia veľkosťou písmen od zadaných. */
  pset?: string;
  property?: string;
  value?: unknown;
  /** Psety prvku, keď sa vlastnosť nenašla (na opravu mena). */
  psets?: string[];
}

const PSET_LIST_MAX = 30;

/**
 * Je `pset.property` v properties prvku (D-127)? Zhoda bez ohľadu na veľkosť písmen,
 * presná má prednosť. Rezervované `_kľúče` nie sú psety.
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
