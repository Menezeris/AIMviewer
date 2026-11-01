/**
 * Register metód výmer (D-185): JEDINÉ miesto, kde sú záväzné pravidlá overovača výmer voči
 * geometrii. Číta ho kód (lib/engine/space-verify.ts) a výsledok overenia z neho nesie pri každej
 * hodnote metódu, definíciu zo schémy a použitú toleranciu, aby ich videl používateľ vo vieweri.
 * Dokumenty (DECISIONS.md D-185, docs/research) sem odkazujú, pravidlá nekopírujú.
 *
 * Zdroj definícií: buildingSMART/IFC4.3.x-development `d71e140` (2026-10-29),
 * reference_schemas/psd/Qto_SpaceBaseQuantities.xml a psd_IFC4_ADD2_TC1 (text v oboch rovnaký).
 */

export const REGISTRY_VERSION = 3;

export const SPEC_REF = {
  repo: "buildingSMART/IFC4.3.x-development",
  commit: "d71e140",
  qto_space: "reference_schemas/psd/Qto_SpaceBaseQuantities.xml",
  qto_space_ifc4: "reference_schemas/psd_IFC4_ADD2_TC1/Qto_SpaceBaseQuantities.xml",
  ifc_space: "docs/schemas/core/IfcProductExtension/Entities/IfcSpace.md",
} as const;

// ── tolerancie (Samuel 1. 11. 2026: schválené) ───────────────────────────────

export type QuantityKind = "length" | "perimeter" | "area" | "volume";

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
  /**
   * Obvod (Samuel 1. 11. 2026, po druhom behu): súčet mnohých hrán, pri meshi zaokrúhlených na mm, preto relatívne
   * 0,05 %, najmenej 5 mm (druhý beh: odchýlky 6 až 23 mm pri obvode 63 až 93 m = 0,01 až 0,04 %).
   */
  perimeter: { kind: "perimeter", abs: 0.005, rel: 0.0005, text: "obvod +- 0,05 %, najmenej +- 5 mm" },
  area: { kind: "area", abs: null, rel: 0.005, text: "plocha +- 0,5 %" },
  volume: { kind: "volume", abs: 0.05, rel: 0.005, text: "objem +- 0,5 % alebo +- 0,05 m3" },
};

export function withinTolerance(file: number, computed: number, kind: QuantityKind): boolean {
  const t = TOLERANCES[kind];
  const d = Math.abs(computed - file);
  return (t.abs != null && d <= t.abs) || (t.rel != null && d <= t.rel * Math.abs(file));
}

/**
 * NetVolume (Samuel 1. 11. 2026): tolerancia viazaná na odčítaný objem, najviac 1 % z GrossVolume - NetVolume
 * zo súboru. Pri 0,5 % z objemu miestnosti by sa pri tenkých krytinách nerozlíšila metóda podľa schémy od Revit
 * metódy "krytiny po celej ploche" (testovací model: rozdiel 0,2 m3 pri 333 m3). `epsilon_m3` pokrýva len zaokrúhlenie
 * hodnôt v súbore (4 desatinné miesta), nie metódu.
 */
export const NET_VOLUME_TOLERANCE = { rel_of_cut: 0.01, epsilon_m3: 0.0005 } as const;

export function netVolumeTolerance(grossVolumeFile: number, netVolumeFile: number): { abs_m3: number; text: string } {
  const cut = Math.abs(grossVolumeFile - netVolumeFile);
  const abs = NET_VOLUME_TOLERANCE.rel_of_cut * cut + NET_VOLUME_TOLERANCE.epsilon_m3;
  const fmt = (x: number) => (Math.round(x * 10000) / 10000).toString().replace(".", ",");
  return { abs_m3: abs, text: `objem NetVolume +- 1 % z GrossVolume - NetVolume (${fmt(cut)} m3) = +- ${fmt(abs)} m3` };
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
  /** Prienik pôdorysov menší než toto (m2) sa nepočíta: dotyk hranou, nie prekryv (D-185 oprava). */
  min_overlap_m2: 1e-4,
} as const;

/**
 * Krytiny, ktoré NetVolume odčíta (D-185 oprava B3): len podlahovina a podhľad. Izolácia (INSULATION), strešné
 * vrstvy (ROOFING) a obklady vnútri telesa miestnosti sa neodčítajú; Revit ich v NetVolume tiež neodčíta.
 */
export const NET_VOLUME_COVERINGS: readonly string[] = ["FLOORING", "CEILING"];

/**
 * Náhrada telesa (D-185 oprava): keď extrúzia chýba alebo ju ifc-lite odmietne, teleso je uzavretý mesh motora:
 * pôdorys = priemet plôch s normálou nadol, objem divergenciou, obvod = hrany pôdorysu bez suseda. Sivá len
 * keď mesh nie je uzavretý. Prvok, z ktorého časť extrúzie chýba, sa nepočíta z časti (celý ide na mesh).
 */
export const BODY_FALLBACK = { mesh_requires_closed: true, open_mesh: "plan_and_height_only" } as const;

/**
 * Neuzavretý mesh (D-185 doplnok 2, Samuel 1. 11. 2026): prvok, ktorého profil ifc-lite odmietne a mesh nie je
 * uzavretý (druhý beh: 15 miestností a ich dosky, BCF #21), dá aspoň pôdorys z plôch s normálou nadol a výškový
 * rozsah z vrcholov. Ako referencia (doska, podlahovina, podhľad) sa použije normálne. Pri miestnosti: výška, plocha
 * a obvod sú zelené pri zhode, pri nesúlade SIVÉ (pôdorys môže byť neúplný, nález by nebol spoľahlivý);
 * GrossVolume a NetVolume sivé (objem neuzavretého meshu nie je definovaný).
 */
export const OPEN_MESH_RULE = {
  id: "open-mesh@1",
  text: "neuzavretý mesh: výška, pôdorys a obvod len potvrdia zhodu (nesúlad = sivá), objem sa neoveruje",
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

/**
 * FinishFloorHeight chýba v súbore, hoci podlahovina v pôdoryse má jednu výšku (Samuel 1. 11. 2026): schéma hodnotu
 * pri konštantnej výške žiada ("to be provided only if ... constant"), preto žltá, nie sivá ani červená.
 */
export const FFH_ABSENT_RULE = {
  id: "ffh-absent@1",
  text: "súbor FinishFloorHeight neuvádza, hoci podlahovina má v pôdoryse miestnosti jednu výšku; schéma ju pri konštantnej výške žiada",
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
    id: "space.height.slabs@2", target: `${Q}.Height`, kind: "length",
    method: "spodok dosky nad - vrch dosky pod v pôdoryse miestnosti",
    definition: "Total height ... (measured from top of slab below to bottom of slab above). To be provided only if the space has a constant height.",
    spec_ref: spec("Height"), constant_only: true,
  },
  ffh: {
    id: "space.ffh.covering@3", target: `${Q}.FinishFloorHeight`, kind: "length",
    method: "vrch podlahoviny (IfcCovering FLOORING) - spodok telesa miestnosti; hodnota chýba pri konštantnej podlahovine = žltá (FFH_ABSENT_RULE)",
    definition: "Height of the flooring (from base slab without flooring to the flooring height). To be provided only if the space has a constant flooring height.",
    spec_ref: spec("FinishFloorHeight"), constant_only: true,
  },
  fch: {
    id: "space.fch.covering@3", target: `${Q}.FinishCeilingHeight`, kind: "length",
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
    id: "space.perimeter.profile@2", target: `${Q}.GrossPerimeter`, kind: "perimeter",
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
    id: "space.netvolume.coverings@3", target: `${Q}.NetVolume`, kind: "volume",
    method: "GrossVolume - objem krytín (FLOORING, CEILING) vnútri telesa miestnosti: súčet cez dvojice telies prienik pôdorysov x prekryv výšok (extrúzie presne, uzavretý mesh krytiny prenásobený plnosťou meshu); len NET_VOLUME_COVERINGS; žltá, keď sedí len metóda 'krytiny po celej ploche miestnosti' (Revit); tolerancia NET_VOLUME_TOLERANCE; sivá, keď krytina v pôdoryse nemá teleso",
    definition: "Net volume enclosed by the space, excluding the volume of construction elements inside the space.",
    spec_ref: spec("NetVolume"),
  },
} as const satisfies Record<string, QuantityMethod>;

export type SpaceMethodKey = keyof typeof SPACE_METHODS;
