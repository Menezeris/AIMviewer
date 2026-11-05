import { requestIfcModels } from "../project/request-models";

import { joinToAim } from "./join";
import { openEngineSession, type EngineSession } from "./session";
import { ENGINE_VERSION, InputError, clamp, modelsFor, str, structured, type EngineDeps } from "./tools";

/**
 * `ifc_material_layers` (D-108): elements whose material contains the searched
 * material or category - also as one layer of a composite assembly
 * (IfcMaterialLayerSet), a constituent (ConstituentSet) or a profile (ProfileSet),
 * including a material inherited from the type. An adapter over upstream `query_entities` and
 * `get_entities_bulk` with `include: ["materials"]` (D-087); upstream has no filter
 * by material (it rejects `material=` in the selector).
 */

const MAX_RESULT_CHARS = 30_000;
const PAGE = 10_000;
const BULK = 1000;
/** Traversal ceiling: the whole ASR has thousands of elements, this is protection against a mistake. */
const MAX_SCANNED = 50_000;
const DEFAULT_TYPES = ["IfcElement"];

/** Material member as returned by `bim.materials()` (MaterialInfo from `@ifc-lite/parser`). */
interface Member {
  materialName?: string;
  name?: string;
  category?: string;
  materialCategory?: string;
  thickness?: number;
  fraction?: number;
}

export interface MaterialInfo {
  type?: string;
  name?: string;
  category?: string;
  layers?: Member[];
  profiles?: Member[];
  constituents?: Member[];
  materials?: Array<{ name: string; category?: string }>;
}

export interface MatchedMember {
  /** Order in the layer / constituent / profile from 1 (missing for a single material). */
  position?: number;
  material: string | null;
  name?: string;
  category?: string;
  thickness?: number;
  fraction?: number;
}

/** Without diacritics and case: "Tepelná izolácia" ~ "izolacia". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const hits = (needle: string, values: Array<string | undefined>): boolean =>
  values.some((v) => typeof v === "string" && foldText(v).includes(needle));

/**
 * Material members that match the searched text (material, layer name
 * or category of the layer or material). An empty array = the element does not match.
 * A match on the name of the whole assembly returns all its members.
 */
export function matchMaterial(mat: MaterialInfo | null | undefined, needle: string): MatchedMember[] {
  if (!mat || !needle) return [];
  const groups: Array<Member[] | undefined> = [mat.layers, mat.constituents, mat.profiles];
  const out: MatchedMember[] = [];
  const setHit = hits(needle, [mat.name, mat.category]);
  for (const members of groups) {
    if (!Array.isArray(members)) continue;
    members.forEach((m, i) => {
      if (!setHit && !hits(needle, [m.materialName, m.name, m.category, m.materialCategory])) return;
      out.push({
        position: i + 1,
        material: m.materialName ?? null,
        ...(m.name ? { name: m.name } : {}),
        ...(m.category ?? m.materialCategory ? { category: m.category ?? m.materialCategory } : {}),
        ...(typeof m.thickness === "number" ? { thickness: m.thickness } : {}),
        ...(typeof m.fraction === "number" ? { fraction: m.fraction } : {}),
      });
    });
  }
  if (Array.isArray(mat.materials)) {
    mat.materials.forEach((m, i) => {
      if (setHit || hits(needle, [m.name, m.category])) {
        out.push({ position: i + 1, material: m.name, ...(m.category ? { category: m.category } : {}) });
      }
    });
  }
  if (out.length === 0 && mat.type === "Material" && setHit) {
    out.push({ material: mat.name ?? null, ...(mat.category ? { category: mat.category } : {}) });
  }
  return out;
}

/** Assembly name for the summary: the set name, otherwise the material, otherwise the set type. */
function setName(mat: MaterialInfo): string {
  return mat.name ?? mat.type ?? "(bez názvu)";
}

interface BulkEntity {
  globalId?: string;
  name?: string;
  type?: string;
  materials?: MaterialInfo | null;
}

async function expressIdsOf(session: EngineSession, modelId: string, types: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = structured<{ truncated?: boolean; entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { model_id: modelId, types, limit: PAGE, offset, fields: ["globalId"] }),
    );
    for (const e of res.entities ?? []) ids.push(e.expressId);
    if (ids.length > MAX_SCANNED) throw new InputError(`Priveľa prvkov (${ids.length}+) - zúž ifc_types.`);
    if (!res.truncated) return ids;
  }
}

export async function ifcMaterialLayers(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const query = str(input.material);
  const needle = foldText(query);
  if (needle.length < 2) throw new InputError("Zadaj material (aspoň 2 znaky), napr. izol, EPS, minerál, betón.");
  const rawTypes = Array.isArray(input.ifc_types) ? input.ifc_types : input.ifc_types === undefined ? [] : [input.ifc_types];
  const types = rawTypes.map((t) => str(t)).filter((t) => /^Ifc[A-Za-z0-9]+$/.test(t));
  const limit = clamp(input.limit, 1, 500, 100);
  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);

  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  type Row = { global_id: string; model: string; ifc_type: string; name: string | null; set: string; layers: MatchedMember[] };
  const rows: Row[] = [];
  const bySet = new Map<string, { count: number; layers: Map<string, number | undefined> }>();
  let scanned = 0;
  for (const m of models) {
    const ids = await expressIdsOf(session, m.id, types.length ? types : DEFAULT_TYPES);
    scanned += ids.length;
    for (let i = 0; i < ids.length; i += BULK) {
      const res = structured<{ entities?: Record<string, BulkEntity> }>(
        await session.call("get_entities_bulk", { model_id: m.id, express_ids: ids.slice(i, i + BULK), include: ["materials"] }),
      );
      for (const [gid, e] of Object.entries(res.entities ?? {})) {
        const matched = matchMaterial(e.materials, needle);
        if (matched.length === 0 || !e.materials) continue;
        const set = setName(e.materials);
        rows.push({ global_id: gid, model: m.id, ifc_type: e.type ?? "", name: e.name ?? null, set, layers: matched });
        const agg = bySet.get(set) ?? { count: 0, layers: new Map<string, number | undefined>() };
        agg.count++;
        for (const l of matched) agg.layers.set(l.material ?? l.name ?? "?", l.thickness);
        bySet.set(set, agg);
      }
    }
  }

  const sets = [...bySet.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([set, a]) => ({
      set,
      count: a.count,
      matched_layers: [...a.layers.entries()].map(([material, thickness]) => ({ material, ...(thickness !== undefined ? { thickness } : {}) })),
    }));
  // GUIDs for 3D go for all found elements, not only the listed ones (the 3D tool ceiling applies separately).
  const joined = await joinToAim(rows, deps.lookup);
  const text = JSON.stringify({
    engine: ENGINE_VERSION,
    material: query,
    models: modelIds,
    revision,
    ifc_types: types.length ? types : DEFAULT_TYPES,
    scanned,
    total: rows.length,
    sets,
    items: joined.items.slice(0, limit),
    ...(rows.length > limit ? { truncated: true, note: `Vypísaných ${limit} z ${rows.length}; sets a show_in_3d platia pre všetky.` } : {}),
    show_in_3d: joined.show_in_3d,
  });
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `... [orezané, ${text.length} znakov - zníž limit alebo zúž ifc_types]`;
}
