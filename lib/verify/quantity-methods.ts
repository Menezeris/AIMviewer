/**
  * Registry of quantity methods (D-185): the ONLY place where the binding rules of the quantity verifier against
  * the geometry live. The code reads it (lib/engine/space-verify.ts) and the verification result carries from it, for every
  * value, the method, the definition from the schema and the tolerance used, so that the user sees them in the viewer.
  * Documents (DECISIONS.md D-185, docs/research) refer here, they do not copy the rules.
 *
  * Source of the definitions: buildingSMART/IFC4.3.x-development `d71e140` (2026-10-29),
  * reference_schemas/psd/Qto_SpaceBaseQuantities.xml and psd_IFC4_ADD2_TC1 (the text is the same in both).
 */

export const REGISTRY_VERSION = 4;

export const SPEC_REF = {
  repo: "buildingSMART/IFC4.3.x-development",
  commit: "d71e140",
  qto_space: "reference_schemas/psd/Qto_SpaceBaseQuantities.xml",
  qto_space_ifc4: "reference_schemas/psd_IFC4_ADD2_TC1/Qto_SpaceBaseQuantities.xml",
  ifc_space: "docs/schemas/core/IfcProductExtension/Entities/IfcSpace.md",
} as const;

// ── tolerances (Samuel 1. 11. 2026: approved) ───────────────────────────────

export type QuantityKind = "length" | "perimeter" | "area" | "volume";

export interface ToleranceRule {
  kind: QuantityKind;
    /** Absolute tolerance in m / m2 / m3 (null = not used). */
  abs: number | null;
    /** Relative tolerance (a share of the value from the file, null = not used). */
  rel: number | null;
    /** Text for the user. */
  text: string;
}

/** A value is within tolerance when it meets at least one of the limits (abs or rel). */
export const TOLERANCES: Record<QuantityKind, ToleranceRule> = {
  length: { kind: "length", abs: 0.005, rel: null, text: "dĺžka +- 5 mm" },
  /**
      * Perimeter (Samuel 1. 11. 2026, after the second run): a sum of many edges, rounded to mm for a mesh, hence relative
      * 0.05 %, at least 5 mm (second run: deviations of 6 to 23 mm at a perimeter of 63 to 93 m = 0.01 to 0.04 %).
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
  * NetVolume (Samuel 1. 11. 2026): tolerance tied to the subtracted volume, at most 1 % of GrossVolume - NetVolume
  * from the file. At 0.5 % of the space volume the schema method could not be distinguished from the Revit
  * method "coverings over the whole area" for thin coverings (test model: a difference of 0.2 m3 at 333 m3). `epsilon_m3` covers only the rounding
  * of the values in the file (4 decimal places), not the method.
 */
export const NET_VOLUME_TOLERANCE = { rel_of_cut: 0.01, epsilon_m3: 0.0005 } as const;

export function netVolumeTolerance(grossVolumeFile: number, netVolumeFile: number): { abs_m3: number; text: string } {
  const cut = Math.abs(grossVolumeFile - netVolumeFile);
  const abs = NET_VOLUME_TOLERANCE.rel_of_cut * cut + NET_VOLUME_TOLERANCE.epsilon_m3;
  const fmt = (x: number) => (Math.round(x * 10000) / 10000).toString().replace(".", ",");
  return { abs_m3: abs, text: `objem NetVolume +- 1 % z GrossVolume - NetVolume (${fmt(cut)} m3) = +- ${fmt(abs)} m3` };
}

// ── element selection rules ───────────────────────────────────────────────

export const SELECTION = {
    /** Slab below / above: the share of the space footprint that it must cover. */
  slab_min_overlap: 0.5,
    /** Floor covering: the share of the space footprint. */
  flooring_min_overlap: 0.5,
    /** Ceiling: the share of the footprint from which the ceiling height counts as another space height. */
  ceiling_min_overlap: 0.1,
    /** Surface contact (slab - space body) in m. */
  contact_m: 0.005,
    /** An intersection of footprints smaller than this (m2) is not counted: an edge contact, not an overlap (D-185 fix). */
  min_overlap_m2: 1e-4,
} as const;

/**
  * Coverings that NetVolume subtracts (D-185 fix B3): only the floor covering and the ceiling. Insulation (INSULATION), roof
  * layers (ROOFING) and claddings inside the space body are not subtracted; Revit does not subtract them in NetVolume either.
 */
export const NET_VOLUME_COVERINGS: readonly string[] = ["FLOORING", "CEILING"];

/**
  * Body substitute (D-185 fix): when the extrusion is missing or ifc-lite rejects it, the body is the engine's closed mesh:
  * footprint = projection of faces with a downward normal, volume by divergence, perimeter = footprint edges without a neighbour. Grey only
  * when the mesh is not closed. An element with a missing part of the extrusion is not computed from the part (all of it goes to the mesh).
 */
export const BODY_FALLBACK = { mesh_requires_closed: true, open_mesh: "plan_and_height_only" } as const;

/**
  * Unclosed mesh (D-185 addendum 2, Samuel 1. 11. 2026): an element whose profile ifc-lite rejects and the mesh is not
  * closed (second run: 15 spaces and their slabs, BCF #21) yields at least the footprint from faces with a downward normal and the height
  * range from the vertices. It is used normally as a reference (slab, floor covering, ceiling). For a space: height, area
  * and perimeter are green on a match, GREY on a mismatch (the footprint may be incomplete, a finding would not be reliable);
  * GrossVolume and NetVolume grey (the volume of an unclosed mesh is not defined).
 */
export const OPEN_MESH_RULE = {
  id: "open-mesh@1",
  text: "neuzavretý mesh: výška, pôdorys a obvod len potvrdia zhodu (nesúlad = sivá), objem sa neoveruje",
} as const;

/**
  * NetFloorArea (Samuel 3. 11. 2026: "as per the IFC schema", D-185 addendum 4): from GrossFloorArea (footprint of the space body) the
  * footprint of elements inside the space and the openings in the slab below it are subtracted. The schema names "columns, inner walls, built-in's etc.,
  * slab openings, or other protruding elements"; the registry translates this into the classes below.
  * - `element_types`: columns, walls and built-ins. Built-in = IfcBuildingElementProxy and IfcChimney always, IfcFurniture /
  *   IfcFurnishingElement only with `Pset_FurnitureTypeCommon.IsBuiltIn` = TRUE (on the occurrence or the type); free-standing furniture no.
  *   A staircase, a railing and curtain-wall elements (IfcCurtainWall, IfcPlate, IfcMember) are not subtracted, the schema does not name them.
  * - An element is "inside" when its footprint intersects the space footprint (an intersection above `min_overlap_m2`, an edge contact does not) and in height
  *   it protrudes above the finished floor (top of the floor covering, without it the bottom of the space body) into the band `floor_band_m` above it; a wall
  *   of the storey below the space that ends in the floor assembly (ASR 2.01: SN07.01.0014 up to the top of the floor covering) does not count, nor does a beam under
  *   the ceiling.
  * - Openings in the slab: an IfcOpeningElement that cuts the slab below the space (top of the slab at the bottom of the space +- `contact_m`),
  *   and holes in the profile of that slab; both only within the space footprint.
  * - An overlap of subtracted elements (a column in a wall, an opening under a column) is not subtracted twice: an element cell carries only the part that
  *   the element before it did not subtract (exactly for pairs, a triple overlap is not corrected).
  * - Height is not taken into account (schema: "no reduction for areas under a minimum headroom").
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
    /** Band above the finished floor (m) that the element must reach in height. */
  floor_band_m: 1.0,
} as const;

/**
  * NetFloorArea without slab openings (D-185 addendum 4, a proposal like NetVolume "coverings over the whole area"): the file does not match
  * the computation per the schema, but it matches when the slab openings are not subtracted (Revit does not reduce the space area by slab openings;
  * ASR v79: stairwell spaces 2.20 and 4.06). Yellow, not red: the method is known, not a model error.
 */
export const NFA_OPENINGS_RULE = {
  id: "nfa-openings@1",
  text: "sedí len bez odčítania otvorov v doske (Revit plochu miestnosti o otvory v doske nezmenšuje); schéma ich odčíta",
} as const;

// ── constancy rule (Samuel 1. 11. 2026: per the schema text) ─────────

/**
  * Schema: Height, FinishFloorHeight and FinishCeilingHeight "to be provided only if ... constant".
  * The schema allows splitting a space (IfcSpace CompositionType PARTIAL via IfcRelAggregates).
  * Therefore with several heights in the space footprint:
  * - the value in the file IS present  -> red, finding "the property is not unambiguous, the space has N heights"
  *   (BCF for OCB: remove the value, or split the space into partial spaces);
  * - the value in the file is NOT present -> green ("correctly omitted, the height is not constant").
  * No weighted median or average.
 */
export const NON_CONSTANT_RULE = {
  id: "non-constant@1",
  text: "Výška nie je v pôdoryse miestnosti konštantná; schéma hovorí 'to be provided only if constant'. Hodnotu z modelu odstrániť, alebo miestnosť rozdeliť na čiastkové priestory (IfcSpace PARTIAL).",
} as const;

/**
  * FinishFloorHeight is missing in the file although the floor covering in the footprint has a single height (Samuel 1. 11. 2026): the schema
  * asks for the value at a constant height ("to be provided only if ... constant"), hence yellow, not grey or red.
 */
export const FFH_ABSENT_RULE = {
  id: "ffh-absent@1",
  text: "súbor FinishFloorHeight neuvádza, hoci podlahovina má v pôdoryse miestnosti jednu výšku; schéma ju pri konštantnej výške žiada",
} as const;

// ── IfcSpace quantity methods ────────────────────────────────────────────

export interface QuantityMethod {
    /** Recipe with a version (changes when the computation changes). */
  id: string;
    /** The Pset.Quantity it verifies. */
  target: string;
  kind: QuantityKind;
    /** What is measured from the geometry (for the user). */
  method: string;
    /** Verbatim definition from the schema. */
  definition: string;
  spec_ref: string;
    /** The constancy rule applies. */
  constant_only?: boolean;
    /** How it is computed, 1 to 2 sentences in Slovak for a person (quantity detail in the viewer, D-185 UI). */
  explanation: string;
    /** Cross-check computation: does not determine the quantity status, in the viewer it is under the main recipe (Height: own body). */
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

// ── display in the viewer (D-185 UI): order, main recipe, units ─────────

/** Rodina receptu bez verzie: `space.height.slabs@2` -> `space.height.slabs`. */
export const recipeFamily = (recipe: string) => recipe.split("@")[0];

/** Registry method by recipe (also an older version of the same family); null = a recipe outside the registry. */
export function methodOfRecipe(recipe: string): QuantityMethod | null {
  const fam = recipeFamily(recipe);
  return Object.values(SPACE_METHODS).find((m) => recipeFamily(m.id) === fam) ?? null;
}

/**
  * Order of the quantity recipes: the main one first (determines the status), the cross-check (`check`) after it. Height: `space.height.slabs` main,
  * `space.height.own` cross-check (Samuel 2. 11. 2026). Recipes outside the registry go last.
 */
export function recipeRank(recipe: string): number {
  const all = Object.values(SPACE_METHODS) as QuantityMethod[];
  const i = all.findIndex((m) => recipeFamily(m.id) === recipeFamily(recipe));
  if (i < 0) return 1000;
  return (all[i].check ? 100 : 0) + i;
}

/** Order of the Qto_SpaceBaseQuantities quantities in the detail (as in the registry). */
export function targetRank(target: string): number {
  const order = [...new Set((Object.values(SPACE_METHODS) as QuantityMethod[]).map((m) => m.target))];
  const i = order.indexOf(target);
  return i < 0 ? 1000 : i;
}

export const UNIT_OF_KIND: Record<QuantityKind, "m" | "m2" | "m3"> = { length: "m", perimeter: "m", area: "m2", volume: "m3" };

/** Numeric tolerance in the quantity unit for a value from the file (the larger of the abs and rel limits, as `withinTolerance`). */
export function toleranceAbs(kind: QuantityKind, file: number): number | null {
  const t = TOLERANCES[kind];
  const parts = [t.abs, t.rel != null ? t.rel * Math.abs(file) : null].filter((x): x is number => x != null);
  return parts.length ? Math.round(Math.max(...parts) * 1e6) / 1e6 : null;
}
