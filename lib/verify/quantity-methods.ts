/**
 * Register metód výmer (D-185): JEDINÉ miesto, kde sú záväzné pravidlá overovača výmer voči
 * geometrii. Číta ho kód (lib/engine/space-verify.ts) a výsledok overenia z neho nesie pri každej
 * hodnote metódu, definíciu zo schémy a použitú toleranciu, aby ich videl používateľ vo vieweri.
 * Dokumenty (DECISIONS.md D-185, docs/research) sem odkazujú, pravidlá nekopírujú.
 *
 * Zdroj definícií: buildingSMART/IFC4.3.x-development `d71e140` (2026-10-29),
 * reference_schemas/psd/Qto_SpaceBaseQuantities.xml a psd_IFC4_ADD2_TC1 (text v oboch rovnaký).
 */

export const REGISTRY_VERSION = 4;

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

/**
 * NetFloorArea (Samuel 3. 11. 2026: "podľa IFC schémy", D-185 dodatok 4): z GrossFloorArea (pôdorys telesa miestnosti) sa
 * odčíta pôdorys prvkov vnútri miestnosti a otvory v doske pod ňou. Schéma menuje "columns, inner walls, built-in's etc.,
 * slab openings, or other protruding elements"; register to prekladá na triedy nižšie.
 * - `element_types`: stĺpy, steny a vstavky. Vstavka = IfcBuildingElementProxy a IfcChimney vždy, IfcFurniture /
 *   IfcFurnishingElement len s `Pset_FurnitureTypeCommon.IsBuiltIn` = TRUE (na výskyte alebo type); voľný nábytok nie.
 *   Schodisko, zábradlie a prvky obvodového plášťa (IfcCurtainWall, IfcPlate, IfcMember) sa neodčítajú, schéma ich nemenuje.
 * - Prvok je "vnútri", keď jeho pôdorys pretína pôdorys miestnosti (prienik nad `min_overlap_m2`, dotyk hranou nie) a výškou
 *   vyčnieva nad hotovú podlahu (vrch podlahoviny, bez nej spodok telesa miestnosti) do pásma `floor_band_m` nad ňou; stena
 *   podlažia pod miestnosťou, ktorá končí v skladbe podlahy (ASR 2.01: SN07.01.0014 po vrch podlahoviny), ani trám pod
 *   stropom nie.
 * - Otvory v doske: IfcOpeningElement, ktorý vyrezáva dosku pod miestnosťou (vrch dosky na spodku miestnosti +- `contact_m`),
 *   a diery v profile tej dosky; obe len v rozsahu pôdorysu miestnosti.
 * - Prekryv odčítaných prvkov (stĺp v stene, otvor pod stĺpom) sa neodčíta dvakrát: bunka prvku nesie len časť, ktorú
 *   neodčítal prvok pred ním (presne pre dvojice, trojnásobný prekryv sa neopravuje).
 * - Výška sa neberie do úvahy (schéma: "no reduction for areas under a minimum headroom").
 */
export const NET_FLOOR_AREA = {
  element_types: [
    "IFCCOLUMN", "IFCCOLUMNSTANDARDCASE",
    "IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE",
    "IFCBUILDINGELEMENTPROXY", "IFCCHIMNEY",
  ],
  /** Vstavky len s `Pset_FurnitureTypeCommon.IsBuiltIn` = TRUE. */
  built_in_types: ["IFCFURNITURE", "IFCFURNISHINGELEMENT"],
  built_in_property: { pset: "Pset_FurnitureTypeCommon", name: "IsBuiltIn" },
  /** Pásmo nad hotovou podlahou (m), do ktorého musí prvok výškou zasahovať. */
  floor_band_m: 1.0,
} as const;

/**
 * NetFloorArea bez otvorov v doske (D-185 dodatok 4, návrh ako NetVolume "krytiny po celej ploche"): súbor sa nezhoduje
 * s výpočtom podľa schémy, ale zhoduje sa, keď sa otvory v doske neodčítajú (Revit plochu miestnosti o otvory v doske
 * nezmenšuje; ASR v79: schodiskové priestory 2.20 a 4.06). Žltá, nie červená: metóda je známa, nie chyba modelu.
 */
export const NFA_OPENINGS_RULE = {
  id: "nfa-openings@1",
  text: "sedí len bez odčítania otvorov v doske (Revit plochu miestnosti o otvory v doske nezmenšuje); schéma ich odčíta",
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
  /** Ako sa počíta, 1 až 2 vety po slovensky pre človeka (detail veličiny vo vieweri, D-185 UI). */
  explanation: string;
  /** Kontrolný výpočet: neurčuje stav veličiny, vo vieweri je pod hlavným receptom (Height: vlastné teleso). */
  check?: true;
}

const Q = "Qto_SpaceBaseQuantities";
const spec = (name: string) => `${SPEC_REF.repo}@${SPEC_REF.commit}:${SPEC_REF.qto_space}#${name}`;

export const SPACE_METHODS = {
  height_own: {
    id: "space.height.own@1", target: `${Q}.Height`, kind: "length",
    method: "vrch - spodok vlastného telesa miestnosti (Body)",
    definition: "Total height (from base slab without flooring to ceiling without suspended ceiling) for this space (measured from top of slab below to bottom of slab above). To be provided only if the space has a constant height.",
    spec_ref: spec("Height"), constant_only: true,
    explanation: "Kontrolný výpočet: výška vlastného telesa miestnosti v modeli, od jeho spodku po vrch. Stav veličiny neurčuje, len ukáže, či teleso miestnosti sedí s doskami.",
    check: true,
  },
  height_slabs: {
    id: "space.height.slabs@2", target: `${Q}.Height`, kind: "length",
    method: "spodok dosky nad - vrch dosky pod v pôdoryse miestnosti",
    definition: "Total height ... (measured from top of slab below to bottom of slab above). To be provided only if the space has a constant height.",
    spec_ref: spec("Height"), constant_only: true,
    explanation: "Výška miestnosti je vzdialenosť od vrchu dosky pod miestnosťou po spodok dosky nad ňou, meraná v jej pôdoryse (definícia schémy).",
  },
  ffh: {
    id: "space.ffh.covering@3", target: `${Q}.FinishFloorHeight`, kind: "length",
    method: "vrch podlahoviny (IfcCovering FLOORING) - spodok telesa miestnosti; hodnota chýba pri konštantnej podlahovine = žltá (FFH_ABSENT_RULE)",
    definition: "Height of the flooring (from base slab without flooring to the flooring height). To be provided only if the space has a constant flooring height.",
    spec_ref: spec("FinishFloorHeight"), constant_only: true,
    explanation: "Výška podlahy je vzdialenosť od spodku miestnosti (vrch nosnej dosky) po vrch podlahoviny v jej pôdoryse. Uvádza sa len vtedy, keď má podlahovina jednu výšku.",
  },
  fch: {
    id: "space.fch.covering@3", target: `${Q}.FinishCeilingHeight`, kind: "length",
    method: "spodok podhľadu (IfcCovering CEILING) - vrch podlahoviny; pri viacerých výškach podhľadu nález (pravidlo konštantnosti)",
    definition: "Height of the suspended ceiling (from top of flooring to the bottom of the suspended ceiling). To be provided only if the space has a suspended ceiling with constant height.",
    spec_ref: spec("FinishCeilingHeight"), constant_only: true,
    explanation: "Výška podhľadu je vzdialenosť od vrchu podlahoviny po spodok podhľadu nad miestnosťou. Uvádza sa len vtedy, keď má podhľad v pôdoryse miestnosti jednu výšku.",
  },
  gross_floor_area: {
    id: "space.area.profile@1", target: `${Q}.GrossFloorArea`, kind: "area",
    method: "plocha profilu telesa (vonkajšie slučky mínus diery)",
    definition: "Sum of all floor areas covered by the space. It includes the area covered by elementsinside the space (columns, inner walls, etc.) and excludes the area covered by wall claddings.",
    spec_ref: spec("GrossFloorArea"),
    explanation: "Hrubá plocha podlahy je plocha pôdorysu telesa miestnosti vrátane plochy stĺpov a priečok vnútri; diery v profile sa odčítajú.",
  },
  net_floor_area: {
    id: "space.netfloorarea.profile@1", target: `${Q}.NetFloorArea`, kind: "area",
    method: "GrossFloorArea (plocha profilu telesa) - pôdorys prvkov vnútri miestnosti (stĺpy, steny, vstavky; NET_FLOOR_AREA) - otvory v doske pod miestnosťou, každé len v rozsahu pôdorysu miestnosti a bez dvojitého odčítania prekryvu; žltá, keď sedí len bez odčítania otvorov v doske (NFA_OPENINGS_RULE); nesúlad pri prvku s otvormi (CSG) alebo bez telesa = sivá",
    definition: "Sum of all usable floor areas covered by the space. It excludes the area covered  by elements inside the space (columns, inner walls, built-in's etc.), slab openings, or other protruding elements. Varying heights are not taking into account (i.e. no reduction for areas under a minimum headroom).",
    spec_ref: spec("NetFloorArea"),
    explanation: "Čistá plocha podlahy je hrubá plocha podlahy mínus pôdorys stĺpov, stien a vstaviek vnútri miestnosti a otvorov v doske pod ňou, každé len tam, kde leží v pôdoryse miestnosti. Výška miestnosti sa neberie do úvahy.",
  },
  gross_perimeter: {
    id: "space.perimeter.profile@2", target: `${Q}.GrossPerimeter`, kind: "perimeter",
    method: "obvod vonkajších slučiek profilu",
    definition: "Gross perimeter at the floor level of this space. It all sides of the space, including those parts of the perimeter that are created by virtual boundaries and openings (like doors).",
    spec_ref: spec("GrossPerimeter"),
    explanation: "Hrubý obvod je dĺžka vonkajšej hranice pôdorysu telesa miestnosti vrátane úsekov pri dverách a virtuálnych hraníc.",
  },
  gross_volume: {
    id: "space.volume.prism@1", target: `${Q}.GrossVolume`, kind: "volume",
    method: "plocha profilu x výška extrúzie (hranol)",
    definition: "Gross volume enclosed by the space, including the volume of construction elements inside the space.",
    spec_ref: spec("GrossVolume"),
    explanation: "Hrubý objem je plocha pôdorysu telesa miestnosti krát výška jeho extrúzie (hranol); pri telese z meshu je to objem uzavretého meshu.",
  },
  net_volume: {
    id: "space.netvolume.coverings@3", target: `${Q}.NetVolume`, kind: "volume",
    method: "GrossVolume - objem krytín (FLOORING, CEILING) vnútri telesa miestnosti: súčet cez dvojice telies prienik pôdorysov x prekryv výšok (extrúzie presne, uzavretý mesh krytiny prenásobený plnosťou meshu); len NET_VOLUME_COVERINGS; žltá, keď sedí len metóda 'krytiny po celej ploche miestnosti' (Revit); tolerancia NET_VOLUME_TOLERANCE; sivá, keď krytina v pôdoryse nemá teleso",
    definition: "Net volume enclosed by the space, excluding the volume of construction elements inside the space.",
    spec_ref: spec("NetVolume"),
    explanation: "Čistý objem je hrubý objem miestnosti mínus objem podlahovín a podhľadov vnútri jej telesa (prienik pôdorysov krát prekryv výšok).",
  },
} as const satisfies Record<string, QuantityMethod>;

export type SpaceMethodKey = keyof typeof SPACE_METHODS;

// ── zobrazenie vo vieweri (D-185 UI): poradie, hlavný recept, jednotky ─────────

/** Rodina receptu bez verzie: `space.height.slabs@2` -> `space.height.slabs`. */
export const recipeFamily = (recipe: string) => recipe.split("@")[0];

/** Metóda registra podľa receptu (aj staršej verzie tej istej rodiny); null = recept mimo registra. */
export function methodOfRecipe(recipe: string): QuantityMethod | null {
  const fam = recipeFamily(recipe);
  return Object.values(SPACE_METHODS).find((m) => recipeFamily(m.id) === fam) ?? null;
}

/**
 * Poradie receptov veličiny: hlavný prvý (určuje stav), kontrolné (`check`) za ním. Height: `space.height.slabs` hlavný,
 * `space.height.own` kontrolný (Samuel 2. 11. 2026). Recepty mimo registra idú na koniec.
 */
export function recipeRank(recipe: string): number {
  const all = Object.values(SPACE_METHODS) as QuantityMethod[];
  const i = all.findIndex((m) => recipeFamily(m.id) === recipeFamily(recipe));
  if (i < 0) return 1000;
  return (all[i].check ? 100 : 0) + i;
}

/** Poradie veličín Qto_SpaceBaseQuantities v detaile (ako v registri). */
export function targetRank(target: string): number {
  const order = [...new Set((Object.values(SPACE_METHODS) as QuantityMethod[]).map((m) => m.target))];
  const i = order.indexOf(target);
  return i < 0 ? 1000 : i;
}

export const UNIT_OF_KIND: Record<QuantityKind, "m" | "m2" | "m3"> = { length: "m", perimeter: "m", area: "m2", volume: "m3" };

/** Číselná tolerancia v jednotke veličiny pre hodnotu zo súboru (väčšia z hraníc abs a rel, ako `withinTolerance`). */
export function toleranceAbs(kind: QuantityKind, file: number): number | null {
  const t = TOLERANCES[kind];
  const parts = [t.abs, t.rel != null ? t.rel * Math.abs(file) : null].filter((x): x is number => x != null);
  return parts.length ? Math.round(Math.max(...parts) * 1e6) / 1e6 : null;
}
