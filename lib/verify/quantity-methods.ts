/**
 * Register metód výmer (D-185): JEDINÉ miesto, kde sú záväzné pravidlá overovača výmer voči
 * geometrii. Číta ho kód (lib/engine/space-verify.ts) a výsledok overenia z neho nesie pri každej
 * hodnote metódu, definíciu zo schémy a použitú toleranciu, aby ich videl používateľ vo vieweri.
 * Dokumenty (DECISIONS.md D-185, docs/research) sem odkazujú, pravidlá nekopírujú.
 *
 * Zdroj definícií: buildingSMART/IFC4.3.x-development `d71e140` (2026-10-29),
 * reference_schemas/psd/Qto_SpaceBaseQuantities.xml a psd_IFC4_ADD2_TC1 (text v oboch rovnaký).
 */

export const REGISTRY_VERSION = 1;

export const SPEC_REF = {
  repo: "buildingSMART/IFC4.3.x-development",
  commit: "d71e140",
  qto_space: "reference_schemas/psd/Qto_SpaceBaseQuantities.xml",
  qto_space_ifc4: "reference_schemas/psd_IFC4_ADD2_TC1/Qto_SpaceBaseQuantities.xml",
  ifc_space: "docs/schemas/core/IfcProductExtension/Entities/IfcSpace.md",
} as const;

// ── tolerancie (Samuel 1. 11. 2026: schválené) ───────────────────────────────

export type QuantityKind = "length" | "area" | "volume";

export interface ToleranceRule {
  kind: QuantityKind;
  /** Absolútna tolerancia v m / m2 / m3 (null = nepoužíva sa). */
  abs: number | null;
  /** Relatívna tolerancia (podiel hodnoty zo súboru, null = nepoužíva sa). */
  rel: number | null;
  /** Text pre používateľa. */
  text: string;
}

/** Hodnota je v tolerancii, keď spĺňa aspoň jednu z hraníc (abs alebo rel). */
export const TOLERANCES: Record<QuantityKind, ToleranceRule> = {
  length: { kind: "length", abs: 0.005, rel: null, text: "dĺžka +- 5 mm" },
  area: { kind: "area", abs: null, rel: 0.005, text: "plocha +- 0,5 %" },
  volume: { kind: "volume", abs: 0.05, rel: 0.005, text: "objem +- 0,5 % alebo +- 0,05 m3" },
};

export function withinTolerance(file: number, computed: number, kind: QuantityKind): boolean {
  const t = TOLERANCES[kind];
  const d = Math.abs(computed - file);
  return (t.abs != null && d <= t.abs) || (t.rel != null && d <= t.rel * Math.abs(file));
}

// ── pravidlá výberu prvkov ───────────────────────────────────────────────────

export const SELECTION = {
  /** Doska pod / nad: podiel pôdorysu miestnosti, ktorý musí prekryť. */
  slab_min_overlap: 0.5,
  /** Podlahovina: podiel pôdorysu miestnosti. */
  flooring_min_overlap: 0.5,
  /** Podhľad: podiel pôdorysu, od ktorého sa výška podhľadu ráta ako ďalšia výška miestnosti. */
  ceiling_min_overlap: 0.1,
  /** Dotyk plôch (doska - teleso miestnosti) v m. */
  contact_m: 0.005,
} as const;

// ── pravidlo konštantnosti (Samuel 1. 11. 2026: podľa textu schémy) ─────────

/**
 * Schéma: Height, FinishFloorHeight a FinishCeilingHeight "to be provided only if ... constant".
 * Rozdelenie miestnosti schéma umožňuje (IfcSpace CompositionType PARTIAL cez IfcRelAggregates).
 * Preto pri viacerých výškach v pôdoryse miestnosti:
 * - hodnota v súbore JE  -> červená, nález "vlastnosť nie je jednoznačná, miestnosť má N výšok"
 *   (BCF pre OCB: hodnotu odstrániť, alebo miestnosť rozdeliť na čiastkové priestory);
 * - hodnota v súbore NIE JE -> zelená ("správne neuvedená, výška nie je konštantná").
 * Žiadny vážený medián ani priemer.
 */
export const NON_CONSTANT_RULE = {
  id: "non-constant@1",
  text: "Výška nie je v pôdoryse miestnosti konštantná; schéma hovorí 'to be provided only if constant'. Hodnotu z modelu odstrániť, alebo miestnosť rozdeliť na čiastkové priestory (IfcSpace PARTIAL).",
} as const;

// ── metódy veličín IfcSpace ──────────────────────────────────────────────────

export interface QuantityMethod {
  /** Recept s verziou (mení sa pri zmene výpočtu). */
  id: string;
  /** Pset.Veličina, ktorú overuje. */
  target: string;
  kind: QuantityKind;
  /** Čo sa z geometrie meria (pre používateľa). */
  method: string;
  /** Doslovná definícia zo schémy. */
  definition: string;
  spec_ref: string;
  /** Platí pravidlo konštantnosti. */
  constant_only?: boolean;
}

const Q = "Qto_SpaceBaseQuantities";
const spec = (name: string) => `${SPEC_REF.repo}@${SPEC_REF.commit}:${SPEC_REF.qto_space}#${name}`;

export const SPACE_METHODS = {
  height_own: {
    id: "space.height.own@1", target: `${Q}.Height`, kind: "length",
    method: "vrch - spodok vlastného telesa miestnosti (Body)",
    definition: "Total height (from base slab without flooring to ceiling without suspended ceiling) for this space (measured from top of slab below to bottom of slab above). To be provided only if the space has a constant height.",
    spec_ref: spec("Height"), constant_only: true,
  },
  height_slabs: {
    id: "space.height.slabs@1", target: `${Q}.Height`, kind: "length",
    method: "spodok dosky nad - vrch dosky pod v pôdoryse miestnosti",
    definition: "Total height ... (measured from top of slab below to bottom of slab above). To be provided only if the space has a constant height.",
    spec_ref: spec("Height"), constant_only: true,
  },
  ffh: {
    id: "space.ffh.covering@1", target: `${Q}.FinishFloorHeight`, kind: "length",
    method: "vrch podlahoviny (IfcCovering FLOORING) - spodok telesa miestnosti",
    definition: "Height of the flooring (from base slab without flooring to the flooring height). To be provided only if the space has a constant flooring height.",
    spec_ref: spec("FinishFloorHeight"), constant_only: true,
  },
  fch: {
    id: "space.fch.covering@2", target: `${Q}.FinishCeilingHeight`, kind: "length",
    method: "spodok podhľadu (IfcCovering CEILING) - vrch podlahoviny; pri viacerých výškach podhľadu nález (pravidlo konštantnosti)",
    definition: "Height of the suspended ceiling (from top of flooring to the bottom of the suspended ceiling). To be provided only if the space has a suspended ceiling with constant height.",
    spec_ref: spec("FinishCeilingHeight"), constant_only: true,
  },
  gross_floor_area: {
    id: "space.area.profile@1", target: `${Q}.GrossFloorArea`, kind: "area",
    method: "plocha profilu telesa (vonkajšie slučky mínus diery)",
    definition: "Sum of all floor areas covered by the space. It includes the area covered by elementsinside the space (columns, inner walls, etc.) and excludes the area covered by wall claddings.",
    spec_ref: spec("GrossFloorArea"),
  },
  gross_perimeter: {
    id: "space.perimeter.profile@1", target: `${Q}.GrossPerimeter`, kind: "length",
    method: "obvod vonkajších slučiek profilu",
    definition: "Gross perimeter at the floor level of this space. It all sides of the space, including those parts of the perimeter that are created by virtual boundaries and openings (like doors).",
    spec_ref: spec("GrossPerimeter"),
  },
  gross_volume: {
    id: "space.volume.prism@1", target: `${Q}.GrossVolume`, kind: "volume",
    method: "plocha profilu x výška extrúzie (hranol)",
    definition: "Gross volume enclosed by the space, including the volume of construction elements inside the space.",
    spec_ref: spec("GrossVolume"),
  },
  net_volume: {
    id: "space.netvolume.coverings@1", target: `${Q}.NetVolume`, kind: "volume",
    method: "GrossVolume - prieniky krytín (FLOORING, CEILING) s telesom miestnosti, prizmaticky (podľa schémy); žltá, keď sedí len metóda 'krytiny po celej ploche miestnosti' (Revit)",
    definition: "Net volume enclosed by the space, excluding the volume of construction elements inside the space.",
    spec_ref: spec("NetVolume"),
  },
} as const satisfies Record<string, QuantityMethod>;

export type SpaceMethodKey = keyof typeof SPACE_METHODS;
