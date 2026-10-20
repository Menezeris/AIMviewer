import { getIfcModels, modelKey } from "../data/ifc-models";

import { cacheSnapshot, getStore, type EngineModelSource } from "./cache";
import { idsSources, loadIds } from "./ids-sources";
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
 * Tools IFC motora pre MCP konektor (D-084, fáza 1): `ifc_*` nad IFC súbormi
 * federácie cez `@ifc-lite/mcp`, výsledky prepojené na graf AIM cez GUID.
 * Len čítanie. Odpovedajú na to, čo je v súbore (aj to, čo ETL nenaimportovalo),
 * číselné porovnania hodnôt psetov a IDS kontrolu ad hoc; otázky o grafe AIM
 * (dokumenty, zodpovednosti, uložené IDS behy) patria DB tools.
 */

const MAX_RESULT_CHARS = 20_000;
export const ENGINE_VERSION = "@ifc-lite/mcp@0.27.0";
/** Operátory, ktoré vie aj selektor (ďalšie podmienky `where` okrem prvej). */
const SELECTOR_OPS = new Set(["=", "!=", ">", "<", ">=", "<="]);
const BULK_PAGE = 1000;
const NAME_RE = /^[A-Za-z0-9_]+$/;
export const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

export interface EngineDeps {
  sources?: () => EngineModelSource[];
  lookup: GuidLookup;
  resolveTargets: (targets: string[]) => Promise<Map<string, string>>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Revízie modelov z DB (D-109); bez nej `ifc_models` revíziu nevracia. */
  revisions?: RevisionSource;
}

export interface EngineExecution {
  content: string;
  isError: boolean;
}

export class InputError extends Error {}

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
  /** IFC atribút entity (OverallWidth, LongName...) namiesto psetu (D-118). */
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

/** where -> argumenty query_entities: prvá podmienka na pset ako `property`, ďalšie ako selektor; atribúty filtruje `scanAttributes`. */
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

/** Porovnanie hodnoty IFC atribútu: čísla číselne, text bez ohľadu na veľkosť písmen. */
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

/** Strop kandidátov na filter atribútov (atribúty čítame po stránkach cez get_entities_bulk). */
const MAX_ATTRIBUTE_SCAN = 20_000;

/**
 * Prvky, ktoré spĺňajú aj podmienky na IFC atribúty (D-118). Upstream selektor
 * atribúty nevie, preto kandidátov z query_entities (triedy, psety, podlažie)
 * dofiltrujeme podľa `attributes` z get_entities_bulk.
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
  const all = (deps.sources ?? getIfcModels)();
  const revision: Record<string, unknown> = {};
  const models: EngineModel[] = [];
  for (const id of ids) {
    const src = all.find((m) => m.id === id);
    if (!src) throw new InputError(`Model ${id} nie je vo federácii (${all.map((m) => m.id).join(", ")}).`);
    const { entry } = await getStore(src, { fetchImpl: deps.fetchImpl });
    models.push({ id: src.id, name: `${src.id}.ifc`, store: entry.store });
    revision[src.id] = { etag: entry.etag, size: entry.size, loaded_at: new Date(entry.loadedAt).toISOString() };
  }
  return { models, revision };
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
  const loaded = new Map(cacheSnapshot().map((c) => [c.id, c]));
  const sources = (deps.sources ?? getIfcModels)();
  const history = input.history === undefined ? 0 : clamp(input.history, 1, 20, 5);
  // Kľúč revízie = meno súboru v buckete (ASR.ifc -> ASR), nie id modelu (D-086).
  const keyOf = (m: { id: string; url: string }) => modelKey(m.url) ?? m.id;
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
      const c = loaded.get(m.id);
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
 * GlobalId -> expressId produktov modelu. Hľadanie podľa GlobalId v balíku
 * prechádza všetky entity súboru (~1 s na ASR pri každom volaní); parsovaný
 * store sa nemení, takže index sa postaví raz na store a drží s ním.
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
  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? getIfcModels)().map((m) => m.id);

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
    // Mimo indexu (napr. typ prvku) ostáva pomalšia cesta cez GlobalId.
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
  // Upstream `properties_unique` číta len psety; Qto (IfcElementQuantity) vráti ako "(missing)" (#96).
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

/** Histogram hodnoty z množstiev (Qto) pre všetky prvky typu - po stránkach, ako guidIndex. */
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

/** Výsledok `ifc_search` ako objekt - používa ho aj kombinované `search_all` (D-095). */
export async function ifcSearchResult(input: Record<string, unknown>, deps: EngineDeps) {
  const text = str(input.text);
  if (text.length < 2) throw new InputError("text musí mať aspoň 2 znaky.");
  const types = sanitizeTypes(input.ifc_types);
  const fieldsRaw = Array.isArray(input.fields) ? input.fields.map(str) : [];
  const bad = fieldsRaw.filter((f) => !(SEARCH_FIELDS as readonly string[]).includes(f));
  if (bad.length > 0) throw new InputError(`fields: ${SEARCH_FIELDS.join(" | ")} (neznáme: ${bad.join(", ")}).`);
  const limit = clamp(input.limit, 1, 200, 30);
  const offset = clamp(input.offset, 0, 100_000, 0);
  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? getIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  const index = (await Promise.all(models.map((m) => searchIndex(session, m)))).flat();
  const allowed = types.length > 0 ? new Map(await Promise.all(models.map(async (m) => [m.id, await idsOfTypes(session, m, types)] as const))) : undefined;
  // Kód prvku (SD04.0001) presne podľa mena alebo Tagu bez prechodu celého indexu (D-102).
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

async function ifcIdsValidate(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const modelId = requireModel(input);
  const idsId = str(input.ids);
  const sources = idsSources(deps.env);
  const src = sources.find((s) => s.id === idsId);
  if (!src) {
    throw new InputError(
      sources.length === 0
        ? "Register IDS je prázdny - kontrola na serveri zatiaľ nie je zapnutá (D-084, IDS_SOURCES). IDS skontroluj v IDS paneli viewera; uložený beh je v v_ids_summary / v_ids_latest."
        : `IDS '${idsId}' nie je v registri: ${sources.map((s) => s.id).join(", ")}.`,
    );
  }
  const perSpec = clamp(input.failures_per_spec, 1, 100, 20);
  const specFilter = str(input.spec).toLowerCase();
  const ids = await loadIds(src, deps.fetchImpl);
  const { models, revision } = await modelsFor([modelId], deps);
  const session = await openEngineSession(models);
  const res = structured<{ summary: Record<string, unknown>; report: { specificationResults?: IdsSpec[] } }>(
    await session.call("ids_validate", { model_id: modelId, ids_xml: ids.xml }),
  );
  const specs = (res.report.specificationResults ?? []).filter((s) => {
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
  return envelope({
    model: modelId,
    revision: revision[modelId],
    ids: { id: src.id, sha256: ids.sha256 },
    summary: res.summary,
    specifications: out,
    note: "Kontrola ad hoc (@ifc-lite/ids), nič sa neuložilo. Záväzný zaznamenaný beh = ETL ifctester (v_ids_summary).",
  });
}

/** `ifc_models` action -> meno toolu balíka, alebo null pre vlastné revisions (D-115). */
function modelActionUpstream(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const action = str(raw);
  if (!(action in MODEL_ACTIONS)) throw new InputError(`action: ${Object.keys(MODEL_ACTIONS).join(" | ")}.`);
  return MODEL_ACTIONS[action as ModelAction];
}

/** Vstup prevzatého toolu: `model` z ifc_models je `model_id` balíka. */
function modelActionArgs(input: Record<string, unknown>): Record<string, unknown> {
  const { model, model_id, type, include_inherited } = input;
  return {
    ...(model_id !== undefined || model !== undefined ? { model_id: model_id ?? model } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(include_inherited !== undefined ? { include_inherited } : {}),
  };
}

/**
 * `ifc_query` s režimom (D-115): list = dotaz na prvky, count = počet, values =
 * histogram hodnôt, material = prvky s materiálom; každý režim má vlastný
 * handler, zlúčené je len meno a schéma.
 */
async function ifcQueryMode(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const mode = str(input.mode) || "list";
  if (!(QUERY_MODES as readonly string[]).includes(mode)) throw new InputError(`mode: ${QUERY_MODES.join(" | ")}.`);
  if (str(input.material)) {
    if (mode === "values") throw new InputError("material sa nekombinuje s mode=values.");
    // count = ten istý výpočet (total a skladby platia za všetky), len bez zoznamu prvkov.
    if (mode === "count") {
      const full = JSON.parse(await ifcMaterialLayers({ ...input, limit: 1 }, deps)) as Record<string, unknown>;
      for (const key of ["items", "show_in_3d", "truncated", "note"]) delete full[key];
      return JSON.stringify(full);
    }
    return ifcMaterialLayers(input, deps);
  }
  // count a values majú jednu triedu; prijmú aj starší tvar ifc_type.
  const one = { ...input, ifc_type: input.ifc_type ?? sanitizeTypes(input.ifc_types)[0] };
  if (mode === "count") return ifcCount(one, deps);
  if (mode === "values") return ifcPropertyValues(one, deps);
  return ifcQuery(input, deps);
}

/**
 * `ifc_measure` s qto=true (D-115): plocha a objem z Qto v súbore cez prevzaté
 * `geometry_area` / `geometry_volume`, bez tesselácie geometrie.
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

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? getIfcModels)().map((m) => m.id);
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

/** Vykoná `ifc_*` tool. Chyby vstupu a motora sa vracajú ako výsledok toolu, nie výnimka. */
export async function execEngineTool(
  name: string,
  input: Record<string, unknown>,
  deps: EngineDeps,
): Promise<EngineExecution> {
  try {
    let content: string;
    switch (name) {
      case "ifc_models": {
        // D-115: údaje o súbore z prevzatých tools balíka pod jedným menom.
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
      case "ifc_measure":
        content =
          input.route !== undefined
            ? await (await import("./route")).ifcRoute(input, deps)
            : input.qto === true
              ? await ifcQto(input, deps)
              : await (await import("./measure")).ifcMeasure(input, deps);
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
