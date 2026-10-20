import { clashMemberKey, createClashEngine, type ClashElement } from "@ifc-lite/clash";
import { GeometryProcessor, type MeshData } from "@ifc-lite/geometry";
import { renderFrameWorldOffset } from "@ifc-lite/geometry/world-frame";
import type { IfcDataStore } from "@ifc-lite/parser";
import { EntityNode } from "@ifc-lite/query";

import { getIfcModels } from "../data/ifc-models";

import { clearOpening } from "./door-clear";
import { joinToAim } from "./join";
import { pairDimension, sizeDimensions } from "./measure-dimension";
import type { MeasureSegment } from "../viewer-measure";
import { openEngineSession, type EngineModel } from "./session";
import { ENGINE_VERSION, IFC_GUID_RE, InputError, guidIndex, modelsFor, str, type EngineDeps } from "./tools";

/**
 * `ifc_measure` (D-112): meranie z geometrie IFC motora. Upstream `geometry_*`
 * čítajú len Qto; skutočnú geometriu má balík iba v `clash_check` (headless
 * tesselácia `@ifc-lite/geometry`). Tu sa model tesseluje rovnako, raz na
 * inštanciu (cache pri zdieľanom store), a:
 * - dva prvky: svetlá vzdialenosť meshov upstream clash enginom (režim
 *   clearance s explicitnými členmi, záporná = prienik), stredy, medzery po osiach;
 * - prvok: rozmery obálky, povrch, pôdorys a objem z meshu vedľa Qto.
 * Modely federácie sú v jednom rámci (overené na ASR a VZT), takže dvojica
 * môže byť z rôznych modelov. Mesh je Y-up v metroch; von ide v osiach IFC (Z hore).
 */

const MAX_ITEMS = 50;
/** Nezhoda meshu a Qto nad touto relatívnou odchýlkou. */
const MISMATCH = 0.05;

export type Vec3 = [number, number, number];
export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface MeshElement {
  globalId: string;
  expressId: number;
  model: string;
  ifcType: string;
  name: string | null;
  positions: Float32Array;
  indices: Uint32Array;
  /** Začiatky telies (položiek reprezentácie) v `indices`, napr. zárubňa, krídlo, kovanie. */
  parts: number[];
  /** Obálka v rámci meshu (Y-up). */
  bounds: Box;
  /** Posun rámca meshu do IFC sveta (Z hore, m) z `coordinateInfo`; bez neho 0 (D-124). */
  worldOffset?: Vec3;
}

/** Y-up mesh -> IFC (Z hore): x = x, y = -z, z = y. */
export function toIfc(p: readonly number[]): Vec3 {
  return [p[0], -p[2] || 0, p[1]];
}

export function ifcBox(b: Box): Box {
  const a = toIfc(b.min);
  const c = toIfc(b.max);
  return {
    min: [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2])],
    max: [Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])],
  };
}

export function boundsOf(positions: Float32Array): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Povrch (m²), pôdorys = priemet plôch s normálou hore (m², IFC Z) a objem (m³) cez znamienkové štvorsteny. */
export function meshMetrics(positions: Float32Array, indices: Uint32Array): { area: number; footprint: number; volume: number; closed: boolean } {
  let area = 0;
  let footprint = 0;
  let volume = 0;
  const edges = new Map<string, number>();
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const [ax, ay, az] = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const [bx, by, bz] = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const [cx, cy, cz] = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    // Y je v meshi hore: priemet na vodorovnú rovinu = zložka normály Y.
    if (ny > 0) footprint += ny / 2;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [p, q] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const key = vertexKey(positions, p) + "|" + vertexKey(positions, q);
      const rev = vertexKey(positions, q) + "|" + vertexKey(positions, p);
      const k = key < rev ? key : rev;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let closed = edges.size > 0;
  for (const n of edges.values()) {
    if (n % 2 !== 0) {
      closed = false;
      break;
    }
  }
  return { area, footprint, volume: Math.abs(volume), closed };
}

/** Kľúč vrcholu podľa polohy (mm), lebo mesher zdvojuje vrcholy na hranách kvôli normálam. */
function vertexKey(positions: Float32Array, i: number): string {
  return `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;
}

/** Medzera medzi obálkami po osiach (0 = v priemete sa prekrývajú). */
export function boxGap(a: Box, b: Box): Vec3 {
  return [0, 1, 2].map((k) => Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k])) as Vec3;
}

export function center(b: Box): Vec3 {
  return [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2) as Vec3;
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
const roundVec = (v: readonly number[]) => v.map((x) => round(x)) as Vec3;

/** Meshe jedného modelu zlúčené po prvkoch, svetové súradnice (world = origin + position). */
export function elementsFromMeshes(
  meshes: MeshData[],
  store: IfcDataStore,
  model: string,
  worldOffset?: Vec3,
): Map<string, MeshElement> {
  const groups = new Map<number, MeshData[]>();
  for (const m of meshes) {
    if (!m.positions?.length || !m.indices?.length) continue;
    const g = groups.get(m.expressId);
    if (g) g.push(m);
    else groups.set(m.expressId, [m]);
  }
  const out = new Map<string, MeshElement>();
  for (const [expressId, group] of groups) {
    const globalId = store.entities.getGlobalId(expressId);
    if (!globalId) continue;
    let nPos = 0;
    let nIdx = 0;
    for (const m of group) {
      nPos += m.positions.length;
      nIdx += m.indices.length;
    }
    const positions = new Float32Array(nPos);
    const indices = new Uint32Array(nIdx);
    const parts: number[] = [];
    let pOff = 0;
    let iOff = 0;
    for (const m of group) {
      const o = m.origin ?? [0, 0, 0];
      for (let i = 0; i < m.positions.length; i += 3) {
        positions[pOff + i] = m.positions[i] + o[0];
        positions[pOff + i + 1] = m.positions[i + 1] + o[1];
        positions[pOff + i + 2] = m.positions[i + 2] + o[2];
      }
      const base = pOff / 3;
      parts.push(iOff);
      for (let i = 0; i < m.indices.length; i++) indices[iOff + i] = m.indices[i] + base;
      pOff += m.positions.length;
      iOff += m.indices.length;
    }
    out.set(globalId, {
      globalId,
      expressId,
      model,
      ifcType: store.entities.getTypeName(expressId) || "IfcProduct",
      name: store.entities.getName(expressId) || null,
      positions,
      indices,
      parts,
      bounds: boundsOf(positions),
      ...(worldOffset ? { worldOffset } : {}),
    });
  }
  return out;
}

/** Tesselácia raz na zdieľaný store (cache inštancie, ako store v `cache.ts`). */
const meshCache = new WeakMap<IfcDataStore, Promise<Map<string, MeshElement>>>();

export function meshModel(m: EngineModel): Promise<Map<string, MeshElement>> {
  const hit = meshCache.get(m.store);
  if (hit) return hit;
  const p = tessellate(m);
  meshCache.set(m.store, p);
  p.catch(() => meshCache.delete(m.store));
  return p;
}

async function tessellate(m: EngineModel): Promise<Map<string, MeshElement>> {
  if (!m.store.source || m.store.source.byteLength === 0) throw new Error(`Model ${m.id} nemá zdrojové bajty na tesseláciu.`);
  return m.store.source.withMaterializedAsync(async (bytes) => {
    const gp = new GeometryProcessor({ enableInstancing: false });
    // Mesher píše priebeh do console.* (ako parser v loader.ts) - stíšiť.
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => undefined;
    console.warn = () => undefined;
    try {
      await gp.init();
      const { meshes, coordinateInfo } = await gp.process(bytes);
      const o = renderFrameWorldOffset(coordinateInfo);
      return elementsFromMeshes(meshes, m.store, m.id, [o.x, o.y, o.z]);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      gp.dispose();
    }
  });
}

/** Svetlá vzdialenosť meshov (m) upstream clash enginom; záporná = hĺbka prieniku. */
export async function meshDistance(a: MeshElement, b: MeshElement): Promise<{ distance: number; kind: string; point: Vec3 } | null> {
  const el = (e: MeshElement): ClashElement => ({
    key: `${e.model}:${e.globalId}`,
    ref: e.expressId,
    model: e.model,
    tag: e.ifcType,
    ...(e.name ? { name: e.name } : {}),
    bounds: { min: e.bounds.min, max: e.bounds.max },
    positions: e.positions,
    indices: e.indices,
  });
  // Clearance stačí ako najväčšia možná vzdialenosť obálok (+1 m rezerva).
  const lo: Vec3 = [0, 1, 2].map((k) => Math.min(a.bounds.min[k], b.bounds.min[k])) as Vec3;
  const hi: Vec3 = [0, 1, 2].map((k) => Math.max(a.bounds.max[k], b.bounds.max[k])) as Vec3;
  const clearance = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + 1;
  const res = await createClashEngine({ backend: "ts" }).run(
    [el(a), el(b)],
    [
      {
        id: "measure",
        name: "measure",
        a: "*",
        b: "*",
        membersA: [clashMemberKey(a.model, a.expressId)],
        membersB: [clashMemberKey(b.model, b.expressId)],
        mode: "clearance",
        clearance,
        reportTouch: true,
      },
    ],
    {},
  );
  const c = res.clashes[0];
  if (!c) return null;
  return { distance: c.distance, kind: c.distanceKind ?? "unknown", point: c.point as Vec3 };
}

interface QtoValue {
  set: string;
  name: string;
  value: number;
}

/** Objem a plocha z Qto prvku (štandardné `Qto_*BaseQuantities` pred ostatnými, Net pred Gross). */
export function qtoOf(store: IfcDataStore, expressId: number): { volume?: QtoValue; area?: QtoValue; all: QtoValue[] } {
  const all: QtoValue[] = [];
  for (const set of new EntityNode(store, expressId).quantities()) {
    for (const q of set.quantities) if (Number.isFinite(q.value)) all.push({ set: set.name, name: q.name, value: q.value });
  }
  const base = (q: QtoValue) => (/BaseQuantities$/.test(q.set) ? 0 : 1);
  all.sort((x, y) => base(x) - base(y));
  const pick = (names: string[]) => {
    for (const n of names) {
      const hit = all.find((q) => q.name === n);
      if (hit) return hit;
    }
    return undefined;
  };
  return {
    volume: pick(["NetVolume", "GrossVolume", "Volume"]),
    area: pick(["NetFloorArea", "GrossFloorArea", "NetFootprintArea", "GrossFootprintArea"]),
    all,
  };
}

function compare(mesh: number, qto: QtoValue | undefined) {
  if (!qto) return null;
  const ratio = qto.value !== 0 ? mesh / qto.value : null;
  return {
    qto: `${qto.set}.${qto.name}`,
    qto_value: round(qto.value),
    mesh_value: round(mesh),
    mismatch: ratio === null ? mesh > 0 : Math.abs(ratio - 1) > MISMATCH,
  };
}

/** Rozmery a výmery jedného prvku z meshu vedľa Qto. */
export function sizeOf(e: MeshElement, store: IfcDataStore) {
  const box = ifcBox(e.bounds);
  const m = meshMetrics(e.positions, e.indices);
  const qto = qtoOf(store, e.expressId);
  return {
    bbox_m: { x: round(box.max[0] - box.min[0]), y: round(box.max[1] - box.min[1]), z: round(box.max[2] - box.min[2]) },
    bottom_z_m: round(box.min[2]),
    top_z_m: round(box.max[2]),
    surface_m2: round(m.area),
    footprint_m2: round(m.footprint),
    volume_m3: m.closed ? round(m.volume) : null,
    ...(m.closed ? {} : { volume_note: "mesh nie je uzavretý, objem z neho nie je spoľahlivý" }),
    vs_qto: {
      volume: m.closed ? compare(m.volume, qto.volume) : null,
      area: compare(m.footprint, qto.area),
    },
  };
}

/** Rozdiel dvojice: svetlá vzdialenosť, stredy, medzery po osiach IFC. */
export async function pairOf(a: MeshElement, b: MeshElement) {
  const ba = ifcBox(a.bounds);
  const bb = ifcBox(b.bounds);
  const gap = boxGap(ba, bb);
  const ca = center(ba);
  const cb = center(bb);
  const d = await meshDistance(a, b);
  const clear = d ? d.distance : null;
  return {
    clear_distance_m: clear === null ? null : round(clear),
    status: clear === null ? "unknown" : clear < -1e-4 ? "overlap" : clear <= 1e-4 ? "touch" : "gap",
    distance_kind: d?.kind ?? null,
    closest_point: d ? roundVec(toIfc(d.point)) : null,
    // Konce najkratšej úsečky v IFC svete (D-124): kóta vo vieweri; pri prieniku a dotyku null.
    closest_points: d ? pairDimension(a, b, d.point, d.distance) : null,
    center_distance_m: round(Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])),
    bbox_gap_m: { x: round(gap[0]), y: round(gap[1]), z: round(gap[2]), horizontal: round(Math.hypot(gap[0], gap[1])) },
    // a nad b: spodok a - vrch b (napr. klapka nad doskou); záporné = a je pod b.
    a_above_b_m: round(ba.min[2] - bb.max[2]),
  };
}

function parseTargets(input: Record<string, unknown>): { a: string; b: string; list: string[] } {
  const a = str(input.a);
  const b = str(input.b);
  const list = Array.isArray(input.items) ? input.items.map((v) => str(v)).filter(Boolean) : [];
  if (b && !a) throw new InputError("b bez a: zadaj oba prvky.");
  if (!a && list.length === 0) throw new InputError("Zadaj a (a voliteľne b) alebo items: object_ref, objects.id alebo IFC GlobalId.");
  if (list.length > MAX_ITEMS) throw new InputError(`items má najviac ${MAX_ITEMS} prvkov.`);
  return { a, b, list };
}

/**
 * `dimensions`: volajúci s `show=true` sem dostane kóty pre viewer (D-124) -
 * a + b svetlú vzdialenosť, len a rozmery obálky.
 */
export async function ifcMeasure(
  input: Record<string, unknown>,
  deps: EngineDeps,
  dimensions?: MeasureSegment[],
): Promise<string> {
  const { a, b, list } = parseTargets(input);
  const targets = [...new Set([a, b, ...list].filter(Boolean))];
  const refs = targets.filter((t) => !IFC_GUID_RE.test(t));
  const resolved = refs.length > 0 ? await deps.resolveTargets(refs) : new Map<string, string>();
  const guidFor = (t: string) => (IFC_GUID_RE.test(t) ? t : resolved.get(t));
  const missing = targets.filter((t) => !guidFor(t));
  if (missing.length > 0) throw new InputError(`Bez IFC GUID v AIM: ${missing.join(", ")} - zadaj IFC GlobalId (napr. z ifc_query).`);

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? getIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  // GUID -> model: najprv index (lacný), tesselácia len modelov, ktoré prvky naozaj nesú.
  const where = new Map<string, EngineModel>();
  for (const m of models) {
    const idx = await guidIndex(session, m);
    for (const t of targets) {
      const g = guidFor(t)!;
      if (!where.has(g) && idx.has(g)) where.set(g, m);
    }
  }
  const notIn = targets.filter((t) => !where.has(guidFor(t)!));
  if (notIn.length > 0) throw new InputError(`Nie je v ${modelIds.join("/")}: ${notIn.join(", ")}.`);

  const meshes = new Map<string, Map<string, MeshElement>>();
  for (const m of new Set(where.values())) meshes.set(m.id, await meshModel(m));
  const element = (t: string): MeshElement => {
    const g = guidFor(t)!;
    const m = where.get(g)!;
    const e = meshes.get(m.id)!.get(g);
    if (!e) throw new InputError(`${t} (${g}) nemá v ${m.id} geometriu (bez tela alebo ho mesher nespracoval).`);
    return e;
  };

  const joined = await joinToAim(
    targets.map((t) => {
      const e = element(t);
      return { global_id: e.globalId, model: e.model, ifc_type: e.ifcType, name: e.name, input: t };
    }),
    deps.lookup,
  );
  const ident = new Map(
    joined.items.map(({ input: key, aim_url, ...rest }) => {
      void aim_url;
      return [key as string, rest];
    }),
  );
  const storeOf = (e: MeshElement) => models.find((m) => m.id === e.model)!.store;

  const out: Record<string, unknown> = {
    engine: ENGINE_VERSION,
    source: "geometria (headless tesselácia @ifc-lite/geometry), osi IFC v metroch, Z hore",
    revision: Object.fromEntries([...meshes.keys()].map((id) => [id, revision[id]])),
  };
  if (input.clear_opening === true) {
    if (b) throw new InputError("clear_opening meria dvere jednotlivo: zadaj a alebo items, bez b.");
    Object.assign(out, clearOpenings(a ? [a, ...list] : list, element, ident, input));
  } else if (a && b) {
    const ea = element(a);
    const eb = element(b);
    out.a = { ...ident.get(a), size: sizeOf(ea, storeOf(ea)) };
    out.b = { ...ident.get(b), size: sizeOf(eb, storeOf(eb)) };
    const pair = await pairOf(ea, eb);
    out.distance = pair;
    if (dimensions && pair.closest_points) dimensions.push(pair.closest_points);
  } else {
    if (dimensions && a && list.length === 0) dimensions.push(...sizeDimensions(element(a)));
    const items = (a ? [a, ...list] : list).map((t) => {
      const e = element(t);
      return { ...ident.get(t), size: sizeOf(e, storeOf(e)) };
    });
    const sum = (f: (s: ReturnType<typeof sizeOf>) => number | null) =>
      round(items.reduce((acc, i) => acc + (f(i.size) ?? 0), 0));
    out.items = items;
    if (items.length > 1) {
      out.total = {
        volume_m3: sum((s) => s.volume_m3),
        surface_m2: sum((s) => s.surface_m2),
        footprint_m2: sum((s) => s.footprint_m2),
        open_meshes: items.filter((i) => i.size.volume_m3 === null).length,
      };
    }
  }
  out.show_in_3d = joined.show_in_3d;
  if (dimensions) out.view = dimensions.length > 0 ? `kóty vo vieweri: ${dimensions.length}` : "nič na kótovanie (prienik, dotyk alebo items)";
  if (input.clear_opening === true) return JSON.stringify(out);
  out.note =
    "clear_distance_m = najkratšia vzdialenosť povrchov (záporná = prienik). a_above_b_m = spodok a mínus vrch b. " +
    "vs_qto porovná mesh s Qto zo súboru (mismatch nad 5 %). show=true nakreslí kótu vo vieweri (a + b: closest_points, len a: hrany obálky X, Y, Z).";
  return JSON.stringify(out);
}

/** Svetlý otvor dverí z geometrie (dodatok D-118) s pass/fail voči limitu od používateľa. */
function clearOpenings(
  targets: string[],
  element: (t: string) => MeshElement,
  ident: Map<string, Record<string, unknown>>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const limit = (key: string) => {
    if (input[key] === undefined) return undefined;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n <= 0 || n > 10) throw new InputError(`${key} je v metroch (napr. 0.9).`);
    return n;
  };
  const minWidth = limit("min_width_m");
  const minHeight = limit("min_height_m");
  const hasLimit = minWidth !== undefined || minHeight !== undefined;
  const groups = { pass: [] as Record<string, unknown>[], fail: [] as Record<string, unknown>[], unknown: [] as Record<string, unknown>[] };
  const items = targets.map((t) => {
    const e = element(t);
    const id = ident.get(t) ?? {};
    if (!e.ifcType.startsWith("IfcDoor")) {
      const row = { ...id, clear_opening: null, result: "unknown", reason: `${e.ifcType}: svetlý otvor meria len IfcDoor` };
      groups.unknown.push(row);
      return row;
    }
    const measured = clearOpening(e.positions, e.indices, e.parts);
    const c = typeof measured === "string" ? null : measured;
    const fails: string[] = [];
    const reasons: string[] = typeof measured === "string" ? [measured] : [];
    if (c && c.width_m === null) reasons.push("šírku sa nepodarilo zmerať (bez zárubne po oboch stranách)");
    let unknown = !c;
    if (c && minWidth !== undefined) {
      if (c.width_m === null) unknown = true;
      else if (c.width_m < minWidth) fails.push(`šírka ${c.width_m} < ${minWidth}`);
    }
    if (c && minHeight !== undefined) {
      if (c.height_m === null) unknown = true;
      else if (c.height_m < minHeight) fails.push(`výška ${c.height_m} < ${minHeight}`);
    }
    const result = !hasLimit ? undefined : fails.length > 0 ? "fail" : unknown ? "unknown" : "pass";
    const why = [...fails, ...reasons];
    const row = { ...id, clear_opening: c, ...(result ? { result } : {}), ...(why.length > 0 ? { reason: why.join(", ") } : {}) };
    if (result) groups[result as keyof typeof groups].push(row);
    return row;
  });
  const style = (rows: Record<string, unknown>[]) => ({
    ids_or_refs: rows.flatMap((r) => (r.object_id ? [r.object_id as string] : [])),
    global_ids: rows.flatMap((r) => (r.object_id ? [] : [r.global_id as string])),
  });
  return {
    items,
    ...(hasLimit
      ? {
          check: {
            limits: { ...(minWidth !== undefined ? { min_width_m: minWidth } : {}), ...(minHeight !== undefined ? { min_height_m: minHeight } : {}) },
            pass: groups.pass.length,
            fail: groups.fail.length,
            unknown: groups.unknown.length,
            // Vstup pre style_in_3d: pass zelená, fail červená.
            style_pass: style(groups.pass),
            style_fail: style(groups.fail),
          },
        }
      : {}),
    note:
      "clear_opening z geometrie dverí: width_m = svetlá šírka medzi zárubňami (najužšie miesto cez hĺbku, medián výšok), " +
      "height_m = od prahu alebo spodku dverí po nadpražie; overall_* = obálka so zárubňou. Psety (AIM_Door.ClearWidth, " +
      "OverallWidth) nie sú zdroj, len kontrola. Krídlo otvorené o 90° a kľučka sa neodpočítavajú; width_min_m = užšie miesto " +
      "v niektorej výške (lišta, kovanie). Limit dáva používateľ, nie norma v tooli.",
  };
}
