import {
  SEVERITY_RANK,
  clashMemberKey,
  clashReviewKey,
  createClashEngine,
  groupClashes,
  matchesSelector,
  penetrationDepth,
  type Clash,
  type ClashElement,
  type ClashResult,
  type ClashRule,
  type ClashSeverity,
} from "@ifc-lite/clash";
import { EntityNode } from "@ifc-lite/query";

import { getIfcModels } from "../data/ifc-models";

import {
  CLASH_GROUPS,
  CLASH_STUB_ACTIONS,
  DEFAULT_TESTS,
  findTest,
  type ClashGroupBy,
  type ClashSide,
  type ClashTest,
} from "./clash-tests";
import { joinToAim } from "./join";
import { meshModel, toIfc, type MeshElement, type Vec3 } from "./measure";
import type { EngineModel } from "./session";
import { normalizeStoreyLabel } from "./storey";
import { InputError, clamp, modelsFor, str, type EngineDeps } from "./tools";

/**
 * Tool `clash` (D-164, host PR1): kolízie medzi modelmi federácie na serveri. Geometria
 * ako `ifc_measure` (headless tesselácia, cache na store), detekcia upstream
 * `@ifc-lite/clash` (TS engine) federovane nad ASR aj VZT. Beh sa drží v pamäti procesu
 * podľa revízií modelov, takže `results` s iným `group_by` nepočíta znova. Bez DB:
 * ukladanie testov, porovnanie a review sú v PR2.
 */

export const CLASH_ENGINE = "@ifc-lite/clash@2.4.4 (ts)";

/** Triedy bez fyzického telesa: priestory a otvory sa v kolíziách neberú, kým ich selektor nepomenuje. */
const NON_PHYSICAL = ["IfcSpace", "IfcOpeningElement", "IfcVirtualElement"];
const MAX_PAIRS = 3_000_000;
const RUN_BUDGET_MS = 45_000;
const KEPT_RUNS = 6;
const GROUPS_DEFAULT = 10;
const GROUPS_MAX = 50;
const MEMBERS_MAX = 50;
const SAMPLE_PAIRS = 3;
const GLOBAL_IDS_CAP = 600;
const SYSTEM_GUID_CAP = 3000;
/** Model, ktorý v téme BCF ustupuje (Samuel, D-164). */
export const BCF_DEFAULT_MODEL = "VZT";

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

interface ElInfo {
  model: string;
  guid: string;
  ifcType: string;
  name: string | null;
  storey: string | null;
}

export interface ClashSpec {
  name: string;
  code: string | null;
  a: ClashSide;
  b?: ClashSide;
  mode: "hard" | "clearance";
  /** m */
  clearance: number;
  /** m */
  tolerance: number;
}

export interface ClashRun {
  id: string;
  spec: ClashSpec;
  fingerprint: string;
  result: ClashResult;
  info: Map<string, ElInfo>;
  sets: { a: number; b: number | null };
  models: Record<string, unknown>;
  ms: { tessellate: number; detect: number };
  createdAt: string;
}

const runs = new Map<string, ClashRun>();
let runSeq = 0;

/** Len pre testy. */
export function clearClashRuns(): void {
  runs.clear();
  runSeq = 0;
}

function parseSide(input: Record<string, unknown>, prefix: "a" | "b"): ClashSide | undefined {
  const type = str(input[prefix]);
  const model = str(input[`${prefix}_model`]);
  const storey = str(input[`${prefix}_storey`]);
  if (!type && !model && !storey) return undefined;
  return { type: type || "*", ...(model ? { model } : {}), ...(storey ? { storey } : {}) };
}

function mm(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new InputError(`${field}: číslo v milimetroch od 0 do 10000.`);
  return n / 1000;
}

/** Test podľa mena, alebo ad hoc sady A/B; mode, clearance_mm a tolerance_mm prepíšu test. */
export function parseSpec(input: Record<string, unknown>): ClashSpec {
  const testName = str(input.test);
  const base: ClashTest | undefined = testName ? findTest(testName) : undefined;
  if (testName && !base) {
    throw new InputError(`Test '${testName}' nie je. Predvolené: ${DEFAULT_TESTS.map((t) => `${t.code} (${t.name})`).join(", ")}; ad hoc zadaj a (a voliteľne b).`);
  }
  const a = parseSide(input, "a") ?? base?.a;
  if (!a) throw new InputError("Zadaj test (action=list) alebo ad hoc sadu a (selektor IFC tried, napr. 'IfcDuct*|IfcPipe*') s voliteľným b, a_model, b_model, a_storey, b_storey.");
  const adHocB = parseSide(input, "b");
  const b = adHocB ?? base?.b;
  const modeRaw = str(input.mode) || base?.mode || "hard";
  if (modeRaw !== "hard" && modeRaw !== "clearance") throw new InputError("mode je hard alebo clearance.");
  const clearance = mm(input.clearance_mm, "clearance_mm") ?? (base?.clearance_mm ?? 0) / 1000;
  if (modeRaw === "clearance" && clearance <= 0) throw new InputError("clearance chce clearance_mm > 0 (odstup v mm).");
  const tolerance = mm(input.tolerance_mm, "tolerance_mm") ?? (base?.tolerance_mm ?? 2) / 1000;
  return {
    name: base?.name ?? `${a.type}${a.model ? `@${a.model}` : ""} x ${b ? `${b.type}${b.model ? `@${b.model}` : ""}` : "samé so sebou"}`,
    code: base?.code ?? null,
    a,
    ...(b ? { b } : {}),
    mode: modeRaw,
    clearance,
    tolerance,
  };
}

const mentions = (side: ClashSide | undefined, cls: string) => !!side && side.type.toLowerCase().includes(cls.toLowerCase());

function matches(e: MeshElement, side: ClashSide, storeyOf: (e: MeshElement) => string | null): boolean {
  if (side.model && e.model !== side.model) return false;
  if (!matchesSelector(e.ifcType, side.type) || (NON_PHYSICAL.includes(e.ifcType) && !mentions(side, e.ifcType))) return false;
  if (side.storey) {
    const s = storeyOf(e);
    if (!s || s !== normalizeStoreyLabel(side.storey)) return false;
  }
  return true;
}

const keyOf = (e: Pick<MeshElement, "model" | "globalId">) => `${e.model}:${e.globalId}`;

function toClashElement(e: MeshElement, storey: string | null): ClashElement {
  return {
    key: keyOf(e),
    ref: e.expressId,
    model: e.model,
    tag: e.ifcType,
    ...(e.name ? { name: e.name } : {}),
    ...(storey ? { storey } : {}),
    bounds: { min: e.bounds.min, max: e.bounds.max },
    positions: e.positions,
    indices: e.indices,
  };
}

export interface DetectInput {
  spec: ClashSpec;
  /** Prvky modelov (tesselované), po modeloch. */
  elements: Map<string, { model: EngineModel; meshes: Map<string, MeshElement> }>;
  signal?: AbortSignal;
  maxPairs?: number;
}

export interface Detected {
  result: ClashResult;
  info: Map<string, ElInfo>;
  sets: { a: number; b: number | null };
}

/** Čisté jadro: výber sád A/B, pravidlo s explicitnými členmi a beh upstream enginu. */
export async function detect({ spec, elements, signal, maxPairs = MAX_PAIRS }: DetectInput): Promise<Detected> {
  const storeys = new Map<string, string | null>();
  const storeyOf = (e: MeshElement): string | null => {
    const k = keyOf(e);
    if (storeys.has(k)) return storeys.get(k)!;
    const holder = elements.get(e.model);
    let name: string | undefined;
    try {
      name = holder ? new EntityNode(holder.model.store, e.expressId).storey()?.name : undefined;
    } catch {
      name = undefined; // prvok bez priestorovej väzby: bez podlažia
    }
    const label = name ? normalizeStoreyLabel(name) : null;
    storeys.set(k, label);
    return label;
  };
  const all = [...elements.values()].flatMap((h) => [...h.meshes.values()]);
  const setA = all.filter((e) => matches(e, spec.a, storeyOf));
  const setB = spec.b ? all.filter((e) => matches(e, spec.b!, storeyOf)) : null;
  if (setA.length === 0) throw new InputError(`Strana a (${describeSide(spec.a)}) nemá žiadny prvok s geometriou.`);
  if (setB && setB.length === 0) throw new InputError(`Strana b (${describeSide(spec.b!)}) nemá žiadny prvok s geometriou.`);

  const union = new Map<string, MeshElement>();
  for (const e of [...setA, ...(setB ?? [])]) union.set(keyOf(e), e);
  const members = (set: MeshElement[]) => set.map((e) => clashMemberKey(e.model, e.expressId));
  const rule: ClashRule = {
    id: spec.code ?? "adhoc",
    name: spec.name,
    a: "*",
    ...(setB ? { b: "*", membersB: members(setB) } : {}),
    membersA: members(setA),
    mode: spec.mode,
    ...(spec.mode === "clearance" ? { clearance: spec.clearance } : {}),
    tolerance: spec.tolerance,
  };
  const result = await createClashEngine({ backend: "ts" }).run(
    [...union.values()].map((e) => toClashElement(e, null)),
    [rule],
    { tolerance: spec.tolerance, maxCandidatePairs: maxPairs, ...(signal ? { signal } : {}) },
  );
  const info = new Map<string, ElInfo>();
  for (const c of result.clashes) {
    for (const ref of [c.a, c.b]) {
      if (info.has(ref.key)) continue;
      const e = union.get(ref.key)!;
      info.set(ref.key, { model: e.model, guid: e.globalId, ifcType: e.ifcType, name: e.name, storey: storeyOf(e) });
    }
  }
  return { result, info, sets: { a: setA.length, b: setB ? setB.length : null } };
}

const describeSide = (s: ClashSide) => [s.type, s.model && `model ${s.model}`, s.storey && `podlažie ${s.storey}`].filter(Boolean).join(", ");

const specModels = (spec: ClashSpec, all: string[]): string[] => {
  const sides = [spec.a, spec.b].filter((s): s is ClashSide => !!s);
  return sides.some((s) => !s.model) ? all : [...new Set(sides.map((s) => s.model!))];
};

async function execRun(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const spec = parseSpec(input);
  const modelIds = specModels(spec, (deps.sources ?? getIfcModels)().map((m) => m.id));
  const { models, revision } = await modelsFor(modelIds, deps);
  const fingerprint = JSON.stringify([spec, revision, MAX_PAIRS]);
  const hit = [...runs.values()].find((r) => r.fingerprint === fingerprint);
  if (hit) return { ...describeRun(hit), cached: true };

  const t0 = performance.now();
  const elements = new Map<string, { model: EngineModel; meshes: Map<string, MeshElement> }>();
  for (const m of models) elements.set(m.id, { model: m, meshes: await meshModel(m) });
  const tessellate = performance.now() - t0;

  const t1 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RUN_BUDGET_MS);
  let detected: Detected;
  try {
    detected = await detect({ spec, elements, signal: ctl.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new InputError(`Beh presiahol ${RUN_BUDGET_MS / 1000} s. Zúž test: podlažie (a_storey, b_storey), užšie triedy v a a b, alebo menší odstup.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const run: ClashRun = {
    id: `run-${++runSeq}`,
    spec,
    fingerprint,
    result: detected.result,
    info: detected.info,
    sets: detected.sets,
    models: Object.fromEntries(models.map((m) => [m.id, revision[m.id]])),
    ms: { tessellate: Math.round(tessellate), detect: Math.round(performance.now() - t1) },
    createdAt: new Date().toISOString(),
  };
  runs.set(run.id, run);
  while (runs.size > KEPT_RUNS) runs.delete(runs.keys().next().value!);
  return { ...describeRun(run), cached: false };
}

const countBy = <T>(items: Iterable<T>, key: (t: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const top = (rec: Record<string, number>, n: number) =>
  Object.fromEntries(Object.entries(rec).sort((x, y) => y[1] - x[1]).slice(0, n));

const storeyOfClash = (run: ClashRun, c: Clash): string => run.info.get(c.a.key)?.storey ?? run.info.get(c.b.key)?.storey ?? "bez podlažia";

function describeRun(run: ClashRun): Record<string, unknown> {
  const { result, spec } = run;
  const clashes = result.clashes;
  const coverage = result.ruleCoverage?.[0];
  return {
    run_id: run.id,
    engine: CLASH_ENGINE,
    test: { code: spec.code, name: spec.name, a: spec.a, b: spec.b ?? null, mode: spec.mode, ...(spec.mode === "clearance" ? { clearance_mm: round(spec.clearance * 1000, 1) } : {}), tolerance_mm: round(spec.tolerance * 1000, 1) },
    models: run.models,
    sets: { a: run.sets.a, b: run.sets.b },
    ms: run.ms,
    total: clashes.length,
    by_status: countBy(clashes, (c) => c.status),
    by_severity: result.summary.bySeverity,
    by_storey: countBy(clashes, (c) => storeyOfClash(run, c)),
    by_type_pair: top(result.summary.byTypePair, 8),
    ...(result.truncated ? { truncated: { ...result.truncated, note: "Beh bol orezaný stropom dvojíc: súčty sú dolná hranica. Zúž test (podlažie, užšie triedy)." } } : {}),
    ...(coverage && coverage.matchedA === 0 ? { warning: "strana a nenašla žiadny prvok" } : {}),
    next: "results (group_by storey | system | type_pair | element | rule | cluster; group = kľúč alebo poradie na rozbalenie, vráti global_ids pre show_in_3d / style_in_3d), bcf (návrh témy za skupinu).",
  };
}

interface Group {
  key: string;
  title: string;
  members: Clash[];
  severity: ClashSeverity;
}

const typePair = (c: Clash) => `${c.a.tag} x ${c.b.tag}`;

const worstSeverity = (members: Clash[]): ClashSeverity =>
  members.reduce<ClashSeverity>((w, c) => (SEVERITY_RANK[c.severity] < SEVERITY_RANK[w] ? c.severity : w), "info");

function bucket(clashes: Clash[], keysOf: (c: Clash) => string[], titleOf: (key: string) => string): Group[] {
  const by = new Map<string, Clash[]>();
  for (const c of clashes) {
    for (const k of new Set(keysOf(c))) {
      const list = by.get(k);
      if (list) list.push(c);
      else by.set(k, [c]);
    }
  }
  return [...by].map(([key, members]) => ({ key, title: titleOf(key), members, severity: worstSeverity(members) }));
}

export interface GroupContext {
  run: ClashRun;
  /** Systém prvku (kľúč GUID) z grafu AIM; len pre group_by=system. */
  systems?: Map<string, string>;
}

/** Skupiny kolízií podľa kritéria, najväčšie prvé (pri zhode závažnejšie, potom kľúč). */
export function groupRun({ run, systems }: GroupContext, by: ClashGroupBy): Group[] {
  const clashes = run.result.clashes;
  let groups: Group[];
  switch (by) {
    case "storey":
      groups = bucket(clashes, (c) => [storeyOfClash(run, c)], (k) => `Podlažie ${k}`);
      break;
    case "system":
      groups = bucket(
        clashes,
        (c) => [systems?.get(run.info.get(c.a.key)?.guid ?? "") ?? systems?.get(run.info.get(c.b.key)?.guid ?? "") ?? "bez systému"],
        (k) => `Systém ${k}`,
      );
      break;
    case "type_pair":
      groups = bucket(clashes, (c) => [typePair(c)], (k) => k);
      break;
    case "rule":
      groups = bucket(clashes, (c) => [c.rule], (k) => `Pravidlo ${k}`);
      break;
    case "element":
      groups = bucket(
        clashes,
        (c) => [c.a.key, c.b.key],
        (k) => {
          const i = run.info.get(k);
          return `${i?.ifcType ?? "prvok"} ${i?.name ?? i?.guid ?? k}`;
        },
      );
      break;
    case "cluster":
      groups = groupClashes(run.result, { by: "cluster" }).map((g) => ({ key: g.id, title: g.title, members: g.members, severity: g.severity }));
      break;
  }
  return groups.sort(
    (x, y) => y.members.length - x.members.length || SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || (x.key < y.key ? -1 : 1),
  );
}

function pickGroup(groups: Group[], ref: string): Group {
  const asNumber = /^\d+$/.test(ref) ? Number(ref) : NaN;
  const hit = (Number.isInteger(asNumber) && asNumber >= 1 ? groups[asNumber - 1] : undefined) ?? groups.find((g) => g.key === ref);
  if (!hit) throw new InputError(`Skupina '${ref}' neexistuje: zadaj kľúč zo zoznamu alebo jej poradie (1 až ${groups.length}).`);
  return hit;
}

function findRun(raw: unknown): ClashRun {
  const id = str(raw);
  if (id) {
    const run = runs.get(id);
    if (!run) throw new InputError(`Beh '${id}' nie je v pamäti (po reštarte alebo po ${KEPT_RUNS} behoch sa zahodí): spusti action=run znova.`);
    return run;
  }
  const last = [...runs.values()].pop();
  if (!last) throw new InputError("Zatiaľ nebeží žiadny beh: najprv action=run.");
  return last;
}

const mmOf = (c: Clash) => (c.status === "clearance" ? { gap_mm: round(c.distance * 1000, 1) } : { depth_mm: round(penetrationDepth(c) * 1000, 1) });

type Person = { global_id: string; model: string; ifc_type: string; name: string | null; storey: string | null };

const elementOf = (run: ClashRun, ref: Clash["a"]): Person => {
  const i = run.info.get(ref.key);
  return { global_id: i?.guid ?? ref.key, model: ref.model, ifc_type: ref.tag, name: i?.name ?? ref.name ?? null, storey: i?.storey ?? null };
};

function clashRow(run: ClashRun, c: Clash) {
  return {
    key: clashReviewKey(c),
    status: c.status,
    severity: c.severity,
    ...mmOf(c),
    a: elementOf(run, c.a),
    b: elementOf(run, c.b),
    point_m: toIfc(c.point as Vec3).map((v) => round(v)),
  };
}

/** Prvky strany A a B zo skupiny pre `style_in_3d` (A a B inou farbou); strop ako show_in_3d. */
function idsOf(run: ClashRun, members: Clash[]) {
  const a = new Set<string>();
  const b = new Set<string>();
  for (const c of members) {
    a.add(run.info.get(c.a.key)?.guid ?? c.a.key);
    b.add(run.info.get(c.b.key)?.guid ?? c.b.key);
  }
  const cap = (s: Set<string>) => [...s].slice(0, GLOBAL_IDS_CAP / 2);
  return { a_global_ids: cap(a), b_global_ids: cap(b), truncated: a.size + b.size > GLOBAL_IDS_CAP };
}

/** Pripojí k riadkom objekt AIM (object_ref) cez GUID. */
async function withAim(rows: Person[], deps: EngineDeps) {
  const joined = await joinToAim(rows, deps.lookup);
  return new Map(joined.items.map((i) => [i.global_id, i.object_ref]));
}

async function execResults(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const run = findRun(input.run_id);
  const by = (str(input.group_by) || "storey") as ClashGroupBy;
  if (!CLASH_GROUPS.includes(by)) throw new InputError(`group_by je jedno z ${CLASH_GROUPS.join(", ")}.`);
  const systems = by === "system" ? await systemsFor(run, deps) : undefined;
  const groups = groupRun({ run, systems }, by);
  const groupRef = str(input.group);

  const out: Record<string, unknown> = {
    run_id: run.id,
    test: run.spec.name,
    group_by: by,
    total: run.result.clashes.length,
    groups_total: groups.length,
    ...(run.result.truncated ? { truncated: true } : {}),
  };
  if (by === "cluster" && groups.length > 1 && groups.length === run.result.clashes.length) {
    out.note = "Zhluky sa nespojili (kolízie sú ďaleko od seba): každá je sama, použi storey alebo type_pair.";
  }
  if (groupRef) {
    const g = pickGroup(groups, groupRef);
    const limit = clamp(input.limit, 1, MEMBERS_MAX, 20);
    const offset = clamp(input.offset, 0, g.members.length, 0);
    const page = [...g.members]
      .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || (clashRow(run, x).key < clashRow(run, y).key ? -1 : 1))
      .slice(offset, offset + limit);
    const rows = page.map((c) => clashRow(run, c));
    const refs = await withAim(rows.flatMap((r) => [r.a, r.b]), deps);
    out.group = {
      index: groups.indexOf(g) + 1,
      key: g.key,
      title: g.title,
      count: g.members.length,
      severity: g.severity,
      by_status: countBy(g.members, (c) => c.status),
      clashes: rows.map((r) => ({ ...r, a: { ...r.a, object_ref: refs.get(r.a.global_id) ?? null }, b: { ...r.b, object_ref: refs.get(r.b.global_id) ?? null } })),
      next_offset: offset + page.length < g.members.length ? offset + page.length : null,
    };
    out.show_in_3d = idsOf(run, g.members);
    out.note = "show_in_3d.a_global_ids a b_global_ids (strana a, strana b) daj do show_in_3d (global_ids) alebo style_in_3d, každú stranu inou farbou.";
    return out;
  }
  const limit = clamp(input.limit, 1, GROUPS_MAX, GROUPS_DEFAULT);
  const offset = clamp(input.offset, 0, groups.length, 0);
  const shown = groups.slice(offset, offset + limit);
  const samples = shown.map((g) => g.members.slice(0, SAMPLE_PAIRS).map((c) => clashRow(run, c)));
  const refs = await withAim(samples.flatMap((rows) => rows.flatMap((r) => [r.a, r.b])), deps);
  out.groups = shown.map((g, i) => ({
    index: offset + i + 1,
    key: g.key,
    title: g.title,
    count: g.members.length,
    severity: g.severity,
    by_status: countBy(g.members, (c) => c.status),
    sample: samples[i].map((r) => ({ ...r, a: { ...r.a, object_ref: refs.get(r.a.global_id) ?? null }, b: { ...r.b, object_ref: refs.get(r.b.global_id) ?? null } })),
  }));
  out.next_offset = offset + shown.length < groups.length ? offset + shown.length : null;
  out.note = "Súčty sú úplné (total, count), vzorka má 3 kolízie. group = kľúč alebo poradie skupiny rozbalí kolízie a vráti show_in_3d (global_ids strany a a b).";
  return out;
}

async function systemsFor(run: ClashRun, deps: EngineDeps): Promise<Map<string, string>> {
  if (!deps.systems) throw new InputError("group_by=system potrebuje graf AIM (DB), tu nie je dostupný.");
  const guids = [...new Set([...run.info.values()].map((i) => i.guid))];
  if (guids.length > SYSTEM_GUID_CAP) throw new InputError(`group_by=system: ${guids.length} prvkov v kolíziách je nad ${SYSTEM_GUID_CAP}, zúž test (podlažie) alebo zoskup inak.`);
  return deps.systems(guids);
}

async function execBcf(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const run = findRun(input.run_id);
  const by = (str(input.group_by) || "storey") as ClashGroupBy;
  if (!CLASH_GROUPS.includes(by)) throw new InputError(`group_by je jedno z ${CLASH_GROUPS.join(", ")}.`);
  const groupRef = str(input.group);
  if (!groupRef) throw new InputError("Zadaj group (kľúč alebo poradie skupiny z action=results) a group_by, podľa ktorého sa skupina berie.");
  const systems = by === "system" ? await systemsFor(run, deps) : undefined;
  const groups = groupRun({ run, systems }, by);
  const g = pickGroup(groups, groupRef);
  const ids = idsOf(run, g.members);
  const modelsInRun = Object.keys(run.models);
  const model = str(input.model) || (modelsInRun.includes(BCF_DEFAULT_MODEL) ? BCF_DEFAULT_MODEL : modelsInRun[0]);
  const worst = [...g.members].sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity])[0];
  const lines = g.members.slice(0, 5).map((c) => {
    const r = clashRow(run, c);
    return `- ${r.a.ifc_type} ${r.a.name ?? r.a.global_id} (${r.a.model}) x ${r.b.ifc_type} ${r.b.name ?? r.b.global_id} (${r.b.model}), ${"gap_mm" in r ? `odstup ${r.gap_mm} mm` : `prienik ${r.depth_mm} mm`}`;
  });
  const title = `Kolízia: ${g.title} (${g.members.length}x), ${run.spec.name}`.slice(0, 200);
  const description =
    `Test ${run.spec.name} (${run.spec.mode}${run.spec.mode === "clearance" ? `, odstup ${round(run.spec.clearance * 1000, 1)} mm` : ""}), ${CLASH_ENGINE}, beh ${run.id}.\n` +
    `Skupina ${g.title} (group_by ${by}): ${g.members.length} kolízií, najzávažnejšia ${worst.severity}.\n` +
    `Najhoršie dvojice:\n${lines.join("\n")}\n` +
    `Čo je zle: prvky sa križujú alebo nedodržujú odstup. Ustúpiť má disciplína ${model}.`;
  const global_ids = [...ids.a_global_ids, ...ids.b_global_ids];
  return {
    run_id: run.id,
    group: { key: g.key, title: g.title, count: g.members.length },
    proposal: {
      title,
      description,
      type: "Clash",
      model,
      priority: SEVERITY_RANK[g.severity] <= SEVERITY_RANK.major ? "High" : "Normal",
      labels: ["clash", run.spec.code ?? "adhoc"],
      global_ids,
    },
    write: "Zápis príde v PR2. Teraz založ tému existujúcim bcf_topic(action=create) s týmito poľami (title, description, type, model, priority, labels, global_ids); používateľ musí o založení povedať.",
    ...(ids.truncated ? { truncated: true } : {}),
  };
}

function execList(): Record<string, unknown> {
  return {
    tests: DEFAULT_TESTS.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description,
      a: t.a,
      b: t.b ?? null,
      mode: t.mode,
      ...(t.clearance_mm ? { clearance_mm: t.clearance_mm } : {}),
    })),
    note: "Predvolené testy sú pevné. Vlastné ad hoc: run s a (selektor IFC tried), b, a_model, b_model, a_storey, b_storey, mode, clearance_mm, tolerance_mm. Ukladanie vlastných testov príde v PR2.",
    runs_in_memory: [...runs.values()].map((r) => ({ run_id: r.id, test: r.spec.name, total: r.result.clashes.length, created_at: r.createdAt })),
  };
}

export async function ifcClash(input: Record<string, unknown>, deps: EngineDeps): Promise<string> {
  const action = str(input.action);
  if (CLASH_STUB_ACTIONS.has(action)) {
    return JSON.stringify({ action, available: false, note: `clash action=${action} príde v PR2 (úložisko testov, behov a review) alebo PR3 (viewer). Teraz: list, run, results, bcf.` });
  }
  switch (action) {
    case "list":
      return JSON.stringify(execList());
    case "run":
      return JSON.stringify(await execRun(input, deps));
    case "results":
      return JSON.stringify(await execResults(input, deps));
    case "bcf":
      return JSON.stringify(await execBcf(input, deps));
    default:
      throw new InputError("action je list, run, results alebo bcf (ďalšie príde v PR2).");
  }
}
