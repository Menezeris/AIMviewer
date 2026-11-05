import { extractPropertiesOnDemand, extractTypePropertiesOnDemand, type IfcDataStore } from "@ifc-lite/parser";
import { EntityNode } from "@ifc-lite/query";

import { requestIfcModels } from "../project/request-models";
import type { MeasureSegment } from "../viewer-measure";
import { MAX_MEASURE_SEGMENTS } from "../viewer-measure";
import { NET_FLOOR_AREA, REGISTRY_VERSION } from "../verify/quantity-methods";
import type { VerificationResultWrite } from "../verify/types";

import { joinToAim } from "./join";
import { parseBoolean } from "./load-bearing";
import { meshMetrics, meshModel, type MeshElement } from "./measure";
import { toWorld } from "./measure-dimension";
import { openEngineSession, type EngineModel } from "./session";
import { bodyFromMeshTriangles, dimensionPoint, extractExtrusions, verifySpace, type Body, type Element, type Opening, type RecipeResult, type SpaceInput, type Status } from "./space-verify";
import { ENGINE_VERSION, IFC_GUID_RE, InputError, guidIndex, modelsFor, revisionStamp, str, type EngineDeps } from "./tools";

/**
 * `ifc_measure verify=true` (D-185): overenie výmer IfcSpace voči geometrii. Pre každú miestnosť z `a` / `items`
 * vráti pri každej veličine Qto_SpaceBaseQuantities hodnotu zo súboru, hodnotu z geometrie, stav
 * (green / yellow / red / grey), metódu, definíciu zo schémy, použitú toleranciu, vzorec s dosadenými číslami
 * a kotvy. Pravidlá sú v registri `lib/verify/quantity-methods.ts`. `show=true` nakreslí zvislé kóty
 * (MEASURE_SHOW, D-124), `save=true` uloží beh k revízii (`verification_runs`, D-183 bod 11).
 */

export const MAX_SPACES = 50;
const SLAB_TYPES = ["IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE"];
const COVERING_TYPES = ["IFCCOVERING"];
/** Kóty vedľa seba v ťažisku miestnosti, aby sa neprekrývali (m). */
const DIMENSION_STEP_M = 0.3;

interface ModelData {
  scale: number;
  bodies: Map<number, Body>;
  spaces: number[];
  slabs: Element[];
  coverings: Element[];
  /** NetFloorArea: stĺpy, steny a vstavky (`NET_FLOOR_AREA`). */
  inner: Element[];
  /** NetFloorArea: otvory vyrezávajúce dosky. */
  slabOpenings: Opening[];
}

const cache = new WeakMap<IfcDataStore, Promise<ModelData>>();

const enumOf = (v: unknown) => (typeof v === "string" ? v.replace(/\./g, "").toUpperCase() : "");
const ids = (store: IfcDataStore, types: string[]) => types.flatMap((t) => store.entityIndex.byType.get(t) ?? []);

function element(store: IfcDataStore, id: number, body: Body): Element {
  const node = new EntityNode(store, id);
  const predefined = enumOf(node.allAttributes().find((a) => a.name === "PredefinedType")?.value);
  const ifcType = (store.entities.getTypeName(id) || "").toUpperCase();
  return {
    globalId: store.entities.getGlobalId(id) || String(id),
    name: store.entities.getName(id) || store.entities.getGlobalId(id) || String(id),
    body,
    ...(predefined ? { predefinedType: predefined } : {}),
    ...(ifcType ? { ifcType } : {}),
  };
}

type Sets = Array<{ name: string; properties: Array<{ name: string; value: unknown }> }>;

/**
 * Vstavka (NET_FLOOR_AREA.built_in_property): `Pset_FurnitureTypeCommon.IsBuiltIn` = TRUE na výskyte, inak na type
 * (IfcRelDefinesByType, HasPropertySets typu; dedenie ako `load-bearing.ts`). Bez hodnoty alebo pri chybe čítania nie.
 */
export function isBuiltIn(store: IfcDataStore, id: number): boolean {
  const { pset, name } = NET_FLOOR_AREA.built_in_property;
  const pick = (sets: Sets | undefined) => parseBoolean(sets?.find((x) => x.name === pset)?.properties.find((p) => p.name === name)?.value);
  try {
    const own = pick(extractPropertiesOnDemand(store, id) as Sets);
    if (own !== null) return own;
    return pick(extractTypePropertiesOnDemand(store, id)?.properties as Sets | undefined) === true;
  } catch {
    return false;
  }
}

/** Prvky NetFloorArea modelu: triedy `NET_FLOOR_AREA.element_types` a nábytok s IsBuiltIn. */
function innerIds(store: IfcDataStore): number[] {
  return [...ids(store, [...NET_FLOOR_AREA.element_types]), ...ids(store, [...NET_FLOOR_AREA.built_in_types]).filter((id) => isBuiltIn(store, id))];
}

/** Otvory dosiek (IfcRelVoidsElement): id otvoru -> GlobalId dosky. */
function slabOpeningIds(store: IfcDataStore, slabIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const sl of slabIds) {
    const host = store.entities.getGlobalId(sl) || String(sl);
    for (const o of new EntityNode(store, sl).voids()) out.set(o.expressId, host);
  }
  return out;
}

/** Teleso z meshu motora (náhrada za extrúziu): trojuholníky v IFC svete, uzavretosť a objem z `meshMetrics`. */
export function meshBody(expressId: number, e: MeshElement): Body {
  const { closed, volume } = meshMetrics(e.positions, e.indices);
  const tris = new Float64Array(e.indices.length * 3);
  for (let t = 0; t < e.indices.length; t++) {
    const i = e.indices[t] * 3;
    const w = toWorld(e, [e.positions[i], e.positions[i + 1], e.positions[i + 2]]);
    tris[t * 3] = w[0];
    tris[t * 3 + 1] = w[1];
    tris[t * 3 + 2] = w[2];
  }
  return bodyFromMeshTriangles(expressId, tris, closed, volume);
}

/** Extrúzie miestností, dosiek, krytín, prvkov NetFloorArea a otvorov dosiek modelu raz na store (ako tesselácia v measure.ts). */
export function modelData(m: EngineModel): Promise<ModelData> {
  const hit = cache.get(m.store);
  if (hit) return hit;
  const p = (async () => {
    const store = m.store;
    if (!store.source || store.source.byteLength === 0) throw new Error(`Model ${m.id} nemá zdrojové bajty.`);
    const spaces = ids(store, ["IFCSPACE"]);
    const slabIds = ids(store, SLAB_TYPES);
    const covIds = ids(store, COVERING_TYPES);
    const inner = innerIds(store);
    const openingHost = slabOpeningIds(store, slabIds);
    const all = [...new Set([...spaces, ...slabIds, ...covIds, ...inner, ...openingHost.keys()])];
    const { bodies, lengthUnitScale } = await store.source.withMaterializedAsync((bytes) => extractExtrusions(bytes, all));
    for (const id of all) if (!bodies.has(id)) bodies.set(id, { expressId: id, prisms: [], unsupported: "bez extrúzie" });
    // Náhrada telesa (D-185 oprava): prvky bez použiteľnej extrúzie dostanú teleso z uzavretého meshu motora.
    const needMesh = all.filter((id) => !bodies.get(id)!.prisms.length);
    if (needMesh.length) {
      const meshes = await meshModel(m);
      for (const id of needMesh) {
        const gid = store.entities.getGlobalId(id);
        const e = gid ? meshes.get(gid) : undefined;
        const prev = bodies.get(id)!;
        if (!e) {
          bodies.set(id, { ...prev, unsupported: `${prev.unsupported ?? "bez extrúzie"}; bez meshu` });
          continue;
        }
        const fallback = meshBody(id, e);
        // Pri neuzavretom meshi nesie dôvod oboje: prečo nie extrúzia a že mesh nie je uzavretý (OPEN_MESH_RULE).
        bodies.set(id, { ...fallback, unsupported: fallback.unsupported ? `${prev.unsupported ?? "bez extrúzie"}; ${fallback.unsupported}` : prev.unsupported });
      }
    }
    const of = (id: number) => bodies.get(id)!;
    return {
      scale: lengthUnitScale,
      bodies,
      spaces,
      slabs: slabIds.map((id) => element(store, id, of(id))),
      coverings: covIds.map((id) => element(store, id, of(id))),
      inner: inner.map((id) => element(store, id, of(id))),
      slabOpenings: [...openingHost].map(([id, host]) => ({ ...element(store, id, of(id)), host })),
    };
  })();
  cache.set(m.store, p);
  p.catch(() => cache.delete(m.store));
  return p;
}

const qsetMethods = new WeakMap<IfcDataStore, Map<string, string>>();

/** `IfcElementQuantity.MethodOfMeasurement` podľa GlobalId sady (stĺpcový store ho v `quantities()` nenesie). */
function methodOfMeasurement(store: IfcDataStore, qsetGlobalId: string | undefined): string | undefined {
  if (!qsetGlobalId) return undefined;
  let map = qsetMethods.get(store);
  if (!map) {
    map = new Map();
    for (const id of store.entityIndex.byType.get("IFCELEMENTQUANTITY") ?? []) {
      // GlobalId sady nie je v stĺpcovom store (getGlobalId vráti ""), EntityNode ho dočíta zo zdroja.
      const node = new EntityNode(store, id);
      const v = node.allAttributes().find((a) => a.name === "MethodOfMeasurement")?.value;
      const gid = node.globalId;
      if (gid && typeof v === "string" && v.trim()) map.set(gid, v.trim());
    }
    qsetMethods.set(store, map);
  }
  return map.get(qsetGlobalId);
}

/**
 * Qto_SpaceBaseQuantities miestnosti v m / m2 / m3, vzorce zo súboru (IfcQuantity*.Formula) a MethodOfMeasurement sady
 * (len informačne, detail veličiny vo vieweri).
 */
export function spaceQuantities(store: IfcDataStore, id: number, scale: number): { qto: Record<string, number>; formulas: Record<string, string>; method_of_measurement?: string } {
  const qto: Record<string, number> = {};
  const formulas: Record<string, string> = {};
  let method: string | undefined;
  for (const set of new EntityNode(store, id).quantities()) {
    if (set.name !== "Qto_SpaceBaseQuantities") continue;
    method ??= methodOfMeasurement(store, set.globalId);
    for (const q of set.quantities) {
      if (!Number.isFinite(q.value)) continue;
      // QuantityType: 0 dĺžka (jednotky súboru), 1 plocha, 2 objem (m2, m3 v našich súboroch).
      qto[q.name] = q.type === 0 ? Math.round(q.value * scale * 1e9) / 1e9 : q.value;
      if (q.formula) formulas[q.name] = q.formula;
    }
  }
  return { qto, formulas, ...(method ? { method_of_measurement: method } : {}) };
}

function counts(results: RecipeResult[]): Record<Status, number> {
  const c: Record<Status, number> = { green: 0, yellow: 0, red: 0, grey: 0 };
  for (const r of results) c[r.status]++;
  return c;
}

/** Zvislé kóty dĺžkových receptov v ťažisku pôdorysu, posunuté vedľa seba; najviac MAX_MEASURE_SEGMENTS. */
export function spaceDimensions(space: SpaceInput, results: RecipeResult[]): MeasureSegment[] {
  const c = dimensionPoint(space);
  if (!c) return [];
  // Height zo súborových dosiek, ak ich recept našiel; inak z vlastného telesa (dve kóty tej istej výšky nekreslíme).
  const bySlabs = results.find((r) => r.recipe.startsWith("space.height.slabs") && r.dimension);
  const picked = results.filter((r) => r.dimension && !(bySlabs && r.recipe.startsWith("space.height.own")));
  return picked.map((r, i) => ({
    a: { x: c[0] + i * DIMENSION_STEP_M, y: c[1], z: r.dimension!.z0 },
    b: { x: c[0] + i * DIMENSION_STEP_M, y: c[1], z: r.dimension!.z1 },
  }));
}

/** Overená miestnosť: vstup, výsledky receptov a údaje zo súboru (vzorce, MethodOfMeasurement). */
export interface VerifiedSpace {
  model: EngineModel;
  space: SpaceInput;
  results: RecipeResult[];
  formulas: Record<string, string>;
  method_of_measurement?: string;
}

/** Riadky `verification_results` jednej miestnosti (aj bunky, vysvetlenie a údaje zo súboru v `inputs`). */
export function resultRows(v: VerifiedSpace, revision: number | null): VerificationResultWrite[] {
  return v.results.map((r) => {
    const q = r.target.split(".")[1];
    const fileMeta = {
      ...(v.method_of_measurement ? { method_of_measurement: v.method_of_measurement } : {}),
      ...(v.formulas[q] ? { formula: v.formulas[q] } : {}),
    };
    return {
      model: v.model.id,
      revision,
      global_id: v.space.globalId,
      element_name: v.space.name,
      target: r.target,
      recipe: r.recipe,
      status: r.status,
      file_value: r.file ?? null,
      computed_value: r.computed ?? null,
      method: r.method,
      definition: r.definition,
      spec_ref: r.spec_ref,
      tolerance: r.tolerance,
      formula: r.formula ?? null,
      note: r.note ?? null,
      distinct_heights: r.distinct_heights ?? null,
      anchors: r.anchors,
      explanation: r.explanation,
      inputs: { ...(r.expression ? { expression: r.expression } : {}), cells: r.cells ?? [], ...(Object.keys(fileMeta).length ? { file_meta: fileMeta } : {}) },
    };
  });
}

/** Overí miestnosti podľa polohy v modeli (bez stropu počtu; strop drží volajúci). */
export async function verifyLocated(located: Array<{ m: EngineModel; id: number }>): Promise<VerifiedSpace[]> {
  const out: VerifiedSpace[] = [];
  for (const { m, id } of located) {
    const data = await modelData(m);
    const { qto, formulas, method_of_measurement } = spaceQuantities(m.store, id, data.scale);
    const space: SpaceInput = { ...element(m.store, id, data.bodies.get(id) ?? { expressId: id, prisms: [], unsupported: "bez telesa" }), qto };
    const results = verifySpace(space, { slabs: data.slabs, coverings: data.coverings, inner: data.inner, slabOpenings: data.slabOpenings });
    out.push({ model: m, space, results, formulas, ...(method_of_measurement ? { method_of_measurement } : {}) });
  }
  return out;
}

/**
 * Uloženie behu k revízii (D-183 bod 11): beh bez známej revízie každého použitého modelu sa neukladá.
 * Vráti objekt `saved` pre výstup toolu aj host routes.
 */
export async function saveVerification(
  deps: Pick<EngineDeps, "verification">,
  rows: VerificationResultWrite[],
  stamp: Record<string, number>,
  usedModels: string[],
  allCounts: Record<Status, number>,
  author: string | null,
): Promise<Record<string, unknown>> {
  if (!deps.verification) return { ok: false, error: "úložisko overenia nie je nastavené" };
  if (usedModels.some((m) => typeof stamp[m] !== "number")) return { ok: false, error: "revízia modelu nie je známa (podpis vstupu D-183), beh sa neukladá" };
  try {
    const { id, without_inputs } = await deps.verification.saveRun(
      { scope: "IfcSpace", registry_version: REGISTRY_VERSION, engine: ENGINE_VERSION, model_revisions: stamp, counts: allCounts, author },
      rows,
    );
    return { ok: true, run_id: id, model_revisions: stamp, ...(without_inputs ? { note: "bunky vzorca sa neuložili (migrácia verification_inputs nie je aplikovaná)" } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), note: "výpočet platí, beh sa neuložil (migrácia verification_results nemusí byť aplikovaná)" };
  }
}

export { counts as statusCounts };

/**
 * Host (D-185 UI, `/api/verify/*`): overí miestnosti podľa IFC GlobalId v modeloch federácie, alebo všetky IfcSpace
 * všetkých modelov (`guids` = null, "run_all"). Bez stropu MAX_SPACES (ten drží len tool); vráti aj podpis revízie.
 */
export async function verifySpacesByGuid(guids: string[] | null, deps: EngineDeps): Promise<{ verified: VerifiedSpace[]; stamp: Record<string, number>; used: string[] }> {
  const modelIds = (deps.sources ?? requestIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const located: Array<{ m: EngineModel; id: number }> = [];
  if (guids === null) {
    for (const m of models) for (const id of ids(m.store, ["IFCSPACE"])) located.push({ m, id });
  } else {
    const session = await openEngineSession(models);
    const where = new Map<string, { m: EngineModel; id: number }>();
    for (const m of models) {
      const idx = await guidIndex(session, m);
      for (const g of guids) {
        const id = idx.get(g);
        if (!where.has(g) && id !== undefined) where.set(g, { m, id });
      }
    }
    const notIn = guids.filter((g) => !where.has(g));
    if (notIn.length) throw new InputError(`Prvok ${notIn.join(", ")} nie je v modeloch federácie (${modelIds.join(", ")}).`);
    const notSpace = guids.filter((g) => (where.get(g)!.m.store.entities.getTypeName(where.get(g)!.id) || "").toUpperCase() !== "IFCSPACE");
    if (notSpace.length) throw new InputError(`Overenie výmer je zatiaľ len pre miestnosti (IfcSpace): ${notSpace.join(", ")} nie je IfcSpace.`);
    located.push(...guids.map((g) => where.get(g)!));
  }
  const used = [...new Set(located.map((l) => l.m.id))];
  const verified = await verifyLocated(located);
  return { verified, stamp: revisionStamp(revision, used), used };
}

export async function ifcVerifySpaces(input: Record<string, unknown>, deps: EngineDeps, dimensions?: MeasureSegment[]): Promise<string> {
  const a = str(input.a);
  const list = Array.isArray(input.items) ? input.items.map((v) => str(v)).filter(Boolean) : [];
  if (str(input.b)) throw new InputError("verify overuje miestnosti jednotlivo: zadaj a alebo items, bez b.");
  if (input.qto === true || input.clear_opening === true || input.axis !== undefined || input.face_a !== undefined || input.route !== undefined) {
    throw new InputError("verify sa nekombinuje s qto, clear_opening, axis, face_a/face_b ani route.");
  }
  const targets = [...new Set([a, ...list].filter(Boolean))];
  if (targets.length === 0) throw new InputError("verify: zadaj a alebo items (IfcSpace: číslo miestnosti, object_ref alebo IFC GlobalId).");
  if (targets.length > MAX_SPACES) throw new InputError(`verify: najviac ${MAX_SPACES} miestností naraz.`);

  const refs = targets.filter((t) => !IFC_GUID_RE.test(t));
  const resolved = refs.length > 0 ? await deps.resolveTargets(refs) : new Map<string, string>();
  const guidFor = (t: string) => (IFC_GUID_RE.test(t) ? t : resolved.get(t));
  const missing = targets.filter((t) => !guidFor(t));
  if (missing.length > 0) throw new InputError(`Bez IFC GUID v AIM: ${missing.join(", ")} - zadaj IFC GlobalId (napr. z ifc_query).`);

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  const where = new Map<string, { m: EngineModel; id: number }>();
  for (const m of models) {
    const idx = await guidIndex(session, m);
    for (const t of targets) {
      const g = guidFor(t)!;
      const id = idx.get(g);
      if (!where.has(g) && id !== undefined) where.set(g, { m, id });
    }
  }
  const notIn = targets.filter((t) => !where.has(guidFor(t)!));
  if (notIn.length > 0) throw new InputError(`Nie je v ${modelIds.join("/")}: ${notIn.join(", ")}.`);
  const notSpace = targets.filter((t) => {
    const w = where.get(guidFor(t)!)!;
    return (w.m.store.entities.getTypeName(w.id) || "").toUpperCase() !== "IFCSPACE";
  });
  if (notSpace.length > 0) throw new InputError(`verify zatiaľ overuje len miestnosti (IfcSpace): ${notSpace.join(", ")} nie je IfcSpace.`);

  const joined = await joinToAim(
    targets.map((t) => {
      const w = where.get(guidFor(t)!)!;
      return { global_id: guidFor(t)!, model: w.m.id, ifc_type: "IfcSpace", name: w.m.store.entities.getName(w.id) || null, input: t };
    }),
    deps.lookup,
  );
  const ident = new Map(joined.items.map(({ input: key, aim_url, ...rest }) => {
    void aim_url;
    return [key as string, rest];
  }));

  const used = [...new Set([...where.values()].map((w) => w.m))];
  const stamp = revisionStamp(revision, used.map((m) => m.id));
  const rows: VerificationResultWrite[] = [];
  const spaces = [];
  const all: RecipeResult[] = [];
  const verified = await verifyLocated(targets.map((t) => where.get(guidFor(t)!)!));
  for (const [i, t] of targets.entries()) {
    const v = verified[i];
    const { space, results, formulas } = v;
    all.push(...results);
    if (dimensions) for (const s of spaceDimensions(space, results)) if (dimensions.length < MAX_MEASURE_SEGMENTS) dimensions.push(s);
    spaces.push({
      ...ident.get(t),
      counts: counts(results),
      ...(Object.keys(formulas).length ? { file_formulas: formulas } : {}),
      results: results.map(({ dimension, explanation, cells, ...r }) => {
        void dimension;
        void explanation;
        void cells;
        return r;
      }),
    });
    rows.push(...resultRows(v, stamp[v.model.id] ?? null));
  }

  const out: Record<string, unknown> = {
    engine: ENGINE_VERSION,
    source: "extrúzie IfcExtrudedAreaSolid (@ifc-lite/geometry extractExtrusionDefinitions, bez tesselácie); bez použiteľnej extrúzie uzavretý mesh motora (method to uvádza); IFC svet v m",
    registry_version: REGISTRY_VERSION,
    revision: Object.fromEntries(used.map((m) => [m.id, revision[m.id]])),
    counts: counts(all),
    spaces,
  };
  if (input.save === true) out.saved = await saveVerification(deps, rows, stamp, used.map((m) => m.id), counts(all), str(input.author) || null);
  out.show_in_3d = joined.show_in_3d;
  if (dimensions) out.view = dimensions.length > 0 ? `kóty vo vieweri: ${dimensions.length} (výška, podlaha, podhľad v ťažisku miestnosti)` : "nič na kótovanie";
  out.note =
    "status: green = v tolerancii, yellow = sedí iná známa metóda (NetVolume Revit) alebo chýba hodnota, ktorú schéma žiada (FinishFloorHeight pri konštantnej podlahovine), red = nesedí alebo vlastnosť nie je " +
    "jednoznačná (viac výšok), grey = nedá sa overiť (dôvod v note). Hodnoty v m, m2, m3. Pravidlá a tolerancie: register " +
    "metód (registry_version). Červené nálezy patria autorovi cez BCF (bcf_topic), do IFC sa nič nezapisuje.";
  return JSON.stringify(out);
}
