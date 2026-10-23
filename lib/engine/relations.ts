import { getIfcModels } from "../data/ifc-models";

import { joinToAim } from "./join";
import { openEngineSession } from "./session";
import {
  ENGINE_VERSION,
  IFC_GUID_RE,
  InputError,
  clamp,
  guidIndex,
  modelsFor,
  str,
  structured,
  type EngineDeps,
} from "./tools";

/**
 * `ifc_relations` (D-097): všetky IFC vzťahy jednej entity priamo zo súboru -
 * aj entity, ktorú graf AIM nepozná (zóna, port, systém len v súbore).
 * Adaptér nad upstream `relationships` (D-087): balík vráti hrany grafu v oboch
 * smeroch s presnou triedou IfcRel*, tu sa len filtrujú, rekurzívne rozvinú,
 * doplnia o GlobalId druhej strany a object_ref z AIM a stránkujú.
 *
 * Smer je smer balíka: forward = entita je Relating strana (skupina -> členovia,
 * podlažie -> prvky, celok -> časti, prvok -> porty), inverse = Related strana
 * (kam entita patrí).
 */

type Direction = "forward" | "inverse";
const DIRECTIONS = ["forward", "inverse", "both"] as const;
/** Väčší strop než ostatné ifc_* (20 000): zoznam členov má prejsť na málo stránok. */
const MAX_RESULT_CHARS = 40_000;
const MAX_DEPTH = 10;
/** Strop prechodu pri rekurzii (ochrana pred celým grafom modelu v jednom volaní). */
const MAX_ROWS = 20_000;
/** Rekurzia bez rel_types ide len cez členstvo (vnorené zóny, systémy); cez všetko by prešla celý model. */
const RECURSIVE_DEFAULT = "IfcRelAssignsToGroup";
/** Psety a Qto dáva ifc_get; bez výslovného rel_types by zahltili zoznam. */
const HIDDEN_BY_DEFAULT = new Set(["relassociatesproperties", "reldefinesbyproperties"]);

interface UpstreamEdge {
  relationshipId: number;
  relationshipType: string;
  direction: Direction;
  entity: { id: number; name?: string; type: string };
}

interface Row {
  rel_type: string;
  direction: Direction;
  depth?: number;
  via?: string;
  via_port?: string;
  port?: string;
  global_id: string;
  ifc_type: string;
  name: string | null;
}

/** IfcRelAssignsToGroup / IFCRELASSIGNSTOGROUP / AssignsToGroup -> "relassignstogroup". */
export function relKey(raw: string): string {
  const k = raw.toLowerCase().replace(/^ifc/, "");
  return k.startsWith("rel") ? k : `rel${k}`;
}

/** Kľúč relKey -> zápis, ako ho dal volajúci. */
function parseRelTypes(raw: unknown): Map<string, string> {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out = new Map<string, string>();
  for (const v of list) {
    const s = str(v);
    if (!/^[A-Za-z]{3,60}$/.test(s)) throw new InputError(`rel_types: '${String(v)}' nie je trieda IfcRel* (napr. IfcRelAssignsToGroup).`);
    out.set(relKey(s), s);
  }
  return out;
}

const isPort = (type: string) => /port$/i.test(type);

/** Zastavenie prechodu sieťou (D-110): IFC trieda, voliteľne s PredefinedType (`IfcDamper.FIREDAMPER`). */
interface StopRule {
  cls: string;
  predefined?: string;
}

function parseStopAt(raw: unknown): StopRule[] {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((v) => {
    const s = str(v);
    const m = /^(Ifc[A-Za-z0-9]+)(?:\.([A-Za-z0-9_]+))?$/.exec(s);
    if (!m) throw new InputError(`stop_at: '${String(v)}' nie je IFC trieda (napr. IfcUnitaryEquipment alebo IfcDamper.FIREDAMPER).`);
    return { cls: m[1].toLowerCase(), ...(m[2] ? { predefined: m[2].toUpperCase() } : {}) };
  });
}

export async function ifcRelations(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const target = str(input.target);
  if (!target) throw new InputError("Zadaj target (object_ref, objects.id alebo IFC GlobalId).");
  const recursive = input.recursive === true;
  const relTypes = parseRelTypes(input.rel_types);
  if (recursive && relTypes.size === 0 && input.through_ports !== true) relTypes.set(relKey(RECURSIVE_DEFAULT), RECURSIVE_DEFAULT);
  const direction = str(input.direction) || "both";
  if (!(DIRECTIONS as readonly string[]).includes(direction)) throw new InputError("direction: forward | inverse | both.");
  const throughPorts = input.through_ports === true;
  const stopAt = parseStopAt(input.stop_at);
  const maxSteps = clamp(input.max_steps, 1, 200, 50);
  if (stopAt.length > 0 && !(throughPorts && recursive)) {
    throw new InputError("stop_at platí len pri prechode sieťou: through_ports=true a recursive=true.");
  }
  if (recursive && direction === "both" && !throughPorts) {
    throw new InputError("recursive potrebuje direction forward (členovia, časti) alebo inverse (kam patrí).");
  }
  const limit = clamp(input.limit, 1, 200, 100);
  const offset = clamp(Number(input.cursor ?? 0), 0, Number.MAX_SAFE_INTEGER, 0);

  const guid = IFC_GUID_RE.test(target) ? target : (await deps.resolveTargets([target])).get(target);
  if (!guid) throw new InputError(`'${target}' v AIM nie je alebo nemá IFC GUID - zadaj IFC GlobalId (napr. z ifc_query).`);

  const modelIds = str(input.model) ? [str(input.model)] : (deps.sources ?? getIfcModels)().map((m) => m.id);
  const { models, revision } = await modelsFor(modelIds, deps);
  const session = await openEngineSession(models);
  let model: (typeof models)[number] | undefined;
  let rootId: number | undefined;
  for (const m of models) {
    rootId = (await guidIndex(session, m)).get(guid);
    if (rootId !== undefined) {
      model = m;
      break;
    }
  }
  if (!model || rootId === undefined) throw new InputError(`GUID ${guid} nie je v ${modelIds.join("/")}.`);

  const entities = model.store.entities;
  const guidOf = (id: number) => entities.getGlobalId(id) || "";
  const cache = new Map<number, UpstreamEdge[]>();
  const edgesOf = async (id: number): Promise<UpstreamEdge[]> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const res = structured<{ relations?: UpstreamEdge[] }>(
      await session.call("relationships", { model_id: model.id, express_id: id }),
    );
    const edges = res.relations ?? [];
    cache.set(id, edges);
    return edges;
  };
  const row = (e: UpstreamEdge, extra: Partial<Row> = {}): Row => ({
    rel_type: e.relationshipType,
    direction: e.direction,
    ...extra,
    global_id: guidOf(e.entity.id),
    ifc_type: e.entity.type,
    name: e.entity.name ?? null,
  });

  // PredefinedType len pre kandidátov na zastavenie (stop_at s typom), nie pre celú sieť.
  // Typovaný výskyt ho podľa IFC nemá ($ alebo NOTDEFINED) a nesie ho typ cez IfcRelDefinesByType (D-165).
  const predefinedAttr = async (id: number): Promise<string | null> => {
    const res = structured<{ attributes?: Array<{ name?: string; value?: unknown }> }>(
      await session.call("get_entity", { model_id: model.id, express_id: id, include: ["attributes"] }),
    );
    const v = (res.attributes ?? []).find((a) => a.name === "PredefinedType")?.value;
    return typeof v === "string" ? v.replace(/^\.|\.$/g, "").toUpperCase() : null;
  };
  const predefinedOf = async (id: number): Promise<string | null> => {
    const own = await predefinedAttr(id);
    if (own && own !== "NOTDEFINED") return own;
    const typeEdge = (await edgesOf(id)).find((e) => e.relationshipType.toUpperCase() === "IFCRELDEFINESBYTYPE" && /type$/i.test(e.entity.type));
    const fromType = typeEdge ? await predefinedAttr(typeEdge.entity.id) : null;
    return fromType ?? own;
  };
  const trace = throughPorts && recursive ? await traceNetwork(rootId, edgesOf, guidOf, row, { stopAt, maxSteps, predefinedOf }) : null;
  const rows: Row[] = trace
    ? trace.rows
    : throughPorts
      ? await portConnections(rootId, edgesOf, guidOf, row)
      : await walk(rootId, edgesOf, guidOf, row, { relTypes, direction, recursive });
  const incomplete = rows.length >= MAX_ROWS;
  const pathJoined = trace?.reached[0] ? await joinToAim(trace.reached[0].path.map((g) => ({ global_id: g })), deps.lookup) : null;

  const counts = new Map<string, { rel_type: string; direction: string; count: number }>();
  for (const r of rows) {
    const k = `${r.rel_type}|${r.direction}`;
    const c = counts.get(k) ?? { rel_type: r.rel_type, direction: r.direction, count: 0 };
    c.count++;
    counts.set(k, c);
  }

  const [rootJoined] = (
    await joinToAim(
      [{ global_id: guid, ifc_type: entities.getTypeName(rootId), name: entities.getName(rootId) || null }],
      deps.lookup,
    )
  ).items;
  const { aim_url: _url, ...targetOut } = rootJoined;
  void _url;

  // Dávka sa skráti tak, aby sa výsledok zmestil celý (nikdy nie orezaný JSON).
  let size = Math.min(limit, Math.max(0, rows.length - offset));
  for (;;) {
    const page = rows.slice(offset, offset + size);
    const joined = await joinToAim(page, deps.lookup);
    // Kompaktné riadky: väzba na AIM len pri prvkoch, ktoré AIM pozná.
    const items = joined.items.map((item) => {
      const { object_id, object_ref, aim_url, ...rest } = item;
      void aim_url;
      return object_id ? { ...rest, object_id, object_ref } : rest;
    });
    const next = offset + page.length < rows.length ? String(offset + page.length) : null;
    const text = JSON.stringify({
      engine: ENGINE_VERSION,
      model: model.id,
      revision: revision[model.id],
      target: targetOut,
      filter: {
        ...(relTypes.size > 0 ? { rel_types: [...relTypes.values()] } : { hidden: "IfcRelDefinesByProperties (psety a Qto dáva ifc_get)" }),
        direction: throughPorts ? "through_ports" : direction,
        ...(recursive ? { recursive: true } : {}),
        ...(trace ? { max_steps: maxSteps, ...(stopAt.length ? { stop_at: input.stop_at } : {}) } : {}),
      },
      ...(trace
        ? {
            reached: trace.reached,
            ...(pathJoined ? { path_show_in_3d: pathJoined.show_in_3d } : {}),
            ...(trace.cutOff ? { cut_off: `sieť pokračuje za ${maxSteps} krokmi - zvýš max_steps` } : {}),
            ...(stopAt.length && trace.reached.length === 0 && !trace.cutOff
              ? { note: "Prejdená sieť neobsahuje prvok vyhovujúci stop_at (trieda alebo PredefinedType, aj z typu prvku). Ak očakávaš zhodu, skontroluj triedu a PredefinedType cez ifc_get; porty bez napojenia sieť skracujú." }
              : {}),
          }
        : {}),
      total: rows.length,
      ...(incomplete ? { incomplete: `prechod zastavený na ${MAX_ROWS} vzťahoch - zúž rel_types` } : {}),
      counts: [...counts.values()],
      returned: page.length,
      cursor: String(offset),
      next_cursor: next,
      unmapped: joined.unmapped,
      items,
      show_in_3d: joined.show_in_3d,
    });
    if (text.length <= MAX_RESULT_CHARS || size <= 1) return text;
    size = Math.max(1, Math.floor(size * 0.7));
  }
}

type EdgesOf = (id: number) => Promise<UpstreamEdge[]>;
type MakeRow = (e: UpstreamEdge, extra?: Partial<Row>) => Row;

/** Vzťahy entity; s `recursive` do šírky cez tie isté typy a smer (vnorené zóny, systémy, agregácie). */
async function walk(
  rootId: number,
  edgesOf: EdgesOf,
  guidOf: (id: number) => string,
  row: MakeRow,
  opts: { relTypes: Map<string, string>; direction: string; recursive: boolean },
): Promise<Row[]> {
  const matches = (e: UpstreamEdge) => {
    const k = relKey(e.relationshipType);
    const typeOk = opts.relTypes.size > 0 ? opts.relTypes.has(k) : !HIDDEN_BY_DEFAULT.has(k);
    return typeOk && (opts.direction === "both" || e.direction === opts.direction);
  };
  const rows: Row[] = [];
  const visited = new Set([rootId]);
  let level = [rootId];
  for (let depth = 1; level.length > 0 && depth <= MAX_DEPTH; depth++) {
    const nextLevel: number[] = [];
    for (const id of level) {
      for (const e of await edgesOf(id)) {
        if (!matches(e) || rows.length >= MAX_ROWS) continue;
        if (opts.recursive) {
          if (visited.has(e.entity.id)) continue;
          visited.add(e.entity.id);
          nextLevel.push(e.entity.id);
          rows.push(row(e, { depth, ...(id !== rootId ? { via: guidOf(id) } : {}) }));
        } else {
          rows.push(row(e));
        }
      }
    }
    if (!opts.recursive) break;
    level = nextLevel;
  }
  return rows;
}

interface PortLink {
  own: UpstreamEdge;
  link: UpstreamEdge;
  host?: UpstreamEdge;
}

/**
 * Spojenia entity cez porty: vlastné porty (IfcRelNests, v IFC2X3
 * IfcRelConnectsPortToElement) -> IfcRelConnectsPorts -> port druhej strany ->
 * jeho hostiteľský prvok (ak ho port má).
 */
async function portLinks(rootId: number, edgesOf: EdgesOf): Promise<PortLink[]> {
  const hostOf = async (portId: number) =>
    (await edgesOf(portId)).find(
      (e) =>
        !isPort(e.entity.type) &&
        ((relKey(e.relationshipType) === "relnests" && e.direction === "inverse") ||
          relKey(e.relationshipType) === "relconnectsporttoelement"),
    );
  const ownPorts = (await edgesOf(rootId)).filter(
    (e) => isPort(e.entity.type) && ["relnests", "relconnectsporttoelement"].includes(relKey(e.relationshipType)),
  );
  const out: PortLink[] = [];
  const seen = new Set<string>();
  for (const own of ownPorts) {
    for (const link of await edgesOf(own.entity.id)) {
      if (relKey(link.relationshipType) !== "relconnectsports" || link.entity.id === rootId) continue;
      const key = `${own.entity.id}:${link.entity.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ own, link, host: await hostOf(link.entity.id) });
    }
  }
  return out;
}

/** Prvky napojené na entitu cez porty, jeden krok. Port bez hostiteľa sa vráti sám. */
async function portConnections(rootId: number, edgesOf: EdgesOf, guidOf: (id: number) => string, row: MakeRow): Promise<Row[]> {
  return (await portLinks(rootId, edgesOf)).map(({ own, link, host }) => {
    const ports = { via_port: guidOf(own.entity.id), port: guidOf(link.entity.id) };
    return host ? row({ ...link, entity: host.entity }, ports) : row(link, { via_port: ports.via_port });
  });
}

export interface Reached {
  global_id: string;
  ifc_type: string;
  name: string | null;
  predefined_type?: string;
  steps: number;
  /** GUIDy od štartu po zastavenie vrátane. */
  path: string[];
}

/**
 * Prechod sieťou cez porty do šírky (D-110): každý prvok raz, s hĺbkou a
 * predchodcom (`via`). Prvok zo `stop_at` sa zapíše do `reached` s cestou a za
 * neho sa nejde (najbližšia jednotka, prvá klapka). Oba smery toku.
 */
async function traceNetwork(
  rootId: number,
  edgesOf: EdgesOf,
  guidOf: (id: number) => string,
  row: MakeRow,
  opts: { stopAt: StopRule[]; maxSteps: number; predefinedOf: (id: number) => Promise<string | null> },
): Promise<{ rows: Row[]; reached: Reached[]; cutOff: boolean }> {
  const parent = new Map<number, number>();
  const visited = new Set([rootId]);
  const rows: Row[] = [];
  const reached: Reached[] = [];
  const pathTo = (id: number) => {
    const ids = [id];
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) ids.push(p);
    return ids.reverse().map(guidOf);
  };
  const stopsAt = async (e: UpstreamEdge["entity"]): Promise<{ hit: boolean; predefined?: string }> => {
    const rules = opts.stopAt.filter((r) => r.cls === e.type.toLowerCase());
    if (rules.length === 0) return { hit: false };
    if (rules.some((r) => !r.predefined)) return { hit: true };
    const predefined = (await opts.predefinedOf(e.id)) ?? undefined;
    return { hit: rules.some((r) => r.predefined === predefined), predefined };
  };
  let level = [rootId];
  let depth = 1;
  for (; level.length > 0 && depth <= opts.maxSteps && rows.length < MAX_ROWS; depth++) {
    const nextLevel: number[] = [];
    for (const id of level) {
      for (const { own, link, host } of await portLinks(id, edgesOf)) {
        if (!host || visited.has(host.entity.id)) continue;
        visited.add(host.entity.id);
        parent.set(host.entity.id, id);
        rows.push(row({ ...link, entity: host.entity }, { depth, via: guidOf(id), via_port: guidOf(own.entity.id), port: guidOf(link.entity.id) }));
        const stop = await stopsAt(host.entity);
        if (stop.hit) {
          reached.push({
            global_id: guidOf(host.entity.id),
            ifc_type: host.entity.type,
            name: host.entity.name ?? null,
            ...(stop.predefined ? { predefined_type: stop.predefined } : {}),
            steps: depth,
            path: pathTo(host.entity.id),
          });
          continue;
        }
        nextLevel.push(host.entity.id);
      }
    }
    level = nextLevel;
  }
  return { rows, reached, cutOff: level.length > 0 && depth > opts.maxSteps };
}
