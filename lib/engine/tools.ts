import { getIfcModels } from "../data/ifc-models";

import { cacheSnapshot, getStore, type EngineModelSource } from "./cache";
import { idsSources, loadIds } from "./ids-sources";
import { execPassthroughTool, isPassthroughTool } from "./passthrough";
import { joinToAim, type GuidLookup } from "./join";
import { ifcRelations } from "./relations";
import { SEARCH_FIELDS, idsOfTypes, searchEntities, searchIndex, type SearchField } from "./search";
import { openEngineSession, type EngineModel, type EngineSession, type EngineToolResult } from "./session";
import { resolveStorey } from "./storey";
import { OPS } from "./tool-defs";

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
const NAME_RE = /^[A-Za-z0-9_]+$/;
export const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/;

export interface EngineDeps {
  sources?: () => EngineModelSource[];
  lookup: GuidLookup;
  resolveTargets: (targets: string[]) => Promise<Map<string, string>>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
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
}

function parseWhere(raw: unknown): Where[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new InputError("where musí byť pole podmienok.");
  if (raw.length > 3) throw new InputError("where má najviac 3 podmienky.");
  return raw.map((w, i) => {
    const o = (w ?? {}) as Record<string, unknown>;
    const pset = str(o.pset);
    const name = str(o.name);
    const op = str(o.op);
    if (!NAME_RE.test(pset) || !NAME_RE.test(name)) {
      throw new InputError("pset a name smú obsahovať len písmená, číslice a _ (napr. Qto_SpaceBaseQuantities).");
    }
    if (!(OPS as readonly string[]).includes(op)) throw new InputError(`op musí byť jeden z ${OPS.join(" ")}.`);
    if (i > 0 && !SELECTOR_OPS.has(op)) throw new InputError("Ďalšie podmienky (okrem prvej) smú mať len = != > < >= <=.");
    if (op !== "exists" && o.value === undefined) throw new InputError(`Podmienka ${pset}.${name} potrebuje value.`);
    if (i > 0 && typeof o.value === "string" && /[,;"']/.test(o.value)) {
      throw new InputError("Hodnota ďalšej podmienky nesmie obsahovať , ; ani úvodzovky.");
    }
    return { pset, name, op, value: o.value };
  });
}

/** where -> argumenty query_entities: prvá podmienka ako `property`, ďalšie ako selektor. */
function whereArgs(where: Where[]): Record<string, unknown> {
  if (where.length === 0) return {};
  const [first, ...rest] = where;
  const out: Record<string, unknown> = {
    property: { pset: first.pset, name: first.name, op: first.op, ...(first.op === "exists" ? {} : { value: first.value }) },
  };
  if (rest.length > 0) out.selector = rest.map((w) => `${w.pset}.${w.name}${w.op}${String(w.value)}`).join(", ");
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

async function storeyGuid(session: EngineSession, modelId: string, label: string): Promise<string> {
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

async function ifcModels(deps: EngineDeps): Promise<string> {
  const loaded = new Map(cacheSnapshot().map((c) => [c.id, c]));
  return envelope({
    models: (deps.sources ?? getIfcModels)().map((m) => {
      const c = loaded.get(m.id);
      return { model: m.id, label: m.label, loaded: Boolean(c), ...(c ? { size: c.size, etag: c.etag } : {}) };
    }),
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
  const res = structured<{ count: number; truncated: boolean; entities: Array<{ globalId?: string; type?: string; name?: string }> }>(
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
  const include = ["attributes", "properties", "quantities", "classifications", "documents", ...(includeType ? ["type_properties"] : [])];
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
    const res = structured<{ count: number }>(
      await session.call("query_entities", { model_id: modelId, ...(type ? { types: [type] } : {}), ...whereArgs(where), limit: 1 }),
    );
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
const BULK_PAGE = 1000;

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

async function ifcSearch(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  return envelope(await ifcSearchResult(input, deps));
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
  const allowed = types.length > 0 ? new Map(await Promise.all(models.map(async (m) => [m.id, await idsOfTypes(session, m.id, types)] as const))) : undefined;
  const hits = searchEntities(index, { text, allowed, fields: fieldsRaw as SearchField[], fuzzy: input.fuzzy !== false });
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
      ? { hint: "V IFC súbore nič - skús search_everything (graf AIM: importované psety, dokumenty), synonymum alebo anglický výraz." }
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

/** Vykoná `ifc_*` tool. Chyby vstupu a motora sa vracajú ako výsledok toolu, nie výnimka. */
export async function execEngineTool(
  name: string,
  input: Record<string, unknown>,
  deps: EngineDeps,
): Promise<EngineExecution> {
  try {
    let content: string;
    switch (name) {
      case "ifc_models":
        content = await ifcModels(deps);
        break;
      case "ifc_query":
        content = await ifcQuery(input, deps);
        break;
      case "ifc_search":
        content = await ifcSearch(input, deps);
        break;
      case "ifc_get":
        content = await ifcGet(input, deps);
        break;
      case "ifc_count":
        content = await ifcCount(input, deps);
        break;
      case "ifc_property_values":
        content = await ifcPropertyValues(input, deps);
        break;
      case "ifc_ids_validate":
        content = await ifcIdsValidate(input, deps);
        break;
      case "ifc_relations":
        content = await ifcRelations(input, deps);
        break;
      default:
        if (isPassthroughTool(name)) return await execPassthroughTool(name, input, deps);
        return { content: `Neznámy tool motora: ${name}`, isError: true };
    }
    return { content, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Chyba toolu: ${msg}`, isError: true };
  }
}
