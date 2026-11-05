import { modelKey } from "../data/ifc-models";
import { requestIfcModels } from "../project/request-models";
import type { AskAction } from "../llm/actions";
import { MAX_MEASURE_SEGMENTS, noteDimensions, resetDimensionTally, type MeasureSegment } from "../viewer-measure";
import type { Vec3 } from "./measure";

import { cacheSnapshot, engineKey, engineRevision, getStore, type EngineModelSource } from "./cache";
import type { ClashBcfPort, ClashStore } from "../clash/types";
import type { VerificationStore } from "../verify/types";
import type { ClashViewerDeps } from "../clash/viewer-tool";
import { idsSources, loadIds } from "./ids-sources";
import { resultRows } from "../ids/runs";
import type { IdsStore } from "../ids/types";
import { execPassthroughTool } from "./passthrough";
import { passthroughName } from "./passthrough-defs";
import { joinToAim, type GuidLookup } from "./join";
import { ifcMaterialLayers } from "./materials";
import { ifcRelations } from "./relations";
import { revisionsFor, type ModelRevisionRow, type RevisionSource } from "./revisions";
import {
  SEARCH_FIELDS,
  exactNameHits,
  idsOfTypes,
  looksLikeCode,
  nameIndex,
  nameKey,
  searchEntities,
  searchIndex,
  type SearchField,
} from "./search";
import { openEngineSession, type EngineModel, type EngineSession, type EngineToolResult } from "./session";
import { resolveStorey } from "./storey";
import { MODEL_ACTIONS, OPS, QUERY_MODES, type ModelAction } from "./tool-defs";

/**
 * IFC engine tools for the MCP connector (D-084, phase 1): `ifc_*` over the IFC files
 * of the federation via `@ifc-lite/mcp`, results linked to the AIM graph via GUID.
 * Read only. They answer what is in the file (also what the ETL did not import),
 * numeric comparisons of pset values and an ad hoc IDS check; questions about the AIM graph
 * (documents, responsibilities, stored IDS runs) belong to the DB tools.
 */

const MAX_RESULT_CHARS = 20_000;
export const ENGINE_VERSION = "@ifc-lite/mcp@0.27.0";
/** Operators that the selector also supports (further `where` conditions besides the first). */
const SELECTOR_OPS = new Set(["=", "!=", ">", "<", ">=", "<="]);
const BULK_PAGE = 1000;
const NAME_RE = /^[A-Za-z0-9_]+$/;
export const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

/** The other end of a derived element <-> space link (D-167); `direction` is from the target's point of view as in `ifc_relations`. */
export interface SpatialLink {
  direction: "forward" | "inverse";
  global_id: string;
  ifc_type: string;
  name: string | null;
  role?: string;
}

export interface EngineDeps {
  sources?: () => EngineModelSource[];
  lookup: GuidLookup;
  resolveTargets: (targets: string[]) => Promise<Map<string, string>>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Model revisions from the DB (D-109); without it `ifc_models` does not return the revision. */
  revisions?: RevisionSource;
  /** IDS documents from the DB (D-162); without them `ifc_ids_validate` takes only `IDS_SOURCES`. */
  ids?: IdsStore;
  /** Element GUID -> system name from the AIM graph (D-164, `clash group_by=system`). */
  systems?: (guids: string[]) => Promise<Map<string, string>>;
  /** Derived IfcRelReferencedInSpatialStructure from the AIM graph (D-167); without them `ifc_relations` returns only edges from the file. */
  spatialLinks?: (guid: string) => Promise<SpatialLink[]>;
  /** Tests, runs and clash status from the DB (D-164); without them `clash save`, `compare`, `review` and `save=true` do not work. */
  clash?: ClashStore;
  /** BCF layer for `clash bcf create=true` (D-164, D-099). */
  bcf?: ClashBcfPort;
  /** Live viewer for `clash open` and `from_viewer` (D-164); without it these actions say the viewer is not set up. */
  clashViewer?: ClashViewerDeps;
  /** Ceilings of a `clash` run (D-164); tests only. */
  clashLimits?: { maxPairs?: number; budgetMs?: number };
  /** Storing a quantity verification run (D-185, `ifc_measure verify=true save=true`); without it the run is not stored. */
  verification?: VerificationStore;
}

export interface EngineExecution {
  content: string;
  isError: boolean;
  /** Commands for the live viewer (dimension `ifc_measure show`, D-124); the route sends them as actions of the DB tools. */
  actions?: AskAction[];
}

export class InputError extends Error {
  override name = "InputError";
}

export function clamp(raw: unknown, min: number, max: number, dflt: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : dflt;
  return Math.min(max, Math.max(min, n));
}

export function str(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function structured<T>(res: EngineToolResult): T {
  if (res.isError) {
    const text = res.content.map((c) => c.text ?? "").join(" ").trim();
    throw new Error(text || "Motor vrátil chybu.");
  }
  return (res.structuredContent ?? {}) as T;
}

interface Where {
  pset: string;
  name: string;
  op: string;
  value?: unknown;
  /** IFC attribute of the entity (OverallWidth, LongName...) instead of a pset (D-118). */
  attribute?: string;
}

function parseWhere(raw: unknown): Where[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new InputError("where musí byť pole podmienok.");
  if (raw.length > 3) throw new InputError("where má najviac 3 podmienky.");
  let psetIndex = 0;
  return raw.map((w) => {
    const o = (w ?? {}) as Record<string, unknown>;
    const op = str(o.op);
    if (!(OPS as readonly string[]).includes(op)) throw new InputError(`op musí byť jeden z ${OPS.join(" ")}.`);
    const attribute = str(o.attribute);
    if (attribute) {
      if (!NAME_RE.test(attribute)) throw new InputError("attribute smie obsahovať len písmená, číslice a _ (napr. OverallWidth).");
      if (op === "matches") throw new InputError("Atribút nevie op matches - použi contains.");
      if (op !== "exists" && o.value === undefined) throw new InputError(`Podmienka ${attribute} potrebuje value.`);
      return { pset: "", name: attribute, op, value: o.value, attribute };
    }
    const pset = str(o.pset);
    const name = str(o.name);
    if (!NAME_RE.test(pset) || !NAME_RE.test(name)) {
      throw new InputError("pset a name smú obsahovať len písmená, číslice a _ (napr. Qto_SpaceBaseQuantities), alebo zadaj attribute.");
    }
    const i = psetIndex++;
    if (i > 0 && !SELECTOR_OPS.has(op)) throw new InputError("Ďalšie podmienky na psety (okrem prvej) smú mať len = != > < >= <=.");
    if (op !== "exists" && o.value === undefined) throw new InputError(`Podmienka ${pset}.${name} potrebuje value.`);
    if (i > 0 && typeof o.value === "string" && /[,;"']/.test(o.value)) {
      throw new InputError("Hodnota ďalšej podmienky nesmie obsahovať , ; ani úvodzovky.");
    }
    return { pset, name, op, value: o.value };
  });
}

/** where -> query_entities arguments: the first condition on a pset as `property`, the others as a selector; attributes are filtered by `scanAttributes`. */
function whereArgs(all: Where[]): Record<string, unknown> {
  const where = all.filter((w) => !w.attribute);
  if (where.length === 0) return {};
  const [first, ...rest] = where;
  const out: Record<string, unknown> = {
    property: { pset: first.pset, name: first.name, op: first.op, ...(first.op === "exists" ? {} : { value: first.value }) },
  };
  if (rest.length > 0) out.selector = rest.map((w) => `${w.pset}.${w.name}${w.op}${String(w.value)}`).join(", ");
  return out;
}

const attributeConditions = (where: Where[]) => where.filter((w) => w.attribute);

/** Comparison of an IFC attribute value: numbers numerically, text case-insensitively. */
export function attributeMatches(actual: unknown, w: Pick<Where, "op" | "value">): boolean {
  const empty = actual === null || actual === undefined || actual === "";
  if (w.op === "exists") return !empty;
  if (empty) return w.op === "!=";
  const a = Number(actual);
  const b = Number(w.value);
  const numeric = typeof actual !== "boolean" && typeof w.value !== "boolean" && Number.isFinite(a) && Number.isFinite(b) && w.value !== "";
  const text = (v: unknown) => String(v).toLowerCase();
  switch (w.op) {
    case "=":
      return numeric ? a === b : text(actual) === text(w.value);
    case "!=":
      return numeric ? a !== b : text(actual) !== text(w.value);
    case "contains":
      return text(actual).includes(text(w.value));
    case ">":
      return numeric && a > b;
    case "<":
      return numeric && a < b;
    case ">=":
      return numeric && a >= b;
    case "<=":
      return numeric && a <= b;
    default:
      return false;
  }
}

/** Ceiling of candidates for the attribute filter (attributes are read by pages via get_entities_bulk). */
const MAX_ATTRIBUTE_SCAN = 20_000;

/**
 * Elements that also satisfy the conditions on IFC attributes (D-118). The upstream selector
 * does not know attributes, so the candidates from query_entities (classes, psets, storey)
 * are further filtered by `attributes` from get_entities_bulk.
 */
async function scanAttributes(
  session: EngineSession,
  baseArgs: Record<string, unknown>,
  conditions: Where[],
): Promise<Array<{ globalId?: string; type?: string; name?: string }>> {
  const out: Array<{ globalId?: string; type?: string; name?: string }> = [];
  for (let offset = 0; ; offset += BULK_PAGE) {
    const page = structured<{ count: number; truncated?: boolean; entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { ...baseArgs, limit: BULK_PAGE, offset, fields: ["globalId"] }),
    );
    if (page.count > MAX_ATTRIBUTE_SCAN) {
      throw new InputError(`Filter atribútov prejde najviac ${MAX_ATTRIBUTE_SCAN} prvkov (kandidátov je ${page.count}) - zúž ifc_types, storey alebo podmienku na pset.`);
    }
    const ids = (page.entities ?? []).map((e) => e.expressId);
    if (ids.length > 0) {
      const bulk = structured<{ entities: Record<string, { globalId?: string; type?: string; name?: string; attributes?: Array<{ name: string; value: unknown }> }> }>(
        await session.call("get_entities_bulk", { model_id: baseArgs.model_id, express_ids: ids, include: ["attributes"] }),
      );
      for (const e of Object.values(bulk.entities ?? {})) {
        const ok = conditions.every((w) => attributeMatches(e.attributes?.find((x) => x.name === w.attribute)?.value, w));
        if (ok) out.push({ globalId: e.globalId, type: e.type, name: e.name });
      }
    }
    if (!page.truncated) break;
  }
  return out;
}

function sanitizeTypes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((v) => str(v)).filter((v) => /^Ifc[A-Za-z0-9]+$/.test(v));
}

export async function modelsFor(ids: string[], deps: EngineDeps): Promise<{ models: EngineModel[]; revision: Record<string, unknown> }> {
  const all = (deps.sources ?? requestIfcModels)();
  const revision: Record<string, unknown> = {};
  const models: EngineModel[] = [];
  for (const id of ids) {
    const src = all.find((m) => m.id === id);
    if (!src) throw new InputError(`Model ${id} nie je vo federácii (${all.map((m) => m.id).join(", ")}).`);
    const { entry } = await getStore(src, { fetchImpl: deps.fetchImpl });
    models.push({ id: src.id, name: `${src.id}.ifc`, store: entry.store });
    revision[src.id] = engineRevision(entry);
  }
  return { models, revision };
}

/** Input signature (D-183) from `modelsFor().revision`: models with a known archive revision. */
export function revisionStamp(revision: Record<string, unknown>, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const r = (revision[id] as { revision?: unknown } | undefined)?.revision;
    if (typeof r === "number") out[id] = r;
  }
  return out;
}

function requireModel(input: Record<string, unknown>): string {
  const m = str(input.model);
  if (!m) throw new InputError("Zadaj model (napr. ASR alebo VZT).");
  return m;
}

export async function storeyGuid(session: EngineSession, modelId: string, label: string): Promise<string> {
  const res = structured<{ entities?: Array<{ globalId?: string; name?: string }> }>(
    await session.call("query_entities", { model_id: modelId, type: "IfcBuildingStorey", limit: 200 }),
  );
  const candidates = (res.entities ?? [])
    .filter((e) => e.globalId)
    .map((e) => ({ globalId: e.globalId as string, name: e.name ?? "" }));
  const gid = resolveStorey(label, candidates);
  if (!gid) {
    throw new InputError(
      `Podlažie '${label}' v modeli ${modelId} nie je. Dostupné: ${candidates.map((c) => c.name).join(", ")}.`,
    );
  }
  return gid;
}

function envelope(base: Record<string, unknown>): string {
  const text = JSON.stringify({ engine: ENGINE_VERSION, ...base });
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `... [orezané, ${text.length} znakov - zúž dotaz alebo limit]`;
}

async function ifcModels(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const loaded = new Map(cacheSnapshot().map((c) => [c.key, c]));
  const sources = (deps.sources ?? requestIfcModels)();
  const history = input.history === undefined ? 0 : clamp(input.history, 1, 20, 5);
  // Revision key = file name in the bucket (ASR.ifc -> ASR), not the model id (D-086).
  // Models from the DB carry their code (D-189/D-190: the path may be a container uuid); env overrides by file name.
  const keyOf = (m: { id: string; url: string; containerId?: string }) => (m.containerId ? m.id : (modelKey(m.url) ?? m.id));
  let rows: ModelRevisionRow[] = [];
  let revisionError: string | undefined;
  if (deps.revisions) {
    try {
      rows = await deps.revisions(sources.map(keyOf), Math.max(history, 1));
    } catch (err) {
      revisionError = err instanceof Error ? err.message : String(err);
    }
  }
  return envelope({
    models: sources.map((m) => {
      const c = loaded.get(engineKey(m));
      const rev = deps.revisions && !revisionError ? revisionsFor(keyOf(m), rows, history) : null;
      return {
        model: m.id,
        label: m.label,
        loaded: Boolean(c),
        ...(c ? { size: c.size, etag: c.etag } : {}),
        ...(rev ? { revision: rev.current, ...(rev.history ? { history: rev.history } : {}) } : {}),
      };
    }),
    loaded_means: "IFC motor na serveri má súbor v cache; nesúvisí s tým, či ho ukazuje viewer.",
    ...(revisionError ? { revision_error: revisionError } : {}),
    ids_sources: idsSources(deps.env).map((s) => s.id),
  });
}

async function ifcQuery(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const modelId = requireModel(input);
  const types = sanitizeTypes(input.ifc_types);
  const where = parseWhere(input.where);
  const limit = clamp(input.limit, 1, 500, 100);
  const storeyLabel = str(input.storey);
  if (types.length === 0 && where.length === 0 && !storeyLabel) {
    throw new InputError("Zadaj aspoň ifc_types, where alebo storey.");
  }
  if (types.length === 0 && attributeConditions(where).length > 0) throw new InputError("Podmienka na attribute potrebuje ifc_types (napr. [IfcDoor]).");
  const { models, revision } = await modelsFor([modelId], deps);
  const session = await openEngineSession(models);
  const args: Record<string, unknown> = {
    model_id: modelId,
    ...(types.length > 0 ? { types } : {}),
    ...whereArgs(where),
    limit,
    fields: ["globalId", "type", "name"],
  };
  if (storeyLabel) args.in_storey = await storeyGuid(session, modelId, storeyLabel);
  const attrs = attributeConditions(where);
  const res =
    attrs.length > 0
      ? await scanAttributes(session, args, attrs).then((all) => ({ count: all.length, truncated: false, entities: all.slice(0, limit) }))
      : structured<{ count: number; truncated: boolean; entities: Array<{ globalId?: string; type?: string; name?: string }> }>(
          await session.call("query_entities", args),
        );
  const rows = (res.entities ?? []).map((e) => ({ global_id: e.globalId ?? "", ifc_type: e.type ?? null, name: e.name ?? null }));
  const joined = await joinToAim(rows, deps.lookup);
  return envelope({
    model: modelId,
    revision: revision[modelId],
    total: res.count,
    returned: rows.length,
    truncated: res.truncated || res.count > rows.length,
    unmapped: joined.unmapped,
    items: joined.items,
    show_in_3d: joined.show_in_3d,
  });
}

/**
 * GlobalId -> expressId of model products. A lookup by GlobalId in the bundle
 * walks all entities of the file (~1 s on ASR per call); the parsed
 * store does not change, so the index is built once per store and lives with it.
 */
const guidIndexes = new WeakMap<object, Map<string, number>>();
export async function guidIndex(session: EngineSession, m: EngineModel): Promise<Map<string, number>> {
  const cached = guidIndexes.get(m.store);
  if (cached) return cached;
  const index = new Map<string, number>();
  for (let offset = 0; ; offset += 10_000) {
    const res = structured<{ truncated?: boolean; entities?: Array<{ expressId: number; globalId?: string }> }>(
      await session.call("query_entities", { model_id: m.id, limit: 10_000, offset, fields: ["globalId"] }),
    );
    for (const e of res.entities ?? []) if (e.globalId) index.set(e.globalId, e.expressId);
    if (!res.truncated) break;
  }
  guidIndexes.set(m.store, index);
  return index;
}

async function ifcGet(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const targets = Array.isArray(input.targets) ? [...new Set(input.targets.map(str).filter(Boolean))] : [];
  if (targets.length === 0 || targets.length > 50) throw new InputError("targets musí mať 1-50 položiek.");
  const includeType = input.include_type_properties !== false;
  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);

  const guidByTarget = new Map<string, string>();
  const nonGuid = targets.filter((t) => !IFC_GUID_RE.test(t));
  for (const t of targets) if (IFC_GUID_RE.test(t)) guidByTarget.set(t, t);
  if (nonGuid.length > 0) for (const [t, g] of await deps.resolveTargets(nonGuid)) guidByTarget.set(t, g);

  const { models } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  const include = ["attributes", "properties", "quantities", "classifications", "materials", "documents", ...(includeType ? ["type_properties"] : [])];
  const found: Array<Record<string, unknown> & { global_id: string }> = [];
  const missing: string[] = [];
  const where = new Map<string, { modelId: string; expressId: number }>();
  const wanted = [...new Set(guidByTarget.values())];
  for (const m of models) {
    const index = await guidIndex(session, m);
    for (const g of wanted) {
      const expressId = index.get(g);
      if (expressId !== undefined && !where.has(g)) where.set(g, { modelId: m.id, expressId });
    }
  }
  for (const target of targets) {
    const gid = guidByTarget.get(target);
    if (!gid) {
      missing.push(`${target} (v AIM bez IFC GUID alebo neexistuje)`);
      continue;
    }
    let hit: Record<string, unknown> | null = null;
    const loc = where.get(gid);
    // Outside the index (e.g. an element type) the slower GlobalId path remains.
    const candidates = loc ? [{ modelId: loc.modelId, arg: { express_id: loc.expressId } }] : models.map((m) => ({ modelId: m.id, arg: { global_id: gid } }));
    for (const c of candidates) {
      const res = await session.call("get_entity", { model_id: c.modelId, ...c.arg, include });
      if (!res.isError && res.structuredContent) {
        const { ref: _ref, ...rest } = res.structuredContent as Record<string, unknown>;
        void _ref;
        hit = { model: c.modelId, ...rest };
        break;
      }
    }
    if (hit) found.push({ target, global_id: gid, ...hit });
    else missing.push(`${target} (GUID ${gid} nie je v ${modelIds.join("/")})`);
  }
  const joined = await joinToAim(found, deps.lookup);
  return envelope({ items: joined.items, ...(missing.length ? { missing } : {}), show_in_3d: joined.show_in_3d });
}

async function ifcCount(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const modelId = requireModel(input);
  const type = sanitizeTypes(input.ifc_type)[0];
  const where = parseWhere(input.where);
  const groupBy = str(input.group_by);
  if (groupBy && where.length > 0) throw new InputError("group_by sa s where nekombinuje - použi jedno alebo druhé.");
  if (groupBy && !["type", "storey", "material"].includes(groupBy)) throw new InputError("group_by: type | storey | material.");
  const { models, revision } = await modelsFor([modelId], deps);
  const session = await openEngineSession(models);
  if (where.length > 0) {
    const args = { model_id: modelId, ...(type ? { types: [type] } : {}), ...whereArgs(where) };
    const attrs = attributeConditions(where);
    if (attrs.length > 0 && !type) throw new InputError("Podmienka na attribute potrebuje ifc_types (napr. [IfcDoor]).");
    const res =
      attrs.length > 0
        ? { count: (await scanAttributes(session, args, attrs)).length }
        : structured<{ count: number }>(await session.call("query_entities", { ...args, limit: 1 }));
    return envelope({ model: modelId, revision: revision[modelId], total: res.count, ...(type ? { ifc_type: type } : {}), where });
  }
  const res = structured<{ total: number; groupBy?: string; groups?: Array<{ key: string; count: number }> }>(
    await session.call("count_entities", { model_id: modelId, ...(type ? { type } : {}), ...(groupBy ? { group_by: groupBy } : {}) }),
  );
  return envelope({ model: modelId, revision: revision[modelId], ...(type ? { ifc_type: type } : {}), total: res.total, ...(res.groups ? { group_by: res.groupBy, groups: res.groups } : {}) });
}

async function ifcPropertyValues(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const modelId = requireModel(input);
  const type = sanitizeTypes(input.ifc_type)[0];
  const pset = str(input.pset);
  const name = str(input.name);
  if (!type) throw new InputError("Zadaj ifc_type (napr. IfcSpace).");
  if (!NAME_RE.test(pset) || !NAME_RE.test(name)) throw new InputError("Zadaj pset a name (písmená, číslice, _).");
  const limit = clamp(input.limit, 1, 200, 50);
  const { models, revision } = await modelsFor([modelId], deps);
  const session = await openEngineSession(models);
  const res = structured<{ values: Array<{ value: string; count: number }>; total: number }>(
    await session.call("properties_unique", { model_id: modelId, type, pset, property: name }),
  );
  // Upstream `properties_unique` reads only psets; it returns Qto (IfcElementQuantity) as "(missing)" (#96).
  let values = res.values;
  let source: "pset" | "qto" = "pset";
  if (res.total > 0 && values.every((v) => v.value === MISSING)) {
    const qto = await quantityValues(session, modelId, type, pset, name);
    if (qto.some((v) => v.value !== MISSING)) {
      values = qto;
      source = "qto";
    }
  }
  const nowhere = values.every((v) => v.value === MISSING);
  return envelope({
    model: modelId,
    revision: revision[modelId],
    ifc_type: type,
    property: `${pset}.${name}`,
    source,
    entities: res.total,
    distinct: values.length,
    values: values.slice(0, limit),
    ...(values.length > limit ? { truncated: true } : {}),
    ...(nowhere
      ? {
          note:
            "Hodnota nie je v psetoch výskytu ani v množstvách (Qto). Typové psety tento tool nečíta - " +
            "pred záverom, že dáta chýbajú, over jeden prvok cez ifc_get.",
        }
      : {}),
  });
}

const MISSING = "(missing)";

/** Histogram of a value from quantities (Qto) for all elements of a type - by pages, like guidIndex. */
async function quantityValues(
  session: EngineSession,
  modelId: string,
  type: string,
  qset: string,
  name: string,
): Promise<Array<{ value: string; count: number }>> {
  const counts = new Map<string, number>();
  for (let offset = 0; ; offset += BULK_PAGE) {
    const page = structured<{ truncated?: boolean; entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { model_id: modelId, types: [type], limit: BULK_PAGE, offset, fields: ["globalId"] }),
    );
    const ids = (page.entities ?? []).map((e) => e.expressId);
    if (ids.length > 0) {
      const bulk = structured<{ entities: Record<string, { quantities?: Array<{ name: string; quantities: Array<{ name: string; value: number }> }> }> }>(
        await session.call("get_entities_bulk", { model_id: modelId, express_ids: ids, include: ["quantities"] }),
      );
      for (const e of Object.values(bulk.entities ?? {})) {
        const q = e.quantities?.find((s) => s.name === qset)?.quantities.find((x) => x.name === name);
        const key = q?.value == null ? MISSING : String(q.value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    if (!page.truncated) break;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

/** Result of `ifc_search` as an object - also used by the combined `search_all` (D-095). */
export async function ifcSearchResult(input: Record<string, unknown>, deps: EngineDeps) {
  const text = str(input.text);
  if (text.length < 2) throw new InputError("text musí mať aspoň 2 znaky.");
  const types = sanitizeTypes(input.ifc_types);
  const fieldsRaw = Array.isArray(input.fields) ? input.fields.map(str) : [];
  const bad = fieldsRaw.filter((f) => !(SEARCH_FIELDS as readonly string[]).includes(f));
  if (bad.length > 0) throw new InputError(`fields: ${SEARCH_FIELDS.join(" | ")} (neznáme: ${bad.join(", ")}).`);
  const limit = clamp(input.limit, 1, 200, 30);
  const offset = clamp(input.offset, 0, 100_000, 0);
  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  const index = (await Promise.all(models.map((m) => searchIndex(session, m)))).flat();
  const allowed = types.length > 0 ? new Map(await Promise.all(models.map(async (m) => [m.id, await idsOfTypes(session, m, types)] as const))) : undefined;
  // Element code (SD04.0001) exactly by name or Tag without walking the whole index (D-102).
  const exact = looksLikeCode(text)
    ? exactNameHits((await Promise.all(models.map((m) => nameIndex(session, m)))).flatMap((ni) => ni.get(nameKey(text)) ?? []), allowed)
    : [];
  const hits = exact.length > 0 ? exact : searchEntities(index, { text, allowed, fields: fieldsRaw as SearchField[], fuzzy: input.fuzzy !== false });
  const page = hits.slice(offset, offset + limit);
  const joined = await joinToAim(page, deps.lookup);
  return {
    source: "ifc",
    models: modelIds,
    revision,
    total: hits.length,
    returned: page.length,
    ...(offset > 0 ? { offset } : {}),
    truncated: hits.length > offset + page.length,
    unmapped: joined.unmapped,
    items: joined.items.map((i) => ({ ...i, source: i.object_id ? "ifc+aim" : "ifc" })),
    show_in_3d: joined.show_in_3d,
    ...(hits.length === 0
      ? { hint: "V IFC súbore nič - skús search_all (aj graf AIM: importované psety, dokumenty), synonymum alebo anglický výraz." }
      : {}),
  };
}

interface IdsSpec {
  specification?: { id?: string; identifier?: string; name?: string };
  status?: string;
  applicableCount?: number;
  passedCount?: number;
  failedCount?: number;
  entityResults?: Array<{
    globalId?: string;
    entityType?: string;
    entityName?: string;
    passed?: boolean;
    requirementResults?: Array<{ status?: string; failureReason?: string }>;
  }>;
}

/** Row ceiling of one stored run (writing goes in batches, the route has a time limit). */
const MAX_SAVED_RESULTS = 50_000;

interface ResolvedIds {
  xml: string;
  sha256: string;
  ref: { id: string; sha256: string; origin?: string; version?: number };
  /** IDS from the DB only: the version the stored run is bound to. */
  stored?: { versionId: string; code: string; title: string | null; idsVersion: string | null; source: string; version: number };
}

async function resolveIds(input: Record<string, unknown>, deps: EngineDeps): Promise<ResolvedIds> {
  const idsId = str(input.ids);
  if (!idsId) throw new InputError("Chýba ids (kód IDS z ids_document action=list).");
  const version = input.version === undefined ? undefined : clamp(input.version, 1, 1_000_000, 0) || undefined;
  if (input.version !== undefined && version === undefined) throw new InputError("version: celé číslo od 1.");
  const doc = deps.ids ? await deps.ids.byCode(idsId) : null;
  if (doc && deps.ids) {
    const row = await deps.ids.version(doc.id, version);
    if (!row) throw new InputError(version === undefined ? `IDS '${idsId}' nemá žiadnu verziu.` : `IDS '${idsId}' nemá verziu ${version}.`);
    return {
      xml: row.xml,
      sha256: row.sha256,
      ref: { id: doc.code, sha256: row.sha256, origin: doc.origin, version: row.version },
      stored: {
        versionId: row.id,
        code: doc.code,
        title: doc.title,
        idsVersion: row.ids_version,
        source: `ids_document:${doc.code}@v${row.version}`,
        version: row.version,
      },
    };
  }
  const sources = idsSources(deps.env);
  const src = sources.find((s) => s.id === idsId);
  if (!src) {
    const codes = deps.ids ? (await deps.ids.listDocuments()).map((d) => d.code) : [];
    const known = [...codes, ...sources.map((s) => s.id)];
    throw new InputError(
      known.length === 0
        ? `IDS '${idsId}' neexistuje: v AIM nie je žiadne IDS (ids_document action=create) a záložný register IDS_SOURCES je prázdny.`
        : `IDS '${idsId}' neexistuje. Dostupné: ${known.join(", ")}.`,
    );
  }
  if (version !== undefined) throw new InputError("version platí len pre IDS uložené v AIM (ids_document), nie pre IDS_SOURCES.");
  const loaded = await loadIds(src, deps.fetchImpl);
  return { xml: loaded.xml, sha256: loaded.sha256, ref: { id: src.id, sha256: loaded.sha256 } };
}

async function ifcIdsValidate(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const modelId = requireModel(input);
  const save = input.save === true;
  const specFilter = str(input.spec).toLowerCase();
  const resolved = await resolveIds(input, deps);
  if (save && !resolved.stored) throw new InputError("save ukladá beh len pre IDS v AIM (ids_document action=create); IDS z IDS_SOURCES sa neukladá.");
  if (save && !deps.ids) throw new InputError("save nie je dostupné: chýba úložisko IDS.");
  if (save && specFilter) throw new InputError("save ukladá celý beh; spec nepoužívaj (čiastočný beh by zavádzal v v_ids_latest).");
  const perSpec = clamp(input.failures_per_spec, 1, 100, 20);
  const { models, revision } = await modelsFor([modelId], deps);
  const session = await openEngineSession(models);
  const res = structured<{ summary: Record<string, unknown>; report: { specificationResults?: IdsSpec[] } }>(
    await session.call("ids_validate", { model_id: modelId, ids_xml: resolved.xml }),
  );
  const allSpecs = res.report.specificationResults ?? [];
  const specs = allSpecs.filter((s) => {
    if (!specFilter) return true;
    const sp = s.specification ?? {};
    return [sp.identifier, sp.id, sp.name].some((v) => v && v.toLowerCase() === specFilter);
  });

  const out = [];
  for (const s of specs) {
    const failures = (s.entityResults ?? [])
      .filter((e) => !e.passed)
      .slice(0, perSpec)
      .map((e) => ({
        global_id: e.globalId ?? "",
        ifc_type: e.entityType ?? null,
        name: e.entityName ?? null,
        reasons: (e.requirementResults ?? []).filter((r) => r.status === "fail").map((r) => r.failureReason ?? "").filter(Boolean),
      }));
    const joined = await joinToAim(failures, deps.lookup);
    out.push({
      spec: s.specification?.identifier ?? s.specification?.id ?? null,
      name: s.specification?.name ?? null,
      status: s.status,
      applicable: s.applicableCount ?? 0,
      passed: s.passedCount ?? 0,
      failed: s.failedCount ?? 0,
      failures: joined.items,
      ...(joined.items.length > 0 ? { show_in_3d: joined.show_in_3d } : {}),
    });
  }

  let saved: { run_id: string; results: number; results_failed: number } | undefined;
  if (save && resolved.stored && deps.ids) {
    const guids = [...new Set(allSpecs.flatMap((s) => (s.entityResults ?? []).map((e) => e.globalId ?? "")).filter(Boolean))];
    const refs = guids.length > 0 ? await deps.lookup(guids) : new Map();
    const rows = resultRows(allSpecs, (g) => refs.get(g)?.object_id ?? null);
    if (rows.length > MAX_SAVED_RESULTS) throw new InputError(`Beh má ${rows.length} výsledkov (strop ${MAX_SAVED_RESULTS}); neuložil sa.`);
    const failed = rows.filter((r) => r.status === "fail").length;
    const model = models.find((m) => m.id === modelId);
    const runId = await deps.ids.saveRun(
      {
        ids_title: resolved.stored.title ?? resolved.stored.code,
        ids_version: resolved.stored.idsVersion,
        ids_sha256: resolved.sha256,
        ids_source: resolved.stored.source,
        ids_version_id: resolved.stored.versionId,
        model_label: modelId,
        model_file: model?.name ?? null,
        specs_total: allSpecs.length,
        specs_passed: allSpecs.filter((s) => s.status === "pass").length,
        results_total: rows.length,
        results_failed: failed,
        engine: "ifc-lite",
        trigger: "chat",
        model_revisions: revisionStamp(revision, [modelId]),
      },
      rows,
    );
    saved = { run_id: runId, results: rows.length, results_failed: failed };
  }
  return envelope({
    model: modelId,
    revision: revision[modelId],
    ids: resolved.ref,
    summary: res.summary,
    specifications: out,
    ...(saved ? { saved } : {}),
    note: saved
      ? "Beh je uložený ako záznam kontroly (v_ids_summary / v_ids_latest, engine=ifc-lite), nie je záväzný (binding=false)."
      : "Kontrola ad hoc (@ifc-lite/ids), nič sa neuložilo (save=true uloží beh). Žiadny beh nie je záväzný.",
  });
}

/** `ifc_models` action -> tool name of the bundle, or null for own revisions (D-115). */
function modelActionUpstream(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const action = str(raw);
  if (!(action in MODEL_ACTIONS)) throw new InputError(`action: ${Object.keys(MODEL_ACTIONS).join(" | ")}.`);
  return MODEL_ACTIONS[action as ModelAction];
}

/** Input of a taken-over tool: `model` from ifc_models is the bundle `model_id`. */
function modelActionArgs(input: Record<string, unknown>): Record<string, unknown> {
  const { model, model_id, type, include_inherited } = input;
  return {
    ...(model_id !== undefined || model !== undefined ? { model_id: model_id ?? model } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(include_inherited !== undefined ? { include_inherited } : {}),
  };
}

/**
 * `ifc_query` with a mode (D-115): list = query for elements, count = count, values =
 * histogram of values, material = elements with a material; each mode has its own
 * handler, only the name and schema are merged.
 */
async function ifcQueryMode(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const mode = str(input.mode) || "list";
  if (!(QUERY_MODES as readonly string[]).includes(mode)) throw new InputError(`mode: ${QUERY_MODES.join(" | ")}.`);
  if (str(input.material)) {
    if (mode === "values") throw new InputError("material sa nekombinuje s mode=values.");
    // count = the same computation (total and assemblies apply to all), only without the element list.
    if (mode === "count") {
      const full = JSON.parse(await ifcMaterialLayers({ ...input, limit: 1 }, deps)) as Record<string, unknown>;
      for (const key of ["items", "show_in_3d", "truncated", "note"]) delete full[key];
      return JSON.stringify(full);
    }
    return ifcMaterialLayers(input, deps);
  }
  // count and values have one class; they also accept the older ifc_type form.
  const one = { ...input, ifc_type: input.ifc_type ?? sanitizeTypes(input.ifc_types)[0] };
  if (mode === "count") return ifcCount(one, deps);
  if (mode === "values") return ifcPropertyValues(one, deps);
  return ifcQuery(input, deps);
}

/**
 * `ifc_measure` with qto=true (D-115): area and volume from Qto in the file via the taken-over
 * `geometry_area` / `geometry_volume`, without tessellating the geometry.
 */
async function ifcQto(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const list = Array.isArray(input.items) ? input.items.map((v) => str(v)).filter(Boolean) : [];
  const targets = [...new Set([str(input.a), ...list].filter(Boolean))];
  if (targets.length === 0) throw new InputError("Zadaj a alebo items: object_ref, objects.id alebo IFC GlobalId.");
  if (targets.length > 50) throw new InputError("items má najviac 50 prvkov.");
  const refs = targets.filter((t) => !IFC_GUID_RE.test(t));
  const resolved = refs.length > 0 ? await deps.resolveTargets(refs) : new Map<string, string>();
  const guidFor = (t: string) => (IFC_GUID_RE.test(t) ? t : resolved.get(t));
  const missing = targets.filter((t) => !guidFor(t));
  if (missing.length > 0) throw new InputError(`Bez IFC GUID v AIM: ${missing.join(", ")} - zadaj IFC GlobalId.`);

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  const found: Array<{ input: string; global_id: string; model: EngineModel; express_id: number }> = [];
  for (const t of targets) {
    const g = guidFor(t)!;
    for (const m of models) {
      const id = (await guidIndex(session, m)).get(g);
      if (id !== undefined) {
        found.push({ input: t, global_id: g, model: m, express_id: id });
        break;
      }
    }
  }
  const notIn = targets.filter((t) => !found.some((f) => f.input === t));
  if (notIn.length > 0) throw new InputError(`Nie je v ${modelIds.join("/")}: ${notIn.join(", ")}.`);

  const values = new Map<string, { area_m2: number | null; volume_m3: number | null }>();
  const units: Record<string, string> = {};
  for (const m of new Set(found.map((f) => f.model))) {
    const mine = found.filter((f) => f.model === m);
    const args = { model_id: m.id, express_ids: mine.map((f) => f.express_id) };
    type Q = { results?: Array<{ expressId: number; area?: number | null; volume?: number | null }>; unit?: string };
    const area = structured<Q>(await session.call("geometry_area", args));
    const volume = structured<Q>(await session.call("geometry_volume", args));
    if (area.unit) units.area = area.unit;
    if (volume.unit) units.volume = volume.unit;
    for (const f of mine) {
      values.set(f.input, {
        area_m2: area.results?.find((r) => r.expressId === f.express_id)?.area ?? null,
        volume_m3: volume.results?.find((r) => r.expressId === f.express_id)?.volume ?? null,
      });
    }
  }
  const joined = await joinToAim(
    found.map((f) => ({ global_id: f.global_id, model: f.model.id, input: f.input })),
    deps.lookup,
  );
  return envelope({
    source: "Qto v IFC súbore (IfcElementQuantity), nie geometria",
    revision: Object.fromEntries([...new Set(found.map((f) => f.model.id))].map((id) => [id, revision[id]])),
    units,
    items: joined.items.map(({ aim_url, ...rest }) => {
      void aim_url;
      return { ...rest, ...values.get(rest.input as string) };
    }),
    show_in_3d: joined.show_in_3d,
    note: "null = Qto v súbore chýba; plochu a objem z geometrie dá ifc_measure bez qto.",
  });
}

/** Runs an `ifc_*` tool. Input and engine errors are returned as a tool result, not an exception. */
/** Number of dimensions on the canvas into the reply; above the limit of one message it recommends `clear` (does not refuse). */
function withCanvasTally(content: string, total: number): string {
  try {
    const out = JSON.parse(content) as Record<string, unknown>;
    out.dimensions_on_canvas = total;
    if (total > MAX_MEASURE_SEGMENTS) {
      out.hint = `Na plátne je ${total} kót od Claude (viac ako ${MAX_MEASURE_SEGMENTS}). Zvážiť ifc_measure clear=true a nakresliť len potrebné.`;
    }
    return JSON.stringify(out);
  } catch {
    return content;
  }
}

export async function execEngineTool(
  name: string,
  input: Record<string, unknown>,
  deps: EngineDeps,
): Promise<EngineExecution> {
  try {
    let content: string;
    switch (name) {
      case "ifc_models": {
        // D-115: file data from the taken-over tools of the bundle under one name.
        const upstream = modelActionUpstream(input.action);
        if (upstream) return await execPassthroughTool(passthroughName(upstream), modelActionArgs(input), deps);
        content = await ifcModels(input, deps);
        break;
      }
      case "ifc_query":
        content = await ifcQueryMode(input, deps);
        break;
      case "ifc_get":
        content = await ifcGet(input, deps);
        break;
      case "ifc_ids_validate":
        content = await ifcIdsValidate(input, deps);
        break;
      case "ifc_relations":
        content = await ifcRelations(input, deps);
        break;
      case "ifc_measure": {
        if (input.clear === true) {
          // D-152: dimensions and the route line from Claude are removed, the user's measurements stay.
          const { clearDimensionsAction } = await import("./measure-dimension");
          resetDimensionTally();
          return { content: JSON.stringify({ view: "kóty od Claude zmazané (aj čiara trasy; merania používateľa ostali)" }), isError: false, actions: [clearDimensionsAction()] };
        }
        if (input.route !== undefined) {
          // show=true: route line for the viewer (D-137), the command is assembled by route-line.
          const line: Vec3[] | undefined = input.show === true ? [] : undefined;
          content = await (await import("./route")).ifcRoute(input, deps, line);
          if (line && line.length >= 2) return { content, isError: false, actions: [(await import("./route-line")).routeLineAction(line)] };
          break;
        }
        if (input.verify === true) {
          // D-185: verification of IfcSpace quantities against geometry; show=true = vertical dimensions at the space centroid.
          const dims: MeasureSegment[] | undefined = input.show === true ? [] : undefined;
          content = await (await import("./space-verify-run")).ifcVerifySpaces(input, deps, dims);
          if (dims?.length) {
            const keep = input.keep !== false;
            const total = noteDimensions(dims.length, keep);
            const action = (await import("./measure-dimension")).dimensionAction(dims, keep);
            return { content: withCanvasTally(content, total), isError: false, actions: [action] };
          }
          break;
        }
        if (input.qto === true) {
          content = await ifcQto(input, deps);
          break;
        }
        // show=true: dimensions for the viewer (D-124) are collected by the measurement, the command is assembled by measure-dimension.
        const dimensions: MeasureSegment[] | undefined = input.show === true ? [] : undefined;
        content = await (await import("./measure")).ifcMeasure(input, deps, dimensions);
        if (dimensions?.length) {
          // D-170: dimensions accumulate by default (keep), keep=false replaces the previous dimensions from Claude.
          const keep = input.keep !== false;
          const total = noteDimensions(dimensions.length, keep);
          const action = (await import("./measure-dimension")).dimensionAction(dimensions, keep);
          return { content: withCanvasTally(content, total), isError: false, actions: [action] };
        }
        break;
      }
      case "clash":
        content = await (await import("./clash")).ifcClash(input, deps);
        break;
      default:
        return { content: `Neznámy tool motora: ${name}`, isError: true };
    }
    return { content, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Chyba toolu: ${msg}`, isError: true };
  }
}
