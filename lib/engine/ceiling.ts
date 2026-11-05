import { requestIfcModels } from "../project/request-models";

import type { EngineModelSource } from "./cache";
import { ifcBox, meshMetrics, meshModel } from "./measure";
import { openEngineSession, type EngineModel } from "./session";
import { modelsFor, storeyGuid, structured } from "./tools";

const QSET = "Qto_SpaceBaseQuantities";
const QNAME = "FinishCeilingHeight";

/** Ceiling height of a storey in metres above the storey level (D-140, originally D-102). */
export interface StoreyCeiling {
  /** Where the height comes from: geometry of IfcCovering CEILING (mesh), or a fallback from the Qto of spaces. */
  source: "geometry" | "qto";
  /** Bottom edge of the ceiling (m above IfcBuildingStorey.Elevation); for Qto the same as top_m. */
  bottom_m: number;
  /** Top edge of the ceiling (m above the storey level). */
  top_m: number;
  /** IfcCovering CEILING elements the geometry comes from (0 for Qto). */
  coverings: number;
  /** Qto FinishCeilingHeight of spaces (from the finished floor), if the model carries it. */
  qto?: { height_m: number; min_m: number; max_m: number; spaces: number };
  /** Qto and geometry mismatch, or the reason for the fallback; the model should tell it to the user. */
  warning?: string;
  model: string;
}

/** A Qto and geometry mismatch above this value (m) is reported. */
const MISMATCH_M = 0.02;

/** Weighted median: the height below which is at least half of the storey area (without area weight 1). */
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

/** Geometric ceiling of a storey: weighted median of bottom and top edges of CEILING coverings (m above the level). */
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
 * "Below the ceiling on 3NP" = the ceiling of the spaces of 3NP, not the IfcCovering assigned to
 * the storey in other queries (in the model they hang below the storey slab and belong to the spaces
 * below it). D-140 (#230): the height is taken from the GEOMETRY of CEILING coverings of the storey (mesh,
 * bottom and top edge above the storey level); Qto FinishCeilingHeight (from the finished
 * floor, unit per the model) is a fallback, and on a mismatch a warning is given.
 */
export async function storeyCeiling(
  label: string,
  opts: { sources?: () => EngineModelSource[]; fetchImpl?: typeof fetch } = {},
): Promise<StoreyCeiling | null> {
  const sources = opts.sources ?? requestIfcModels;
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
