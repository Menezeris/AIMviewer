import { EntityExtractor, type IfcDataStore } from "@ifc-lite/parser";
import { EntityNode } from "@ifc-lite/query";

import { requestIfcModels } from "../project/request-models";

import { joinToAim } from "./join";
import { ifcBox, meshModel, type Box, type MeshElement, type Vec3 } from "./measure";
import { WALK_HEIGHT_M, routeLine } from "./route-line";
import { openEngineSession, type EngineModel } from "./session";
import { ENGINE_VERSION, IFC_GUID_RE, InputError, guidIndex, modelsFor, str, type EngineDeps } from "./tools";

/**
 * `ifc_measure` with `route` (D-121): shortest and escape path through the building.
 *
 * The graph comes from the file: spaces (IfcSpace) connected by doors via
 * IfcRelSpaceBoundary (RelatingSpace = space, RelatedBuildingElement =
 * door), storeys are connected by a stair (IfcStair, bottom = space on its
 * storey, top = space on the storey above it, both by plan overlap).
 * Length in a space = a straight line in plan between doors (start and goal at the centre
 * of the element), stair = length of the flights. It is a LOWER ESTIMATE: furniture, an L shape and
 * the passage width are not taken into account, the output says so. Exit (escape) = a door with
 * Pset_DoorCommon.IsExternal or with a single EXTERNAL boundary, not revolving
 * (OperationType REVOLVING*, occurrence or type). The tool does not judge length limits
 * from standards (they belong to the IDS library).
 */

export const ROUTES = ["shortest", "escape"] as const;
export type Route = (typeof ROUTES)[number];

type Pt = [number, number];

export interface NavSpace {
  globalId: string;
  name: string | null;
  storey: string | null;
  /** Plan centre (IFC x, y). */
  center: Pt;
  /** Plan triangles (IFC x, y) and the envelope height for the point test. */
  triangles: Float64Array;
  zMin: number;
  zMax: number;
}

export interface NavDoor {
  globalId: string;
  name: string | null;
  center: Pt;
  storey: string | null;
  spaces: string[];
  exit: boolean;
}

export interface NavStair {
  globalId: string;
  name: string | null;
  bottom: string;
  top: string;
  center: Pt;
  length: number;
  /** Flights (IfcStairFlight) for drawing the line (D-137); empty = the whole stair. */
  flights: string[];
  /** Stair elements with geometry (the stair and its parts). */
  parts: string[];
}

export interface NavData {
  spaces: Map<string, NavSpace>;
  doors: Map<string, NavDoor>;
  stairs: NavStair[];
  /** External doors above the exit storey (not taken into account). */
  upperExits: string[];
  /** Revolving doors: passable, but not an escape exit. */
  revolving: string[];
}

/** Start or goal: a space, a door, or a point in a space (element centre). */
export type Endpoint = { kind: "space"; space: string } | { kind: "door"; door: string } | { kind: "point"; globalId: string; space: string; at: Pt };

export interface Step {
  kind: "space" | "door" | "stair";
  global_id: string;
  segment_m?: number;
  storey?: string | null;
  storey_to?: string | null;
  /** Stair going up (only for the route line, D-137; it does not go into the output). */
  up?: boolean;
}

export interface RouteResult {
  length: number;
  steps: Step[];
  /** Goal door for escape. */
  exit?: string;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A point in the plan of a space (and at the height of its envelope). */
export function spaceContains(s: NavSpace, p: Pt, z: number): boolean {
  if (z < s.zMin - 0.05 || z > s.zMax + 0.05) return false;
  const t = s.triangles;
  for (let i = 0; i + 5 < t.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = [t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5]];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by - cy) * (p[0] - cx) + (cx - bx) * (p[1] - cy)) / d;
    const l2 = ((cy - ay) * (p[0] - cx) + (ax - cx) * (p[1] - cy)) / d;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l1 + l2 <= 1 + 1e-9) return true;
  }
  return false;
}

/** Plan triangles of a mesh (Y-up -> IFC x, y), only faces with a non-zero projection. */
function planTriangles(e: MeshElement): Float64Array {
  const out: number[] = [];
  const p = e.positions;
  for (let t = 0; t + 2 < e.indices.length; t += 3) {
    const [a, b, c] = [e.indices[t] * 3, e.indices[t + 1] * 3, e.indices[t + 2] * 3];
    const tri = [p[a], -p[a + 2], p[b], -p[b + 2], p[c], -p[c + 2]];
    const area = (tri[2] - tri[0]) * (tri[5] - tri[1]) - (tri[4] - tri[0]) * (tri[3] - tri[1]);
    if (Math.abs(area) > 1e-9) out.push(...tri);
  }
  return Float64Array.from(out);
}

const planCenter = (b: Box): Pt => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
const planOverlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])) *
  Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));

const ids = (store: IfcDataStore, type: string) => store.entityIndex.byType.get(type) ?? [];
const enumOf = (v: unknown) => (typeof v === "string" ? v.replace(/\./g, "").toUpperCase() : "");

/** Graph from the file: spaces, doors with space boundaries, stairs. */
export function navDataFromModel(store: IfcDataStore, meshes: Map<string, MeshElement>): NavData {
  const spaces = new Map<string, NavSpace>();
  const spaceBox = new Map<string, Box>();
  const byExpress = new Map<number, string>();
  for (const id of ids(store, "IFCSPACE")) {
    const gid = store.entities.getGlobalId(id);
    const e = gid ? meshes.get(gid) : undefined;
    if (!gid || !e) continue;
    const box = ifcBox(e.bounds);
    spaceBox.set(gid, box);
    byExpress.set(id, gid);
    spaces.set(gid, {
      globalId: gid,
      name: e.name,
      storey: new EntityNode(store, id).storey()?.name ?? null,
      center: planCenter(box),
      triangles: planTriangles(e),
      zMin: box.min[2],
      zMax: box.max[2],
    });
  }

  // Space boundaries (also 1st/2nd level subclasses): RelatingSpace (4), RelatedBuildingElement (5), InternalOrExternal (8).
  const extractor = new EntityExtractor(store.source);
  const doorSpaces = new Map<number, Set<string>>();
  const doorExternal = new Set<number>();
  for (const type of ["IFCRELSPACEBOUNDARY", "IFCRELSPACEBOUNDARY1STLEVEL", "IFCRELSPACEBOUNDARY2NDLEVEL"]) {
    for (const id of ids(store, type)) {
      const ref = store.entityIndex.byId.get(id);
      const attrs = ref ? extractor.extractEntity(ref)?.attributes : undefined;
      if (!attrs) continue;
      const space = typeof attrs[4] === "number" ? byExpress.get(attrs[4]) : undefined;
      const el = attrs[5];
      if (!space || typeof el !== "number" || !/^IFCDOOR$/i.test(store.entities.getTypeName(el) ?? "")) continue;
      let set = doorSpaces.get(el);
      if (!set) doorSpaces.set(el, (set = new Set()));
      set.add(space);
      if (enumOf(attrs[8]) === "EXTERNAL") doorExternal.add(el);
    }
  }
  const doors = new Map<string, NavDoor>();
  const revolving: string[] = [];
  for (const [id, set] of doorSpaces) {
    const gid = store.entities.getGlobalId(id);
    const e = gid ? meshes.get(gid) : undefined;
    if (!gid || !e) continue;
    const node = new EntityNode(store, id);
    const isExternal = node.property("Pset_DoorCommon", "IsExternal") === true;
    // Revolving doors are not an escape exit; OperationType of the occurrence, otherwise from the type.
    const operation = (n: EntityNode | null) => enumOf(n?.allAttributes().find((a) => a.name === "OperationType")?.value);
    const op = operation(node) || operation(node.definingType());
    const isRevolving = op.startsWith("REVOLVING");
    if (isRevolving) revolving.push(gid);
    doors.set(gid, {
      globalId: gid,
      name: e.name,
      center: planCenter(ifcBox(e.bounds)),
      storey: node.storey()?.name ?? null,
      spaces: [...set].sort(),
      exit: !isRevolving && (isExternal || (doorExternal.has(id) && set.size === 1)),
    });
  }

  // Storey order by the bottom of their spaces (the storey height is not in the attributes).
  const storeyZ = new Map<string, number>();
  for (const s of spaces.values()) if (s.storey) storeyZ.set(s.storey, Math.min(storeyZ.get(s.storey) ?? Infinity, s.zMin));
  const storeyOrder = [...storeyZ.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);

  const stairs: NavStair[] = [];
  for (const id of ids(store, "IFCSTAIR")) {
    const node = new EntityNode(store, id);
    const predefined = node.allAttributes().find((a) => a.name === "PredefinedType")?.value;
    if (enumOf(predefined) === "LADDER") continue;
    const gid = store.entities.getGlobalId(id);
    const parts = node.decomposes();
    const elements = [gid, ...parts.map((p) => p.globalId)].map((g) => (g ? meshes.get(g) : undefined)).filter((e): e is MeshElement => !!e);
    if (!gid || elements.length === 0) continue;
    const boxes = elements.map((e) => ifcBox(e.bounds));
    const box: Box = {
      min: [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))) as Box["min"],
      max: [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k]))) as Box["max"],
    };
    // Length = flights (projection of the longer side and the rise); without flights the whole stair.
    const flightIds = parts.filter((p) => /^IFCSTAIRFLIGHT$/i.test(p.type) && meshes.has(p.globalId)).map((p) => p.globalId);
    const flights = flightIds.map((g) => meshes.get(g)!);
    const runOf = (b: Box) => Math.hypot(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]), b.max[2] - b.min[2]);
    const length = flights.length > 0 ? flights.reduce((acc, f) => acc + runOf(ifcBox(f.bounds)), 0) : runOf(box);
    const storey = node.storey()?.name ?? null;
    const above = storey ? storeyOrder[storeyOrder.indexOf(storey) + 1] : undefined;
    // The storey space in whose plan the stair centre lies (stairwell),
    // otherwise the largest envelope overlap.
    const at = planCenter(box);
    const best = (label: string | undefined) => {
      const onStorey = [...spaces.values()].filter((s) => label && s.storey === label);
      const inside = onStorey.find((s) => spaceContains(s, at, s.zMin + 0.5));
      if (inside) return inside.globalId;
      let hit: string | null = null;
      let area = 0;
      for (const s of onStorey) {
        const a = planOverlap(spaceBox.get(s.globalId)!, box);
        if (a > area) [hit, area] = [s.globalId, a];
      }
      return hit;
    };
    const bottom = best(storey ?? undefined);
    const top = best(above);
    const withMesh = [gid, ...parts.map((p) => p.globalId)].filter((g): g is string => !!g && meshes.has(g));
    if (bottom && top) stairs.push({ globalId: gid, name: node.name || null, bottom, top, center: at, length, flights: flightIds, parts: withMesh });
  }
  // Exit = external doors on the lowest storey that has any (terrain); external doors
  // higher up (roof, terrace) are not a safe goal of an escape route.
  const exitStoreys = [...doors.values()].filter((d) => d.exit).map((d) => storeyOrder.indexOf(d.storey ?? "")).filter((i) => i >= 0);
  const ground = exitStoreys.length > 0 ? Math.min(...exitStoreys) : -1;
  const upperExits: string[] = [];
  for (const d of doors.values()) {
    if (d.exit && storeyOrder.indexOf(d.storey ?? "") > ground && ground >= 0) {
      d.exit = false;
      upperExits.push(d.globalId);
    }
  }
  return { spaces, doors, stairs, upperExits, revolving };
}

interface Edge {
  to: string;
  cost: number;
  step: Step;
}

/**
 * Dijkstra over "portals" (doors, stair ends, start, goal). In a space
 * a straight line runs between each pair of portals, a door is a shared portal
 * of two spaces, a stair connects the bottom and top portal.
 */
export function findRoute(nav: NavData, from: Endpoint, to: Endpoint | "exit"): RouteResult | null {
  const portalsIn = new Map<string, Array<{ key: string; at: Pt }>>();
  const add = (space: string, key: string, at: Pt) => {
    let list = portalsIn.get(space);
    if (!list) portalsIn.set(space, (list = []));
    list.push({ key, at });
  };
  for (const d of nav.doors.values()) for (const s of d.spaces) add(s, `door:${d.globalId}`, d.center);
  const stairEdges = new Map<string, Edge[]>();
  for (const st of nav.stairs) {
    const lo = `stair:${st.globalId}:bottom`;
    const hi = `stair:${st.globalId}:top`;
    add(st.bottom, lo, st.center);
    add(st.top, hi, st.center);
    const step = (dir: "up" | "down"): Step => ({
      kind: "stair",
      global_id: st.globalId,
      segment_m: st.length,
      storey: nav.spaces.get(dir === "up" ? st.bottom : st.top)?.storey ?? null,
      storey_to: nav.spaces.get(dir === "up" ? st.top : st.bottom)?.storey ?? null,
      up: dir === "up",
    });
    stairEdges.set(lo, [{ to: hi, cost: st.length, step: step("up") }]);
    stairEdges.set(hi, [{ to: lo, cost: st.length, step: step("down") }]);
  }
  const placeOf = (ep: Endpoint): { key: string; spaces: Array<{ space: string; at: Pt }> } => {
    if (ep.kind === "door") {
      const d = nav.doors.get(ep.door)!;
      return { key: `door:${d.globalId}`, spaces: [] };
    }
    if (ep.kind === "space") return { key: `space:${ep.space}`, spaces: [{ space: ep.space, at: nav.spaces.get(ep.space)!.center }] };
    return { key: `point:${ep.globalId}`, spaces: [{ space: ep.space, at: ep.at }] };
  };
  const start = placeOf(from);
  for (const s of start.spaces) add(s.space, start.key, s.at);
  const goal = to === "exit" ? null : placeOf(to);
  if (goal && goal.key !== start.key) for (const s of goal.spaces) add(s.space, goal.key, s.at);

  const neighbours = (key: string): Edge[] => {
    const out: Edge[] = [...(stairEdges.get(key) ?? [])];
    for (const [space, list] of portalsIn) {
      const me = list.find((p) => p.key === key);
      if (!me) continue;
      for (const p of list) {
        if (p.key === key) continue;
        const cost = dist(me.at, p.at);
        out.push({ to: p.key, cost, step: { kind: "space", global_id: space, segment_m: cost, storey: nav.spaces.get(space)?.storey ?? null } });
      }
    }
    return out;
  };
  const isGoal = (key: string) =>
    goal ? key === goal.key : key.startsWith("door:") && nav.doors.get(key.slice(5))?.exit === true;

  const distTo = new Map<string, number>([[start.key, 0]]);
  const prev = new Map<string, { from: string; step: Step }>();
  const done = new Set<string>();
  // Small graph (hundreds of portals): a linear minimum selection suffices.
  for (;;) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, v] of distTo) if (!done.has(k) && v < best) [cur, best] = [k, v];
    if (cur === null) return null;
    if (isGoal(cur)) {
      const steps: Step[] = [];
      for (let k = cur; prev.has(k); k = prev.get(k)!.from) {
        const p = prev.get(k)!;
        steps.unshift({ ...p.step }, ...(k.startsWith("door:") ? [{ kind: "door" as const, global_id: k.slice(5) }] : []));
      }
      if (cur.startsWith("door:") && steps.length === 0) steps.push({ kind: "door", global_id: cur.slice(5) });
      if (start.key.startsWith("door:") && steps[0]?.global_id !== start.key.slice(5)) steps.unshift({ kind: "door", global_id: start.key.slice(5) });
      return { length: best, steps, ...(goal ? {} : { exit: cur.slice(5) }) };
    }
    done.add(cur);
    for (const e of neighbours(cur)) {
      const nd = best + e.cost;
      if (nd < (distTo.get(e.to) ?? Infinity)) {
        distTo.set(e.to, nd);
        prev.set(e.to, { from: cur, step: e.step });
      }
    }
  }
}

/** All exits sorted by length (escape: the nearest and the others). */
export function exitsByLength(nav: NavData, from: Endpoint, limit: number): RouteResult[] {
  const out: RouteResult[] = [];
  for (const d of nav.doors.values()) {
    if (!d.exit) continue;
    const r = findRoute(nav, from, { kind: "door", door: d.globalId });
    if (r) out.push({ ...r, exit: d.globalId });
  }
  return out.sort((a, b) => a.length - b.length).slice(0, limit);
}

/** Spaces reachable from the start via doors and stairs (for reporting a disconnected graph). */
export function reachableSpaces(nav: NavData, from: Endpoint): Set<string> {
  const start =
    from.kind === "door" ? (nav.doors.get(from.door)?.spaces ?? []) : [from.space];
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const s = queue.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const d of nav.doors.values()) if (d.spaces.includes(s)) queue.push(...d.spaces);
    for (const st of nav.stairs) {
      if (st.bottom === s) queue.push(st.top);
      if (st.top === s) queue.push(st.bottom);
    }
  }
  return seen;
}

/** Goal -> point in the graph: a space, a door with a boundary, otherwise the element centre in a space. */
function endpointOf(nav: NavData, gid: string, e: MeshElement | undefined, label: string): Endpoint {
  if (nav.spaces.has(gid)) return { kind: "space", space: gid };
  if (nav.doors.has(gid)) return { kind: "door", door: gid };
  if (!e) throw new InputError(`${label} nemá geometriu, nedá sa umiestniť do miestnosti.`);
  const box = ifcBox(e.bounds);
  const at = planCenter(box);
  // Height for the test: a bit above the bottom of the element (a door without a boundary, furniture, equipment).
  const z = Math.min(box.max[2], box.min[2] + 0.5);
  for (const s of nav.spaces.values()) if (spaceContains(s, at, z)) return { kind: "point", globalId: gid, space: s.globalId, at };
  throw new InputError(`${label} neleží v žiadnej miestnosti (IfcSpace) modelu.`);
}

/** `line` = collector of line points for the live viewer (show=true, D-137); the command is assembled by `route-line`. */
export async function ifcRoute(input: Record<string, unknown>, deps: EngineDeps, line?: Vec3[]): Promise<string> {
  const route = str(input.route) as Route;
  if (!(ROUTES as readonly string[]).includes(route)) throw new InputError("route: shortest | escape.");
  const a = str(input.a);
  const b = str(input.b);
  if (!a) throw new InputError("route potrebuje a = odkiaľ (miestnosť, dvere alebo prvok).");
  if (route === "shortest" && !b) throw new InputError("route=shortest potrebuje aj b = kam; k najbližšiemu východu je route=escape.");
  if (route === "escape" && b) throw new InputError("route=escape hľadá najbližší východ sám, b nezadávaj.");

  const targets = [...new Set([a, b].filter(Boolean))];
  const refs = targets.filter((t) => !IFC_GUID_RE.test(t));
  const resolved = refs.length > 0 ? await deps.resolveTargets(refs) : new Map<string, string>();
  const guidFor = (t: string) => (IFC_GUID_RE.test(t) ? t : resolved.get(t));
  const missing = targets.filter((t) => !guidFor(t));
  if (missing.length > 0) throw new InputError(`Bez IFC GUID v AIM: ${missing.join(", ")} - zadaj IFC GlobalId (napr. z ifc_query).`);

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? requestIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  // Route model = the model that carries the start (spaces and doors are in one model).
  let model: EngineModel | undefined;
  for (const m of models) {
    if ((await guidIndex(session, m)).has(guidFor(a)!)) {
      model = m;
      break;
    }
  }
  if (!model) throw new InputError(`${a} nie je v ${modelIds.join("/")}.`);
  const meshes = await meshModel(model);
  const nav = navDataFromModel(model.store, meshes);
  if (nav.doors.size === 0) {
    throw new InputError(
      `Model ${model.id} nemá hranice priestorov pri dverách (IfcRelSpaceBoundary s IfcDoor), graf miestností sa nedá zostaviť.`,
    );
  }

  const from = endpointOf(nav, guidFor(a)!, meshes.get(guidFor(a)!), a);
  let results: RouteResult[];
  let to: Endpoint | null = null;
  if (route === "escape") {
    results = exitsByLength(nav, from, 3);
    if (results.length === 0) {
      const reach = reachableSpaces(nav, from).size;
      throw new InputError(
        `Z ${a} nevedie cesta k žiadnemu východu (vonkajšie dvere na teréne) v grafe modelu ${model.id}: dosiahnuteľných ` +
          `${reach} z ${nav.spaces.size} miestností. Graf je nesúvislý, niektorým dverám chýbajú hranice priestorov ` +
          `(IfcRelSpaceBoundary) - over ifc_relations(rel_types=[IfcRelSpaceBoundary]) na dverách po ceste.`,
      );
    }
  } else {
    to = endpointOf(nav, guidFor(b)!, meshes.get(guidFor(b)!), b);
    const r = findRoute(nav, from, to);
    if (!r) throw new InputError(`Medzi ${a} a ${b} nevedie cesta cez dvere a schodiská v grafe modelu ${model.id}.`);
    results = [r];
  }
  const [best, ...others] = results;
  if (line) line.push(...routeLine(nav, meshes, from, best, to));

  const meta = (gid: string) => {
    const s = nav.spaces.get(gid);
    const d = nav.doors.get(gid);
    const st = nav.stairs.find((x) => x.globalId === gid);
    const e = meshes.get(gid);
    return { name: s?.name ?? d?.name ?? st?.name ?? e?.name ?? null, ifc_type: e?.ifcType ?? null };
  };
  const pathGuids = [...new Set([guidFor(a)!, ...best.steps.map((s) => s.global_id), ...(b ? [guidFor(b)!] : [])])];
  const joined = await joinToAim(
    [...pathGuids, ...others.map((r) => r.exit!).filter((g) => !pathGuids.includes(g))].map((g) => ({ global_id: g, ...meta(g) })),
    deps.lookup,
  );
  const ident = new Map(
    joined.items.map(({ aim_url, ...rest }) => {
      void aim_url;
      return [rest.global_id, rest];
    }),
  );
  // Only the route goes into 3D, not the other exits.
  const onPath = joined.items.filter((i) => pathGuids.includes(i.global_id));
  const show_in_3d = {
    ids_or_refs: onPath.flatMap((i) => (i.object_id ? [i.object_id] : [])),
    global_ids: onPath.flatMap((i) => (i.object_id ? [] : [i.global_id])),
  };

  const steps = best.steps.map((s, i) => ({
    step: i + 1,
    kind: s.kind,
    ...ident.get(s.global_id),
    ...(s.storey !== undefined ? { storey: s.storey } : {}),
    ...(s.storey_to !== undefined ? { storey_to: s.storey_to } : {}),
    ...(s.segment_m !== undefined ? { segment_m: round(s.segment_m) } : {}),
  }));
  const out: Record<string, unknown> = {
    engine: ENGINE_VERSION,
    source: `graf zo súboru ${model.id}: IfcSpace, IfcDoor cez IfcRelSpaceBoundary, IfcStair; dĺžky z geometrie`,
    revision: { [model.id]: revision[model.id] },
    route,
    length_m: round(best.length, 1),
    length_kind: "dolný odhad",
    from: ident.get(guidFor(a)!),
    ...(route === "shortest" ? { to: ident.get(guidFor(b)!) } : { exit: ident.get(best.exit!) }),
    steps,
    storey_changes: best.steps
      .filter((s) => s.kind === "stair")
      .map((s) => ({ from: s.storey, to: s.storey_to, stair: ident.get(s.global_id)?.object_ref ?? s.global_id })),
    ...(others.length > 0
      ? { other_exits: others.map((r) => ({ exit: ident.get(r.exit!), length_m: round(r.length, 1) })) }
      : {}),
    graph: {
      spaces: nav.spaces.size,
      doors: nav.doors.size,
      exits: [...nav.doors.values()].filter((d) => d.exit).length,
      stairs: nav.stairs.length,
      ...(nav.upperExits.length > 0
        ? { upper_external_doors_not_exits: nav.upperExits.map((g) => nav.doors.get(g)?.name ?? g) }
        : {}),
      ...(nav.revolving.length > 0 ? { revolving_doors_not_exits: nav.revolving.map((g) => nav.doors.get(g)?.name ?? g) } : {}),
    },
    show_in_3d,
    ...(line
      ? {
          line: {
            shown: line.length >= 2,
            points: line.length,
            height_m: WALK_HEIGHT_M,
            color: "červená",
            note: "Čiara vo vieweri 1,6 m nad podlahou, krytinou a stupňami schodiska, stredom dverí; zmaže ju reset farieb.",
          },
        }
      : {}),
    note:
      "length_m je DOLNÝ ODHAD skutočnej pochôdznej dĺžky: priamky v pôdoryse medzi dverami cez miestnosti " +
      "(štart a cieľ v strede prvku), schodisko = dĺžka ramien; nábytok, tvar miestnosti, šírku priechodu ani " +
      "zamknuté dvere nezohľadní. Výťahy nie sú v grafe. Limity dĺžky únikovej cesty podľa noriem tool neposudzuje.",
  };
  return JSON.stringify(out);
}
