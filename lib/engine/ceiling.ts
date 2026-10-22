import { getIfcModels } from "../data/ifc-models";

import type { EngineModelSource } from "./cache";
import { ifcBox, meshMetrics, meshModel } from "./measure";
import { openEngineSession, type EngineModel } from "./session";
import { modelsFor, storeyGuid, structured } from "./tools";

const QSET = "Qto_SpaceBaseQuantities";
const QNAME = "FinishCeilingHeight";

/** Výška podhľadu podlažia v metroch nad úrovňou podlažia (D-141, pôvodne D-102). */
export interface StoreyCeiling {
  /** Odkiaľ je výška: geometria IfcCovering CEILING (mesh), alebo záloha z Qto miestností. */
  source: "geometry" | "qto";
  /** Spodný okraj podhľadu (m nad IfcBuildingStorey.Elevation); pri Qto rovnaký ako top_m. */
  bottom_m: number;
  /** Horný okraj podhľadu (m nad úrovňou podlažia). */
  top_m: number;
  /** Prvky IfcCovering CEILING, z ktorých je geometria (0 pri Qto). */
  coverings: number;
  /** Qto FinishCeilingHeight miestností (od hotovej podlahy), ak ho model nesie. */
  qto?: { height_m: number; min_m: number; max_m: number; spaces: number };
  /** Nezhoda Qto a geometrie, resp. dôvod zálohy; model ju má povedať používateľovi. */
  warning?: string;
  model: string;
}

/** Nezhoda Qto a geometrie nad touto hodnotou (m) sa hlási. */
const MISMATCH_M = 0.02;

/** Vážený medián: výška, pod ktorou je aspoň polovica plochy podlažia (bez plochy váha 1). */
export function weightedMedian(items: Array<{ value: number; weight: number }>): number {
  const v = [...items].sort((a, b) => a.value - b.value);
  const total = v.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of v) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return v[v.length - 1].value;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Geometrický podhľad podlažia: vážený medián spodných a horných okrajov krytín CEILING (m nad úrovňou). */
export function ceilingFromCoverings(
  items: Array<{ bottom: number; top: number; weight: number }>,
  elevation: number,
): { bottom_m: number; top_m: number } | null {
  if (items.length === 0) return null;
  const rel = (f: (i: (typeof items)[number]) => number) => round3(weightedMedian(items.map((i) => ({ value: f(i) - elevation, weight: i.weight }))));
  return { bottom_m: rel((i) => i.bottom), top_m: rel((i) => i.top) };
}

type Session = Awaited<ReturnType<typeof openEngineSession>>;

async function geometryCeiling(session: Session, m: EngineModel, gid: string, storeyExpress: number | undefined, scale: number) {
  const page = structured<{ entities?: Array<{ expressId: number; globalId?: string }> }>(
    await session.call("query_entities", { model_id: m.id, types: ["IfcCovering"], in_storey: gid, limit: 1000, fields: ["globalId"] }),
  );
  const ids = (page.entities ?? []).map((e) => e.expressId);
  if (ids.length === 0 || storeyExpress === undefined) return null;
  const bulk = structured<{ entities?: Record<string, { expressId?: number; ref?: { expressId: number }; attributes?: Array<{ name: string; value: unknown }> }> }>(
    await session.call("get_entities_bulk", { model_id: m.id, express_ids: [storeyExpress, ...ids], include: ["attributes"] }),
  );
  const rows = Object.entries(bulk.entities ?? {});
  const attr = (e: { attributes?: Array<{ name: string; value: unknown }> }, n: string) => e.attributes?.find((a) => a.name === n)?.value;
  const storeyRow = rows.find(([, e]) => (e.ref?.expressId ?? e.expressId) === storeyExpress);
  const elevation = Number(storeyRow ? attr(storeyRow[1], "Elevation") : NaN) * scale;
  if (!Number.isFinite(elevation)) return null;
  const ceilingGuids = new Set(
    rows.filter(([, e]) => String(attr(e, "PredefinedType") ?? "").toUpperCase() === "CEILING").map(([g]) => g),
  );
  if (ceilingGuids.size === 0) return null;
  const meshes = await meshModel(m);
  const items: Array<{ bottom: number; top: number; weight: number }> = [];
  for (const g of ceilingGuids) {
    const e = meshes.get(g);
    if (!e) continue;
    const box = ifcBox(e.bounds);
    const dz = e.worldOffset?.[2] ?? 0;
    const footprint = meshMetrics(e.positions, e.indices).footprint;
    items.push({ bottom: box.min[2] + dz, top: box.max[2] + dz, weight: footprint > 0 ? footprint : 1 });
  }
  const c = ceilingFromCoverings(items, elevation);
  return c ? { ...c, coverings: items.length } : null;
}

/**
 * "Pod podhľadom na 3NP" = podhľad miestností 3NP, nie IfcCovering priradené k
 * podlažiu pri iných dotazoch (v modeli visia pod doskou podlažia a patria miestnostiam
 * pod ním). D-141 (#230): výška sa berie z GEOMETRIE krytín CEILING podlažia (mesh,
 * spodný a horný okraj nad úrovňou podlažia); Qto FinishCeilingHeight (od hotovej
 * podlahy, jednotka podľa modelu) je záloha, a pri nezhode sa upozorní.
 */
export async function storeyCeiling(
  label: string,
  opts: { sources?: () => EngineModelSource[]; fetchImpl?: typeof fetch } = {},
): Promise<StoreyCeiling | null> {
  const sources = opts.sources ?? getIfcModels;
  const deps = { sources, fetchImpl: opts.fetchImpl, lookup: async () => new Map(), resolveTargets: async () => new Map() };
  const { models } = await modelsFor(sources().map((m) => m.id), deps);
  const session = await openEngineSession(models);
  for (const m of models) {
    const gid = await storeyGuid(session, m.id, label).catch(() => null);
    if (!gid) continue;
    const info = structured<{ lengthUnitScale?: number; result?: { lengthUnitScale?: number } }>(
      await session.call("model_info", { model_id: m.id }),
    );
    const raw = info.lengthUnitScale ?? info.result?.lengthUnitScale;
    const scale = typeof raw === "number" && raw > 0 ? raw : 1;

    const rooms = structured<{ entities?: Array<{ expressId: number }> }>(
      await session.call("query_entities", { model_id: m.id, types: ["IfcSpace"], in_storey: gid, limit: 1000, fields: ["globalId"] }),
    );
    const ids = (rooms.entities ?? []).map((e) => e.expressId);
    let qto: StoreyCeiling["qto"];
    if (ids.length > 0) {
      const bulk = structured<{ entities?: Record<string, { quantities?: Array<{ name: string; quantities: Array<{ name: string; value: number }> }> }> }>(
        await session.call("get_entities_bulk", { model_id: m.id, express_ids: ids, include: ["quantities"] }),
      );
      const items: Array<{ value: number; weight: number }> = [];
      for (const e of Object.values(bulk.entities ?? {})) {
        const set = e.quantities?.find((s) => s.name === QSET)?.quantities;
        const q = set?.find((x) => x.name === QNAME);
        const area = set?.find((x) => x.name === "NetFloorArea")?.value;
        if (typeof q?.value === "number" && q.value > 0) {
          items.push({ value: q.value * scale, weight: typeof area === "number" && area > 0 ? area : 1 });
        }
      }
      if (items.length > 0) {
        const values = items.map((i) => i.value);
        qto = { height_m: round3(weightedMedian(items)), min_m: round3(Math.min(...values)), max_m: round3(Math.max(...values)), spaces: items.length };
      }
    }

    const storeys = structured<{ entities?: Array<{ expressId: number; globalId?: string }> }>(
      await session.call("query_entities", { model_id: m.id, type: "IfcBuildingStorey", limit: 200 }),
    );
    const storeyExpress = storeys.entities?.find((e) => e.globalId === gid)?.expressId;
    let geo: Awaited<ReturnType<typeof geometryCeiling>> = null;
    let geoError: string | undefined;
    try {
      geo = await geometryCeiling(session, m, gid, storeyExpress, scale);
    } catch (err) {
      geoError = err instanceof Error ? err.message : String(err);
    }

    if (geo) {
      const diff = qto ? round3(geo.bottom_m - qto.height_m) : 0;
      const warning =
        qto && Math.abs(diff) > MISMATCH_M
          ? `Qto FinishCeilingHeight (${qto.height_m} m) sa líši od geometrie podhľadu (spodok ${geo.bottom_m} m nad úrovňou podlažia) o ${diff} m; použitá je geometria.`
          : undefined;
      return { source: "geometry", ...geo, ...(qto ? { qto } : {}), ...(warning ? { warning } : {}), model: m.id };
    }
    if (qto) {
      const why = geoError ? `geometriu podhľadu sa nepodarilo načítať (${geoError})` : "podlažie nemá IfcCovering CEILING s geometriou";
      return { source: "qto", bottom_m: qto.height_m, top_m: qto.height_m, coverings: 0, qto, warning: `Výška je len z Qto FinishCeilingHeight, ${why}.`, model: m.id };
    }
  }
  return null;
}
