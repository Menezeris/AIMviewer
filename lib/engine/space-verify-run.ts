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
 * `ifc_measure verify=true` (D-185): verification of IfcSpace quantities against geometry. For every space from `a` / `items`
 * it returns for each Qto_SpaceBaseQuantities quantity the value from the file, the value from geometry, the status
 * (green / yellow / red / grey), the method, the definition from the schema, the tolerance used, a formula with substituted numbers
 * and anchors. The rules are in the registry `lib/verify/quantity-methods.ts`. `show=true` draws vertical dimensions
 * (MEASURE_SHOW, D-124), `save=true` stores the run for a revision (`verification_runs`, D-183 point 11).
 */

export const MAX_SPACES = 50;
const SLAB_TYPES = ["IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE"];
const COVERING_TYPES = ["IFCCOVERING"];
/** Dimensions side by side at the space centroid so that they do not overlap (m). */
const DIMENSION_STEP_M = 0.3;

interface ModelData {
  scale: number;
  bodies: Map<number, Body>;
  spaces: number[];
  slabs: Element[];
  coverings: Element[];
  /** NetFloorArea: columns, walls and built-ins (`NET_FLOOR_AREA`). */
  inner: Element[];
  /** NetFloorArea: openings cutting slabs. */
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
 * Built-in (NET_FLOOR_AREA.built_in_property): `Pset_FurnitureTypeCommon.IsBuiltIn` = TRUE on the occurrence, otherwise on the type
 * (IfcRelDefinesByType, HasPropertySets of the type; inheritance like `load-bearing.ts`). Without a value or on a read error no.
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

/** NetFloorArea elements of a model: classes `NET_FLOOR_AREA.element_types` and furniture with IsBuiltIn. */
function innerIds(store: IfcDataStore): number[] {
  return [...ids(store, [...NET_FLOOR_AREA.element_types]), ...ids(store, [...NET_FLOOR_AREA.built_in_types]).filter((id) => isBuiltIn(store, id))];
}

/** Slab openings (IfcRelVoidsElement): opening id -> slab GlobalId. */
function slabOpeningIds(store: IfcDataStore, slabIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const sl of slabIds) {
    const host = store.entities.getGlobalId(sl) || String(sl);
    for (const o of new EntityNode(store, sl).voids()) out.set(o.expressId, host);
  }
  return out;
}

/** Solid from the engine mesh (substitute for an extrusion): triangles in the IFC world, closedness and volume from `meshMetrics`. */
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

/** Extrusions of spaces, slabs, coverings, NetFloorArea elements and slab openings of a model once per store (like tessellation in measure.ts). */
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
    // Solid substitute (D-185 fix): elements without a usable extrusion get a solid from the closed engine mesh.
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
        // For an open mesh the reason carries both: why not an extrusion and that the mesh is not closed (OPEN_MESH_RULE).
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

/** `IfcElementQuantity.MethodOfMeasurement` by the GlobalId of the set (the column store does not carry it in `quantities()`). */
function methodOfMeasurement(store: IfcDataStore, qsetGlobalId: string | undefined): string | undefined {
  if (!qsetGlobalId) return undefined;
  let map = qsetMethods.get(store);
  if (!map) {
    map = new Map();
    for (const id of store.entityIndex.byType.get("IFCELEMENTQUANTITY") ?? []) {
      // The GlobalId of the set is not in the column store (getGlobalId returns ""), EntityNode reads it from the source.
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
 * Qto_SpaceBaseQuantities of a space in m / m2 / m3, formulas from the file (IfcQuantity*.Formula) and MethodOfMeasurement of the set
 * (informational only, quantity detail in the viewer).
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
      // QuantityType: 0 length (file units), 1 area, 2 volume (m2, m3 in our files).
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

/** Vertical dimensions of length recipes at the plan centroid, shifted side by side; at most MAX_MEASURE_SEGMENTS. */
export function spaceDimensions(space: SpaceInput, results: RecipeResult[]): MeasureSegment[] {
  const c = dimensionPoint(space);
  if (!c) return [];
  // Height from file slabs if the recipe found them; otherwise from its own solid (we do not draw two dimensions of the same height).
  const bySlabs = results.find((r) => r.recipe.startsWith("space.height.slabs") && r.dimension);
  const picked = results.filter((r) => r.dimension && !(bySlabs && r.recipe.startsWith("space.height.own")));
  return picked.map((r, i) => ({
    a: { x: c[0] + i * DIMENSION_STEP_M, y: c[1], z: r.dimension!.z0 },
    b: { x: c[0] + i * DIMENSION_STEP_M, y: c[1], z: r.dimension!.z1 },
  }));
}

/** A verified space: input, recipe results and data from the file (formulas, MethodOfMeasurement). */
export interface VerifiedSpace {
  model: EngineModel;
  space: SpaceInput;
  results: RecipeResult[];
  formulas: Record<string, string>;
  method_of_measurement?: string;
}

/** Rows of `verification_results` of one space (also cells, explanation and data from the file in `inputs`). */
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

/** Verifies spaces by position in the model (without a count ceiling; the ceiling is held by the caller). */
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
 * Storing a run for a revision (D-183 point 11): a run without a known revision of each used model is not stored.
 * Returns the `saved` object for the tool output and the host routes.
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
 * Host (D-185 UI, `/api/verify/*`): verifies spaces by IFC GlobalId in federation models, or all IfcSpace
 * of all models (`guids` = null, "run_all"). Without the MAX_SPACES ceiling (held only by the tool); also returns the revision signature.
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
