import { randomUUID } from "node:crypto";

import { clashReviewKey, compareClashRevisions, type Clash, type ClashResult } from "@ifc-lite/clash";

import type { ClashCoverage, ClashResultRow, ClashReviewRow, ClashRunRow, ClashStore, ClashTestRow, ClashTestWrite, ReviewStatus } from "../clash/types";
import { getIfcModels } from "../data/ifc-models";

import {
  CLASH_ENGINE,
  clashRow,
  countBy,
  describeRun,
  findRun,
  groupRun,
  idsOf,
  memoryRuns,
  oneOf,
  parseSpec,
  pickGroup,
  round,
  storeyOfClash,
  systemsFor,
  withAim,
  type ClashRun,
  type ClashSpec,
  type ElInfo,
} from "./clash";
import {
  CLASH_AUTHOR,
  CLASH_BUCKETS,
  CLASH_GROUPS,
  CLASH_STATES,
  DEFAULT_TESTS,
  findTest,
  type ClashBucket,
  type ClashGroupBy,
  type ClashTest,
} from "./clash-tests";
import { toIfc, type Vec3 } from "./measure";
import { InputError, clamp, str, type EngineDeps } from "./tools";

/**
 * Testy, uložené behy, porovnanie, stav kolízie a BCF téma toolu `clash` (D-164, host PR2).
 * Nositeľ je DB (`lib/clash/store.ts`): beh sa dá uložiť (`run save=true`), po reštarte
 * inštancie obnoviť podľa UUID a porovnať s iným behom. Stav kolízie (`clash_reviews`) je
 * kľúčovaný testom a upstream `clashReviewKey`, takže prežije beh, revíziu modelu aj
 * zúženie testu na podlažie.
 */

/** Strop kolízií uloženého behu (ako v paneli viewera); nad ním zúž test. */
export const RESULT_CAP = 100_000;
/** Strop prvkov, ktoré beh overil, uložených na stranu; nad ním porovnanie nepovie "vyriešené". */
const COVERAGE_CAP = 30_000;
const RUNS_LISTED = 20;
const SAMPLE = 3;
const ROWS_MAX = 50;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function need(deps: EngineDeps): ClashStore {
  if (!deps.clash) throw new InputError("Ukladanie kolízií (testy, behy, stav kolízií) potrebuje DB, tu nie je dostupná.");
  return deps.clash;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- testy -------------------------------------------------------------------------------

export function testFromRow(r: ClashTestRow): ClashTest {
  const rule = r.rules[0];
  return {
    code: r.code,
    name: r.name,
    description: r.description ?? "",
    a: rule.a,
    ...(rule.b ? { b: rule.b } : {}),
    mode: r.settings.mode ?? "hard",
    ...(r.settings.clearance_mm !== undefined ? { clearance_mm: r.settings.clearance_mm } : {}),
    ...(r.settings.tolerance_mm !== undefined ? { tolerance_mm: r.settings.tolerance_mm } : {}),
  };
}

export function writeFromSpec(spec: ClashSpec, meta: { code: string; description: string | null; origin: ClashTestWrite["origin"]; by: string | null }): ClashTestWrite {
  return {
    code: meta.code,
    name: spec.name,
    description: meta.description,
    origin: meta.origin,
    created_by: meta.by,
    rules: [{ id: meta.code, a: spec.a, ...(spec.b ? { b: spec.b } : {}) }],
    settings: {
      mode: spec.mode,
      ...(spec.mode === "clearance" ? { clearance_mm: round(spec.clearance * 1000, 1) } : {}),
      tolerance_mm: round(spec.tolerance * 1000, 1),
    },
  };
}

async function findRow(ref: string, store: ClashStore): Promise<ClashTestRow | null> {
  const want = ref.trim().toLowerCase();
  return (await store.listTests()).find((t) => t.code.toLowerCase() === want || t.name.toLowerCase() === want) ?? null;
}

/** Predvolený test z kódu, inak uložený z DB; undefined = taký test nie je. */
export async function resolveTest(ref: string, deps: EngineDeps): Promise<ClashTest | undefined> {
  const preset = findTest(ref);
  if (preset) return preset;
  if (!deps.clash) return undefined;
  const row = await findRow(ref, deps.clash);
  return row ? testFromRow(row) : undefined;
}

/** Riadok testu v DB pre beh: predvolený sa vyrovná s kódom, vlastný musí existovať. */
async function ensureTestRow(spec: ClashSpec, deps: EngineDeps): Promise<ClashTestRow> {
  const store = need(deps);
  const code = spec.code!;
  const preset = findTest(code);
  if (preset) {
    return store.upsertTest(writeFromSpec(parseSpec({}, preset), { code: preset.code, description: preset.description, origin: "default", by: null }));
  }
  const row = await store.testByCode(code);
  if (!row) throw new InputError(`Test '${code}' už v DB nie je (zmazaný?): ulož ho znova (action=save) alebo spusti ad hoc.`);
  return row;
}

async function testIdFor(run: ClashRun, deps: EngineDeps, ensure: boolean): Promise<string | null> {
  if (run.saved?.testId) return run.saved.testId;
  if (!deps.clash || !run.spec.code) return null;
  if (ensure) return (await ensureTestRow(run.spec, deps)).id;
  return (await deps.clash.testByCode(run.spec.code))?.id ?? null;
}

const entryOf = (t: ClashTest, extra: Record<string, unknown> = {}) => ({
  code: t.code,
  name: t.name,
  description: t.description,
  a: t.a,
  b: t.b ?? null,
  mode: t.mode,
  ...(t.clearance_mm ? { clearance_mm: t.clearance_mm } : {}),
  ...(t.tolerance_mm !== undefined ? { tolerance_mm: t.tolerance_mm } : {}),
  ...extra,
});

const lastRunOf = (r: ClashRunRow) => ({
  run_id: r.id,
  created_at: r.created_at,
  trigger: r.trigger,
  total: r.summary.total ?? null,
  by_status: r.summary.by_status ?? null,
  models: r.models,
  ...(r.completeness.truncated ? { truncated: true } : {}),
});

export async function execList(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const ref = str(input.test);
  const rows = deps.clash ? await deps.clash.listTests() : [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const entries: Array<{ test: ClashTest; row?: ClashTestRow }> = [
    ...DEFAULT_TESTS.map((t) => ({ test: t, row: byCode.get(t.code) })),
    ...rows.filter((r) => r.origin !== "default").map((r) => ({ test: testFromRow(r), row: r })),
  ];
  const memory = memoryRuns().map((r) => ({ run_id: r.id, ...(r.saved ? { saved_run_id: r.saved.id } : {}), test: r.spec.name, total: r.result.clashes.length, created_at: r.createdAt }));
  if (ref) {
    const hit = entries.find((e) => e.test.code.toLowerCase() === ref.toLowerCase() || e.test.name.toLowerCase() === ref.toLowerCase());
    if (!hit) throw new InputError(`Test '${ref}' nie je (action=list ukáže všetky).`);
    const runs = deps.clash && hit.row ? await deps.clash.runs(hit.row.id, RUNS_LISTED) : [];
    const reviews = deps.clash && hit.row ? countBy(await deps.clash.reviews(hit.row.id), (r) => r.status) : {};
    return {
      test: entryOf(hit.test, { origin: hit.row?.origin ?? "default" }),
      runs: runs.map(lastRunOf),
      reviews,
      note: "run_id uloženého behu daj do results, compare alebo review; po reštarte inštancie sa obnoví z DB.",
    };
  }
  const ids = entries.flatMap((e) => (e.row ? [e.row.id] : []));
  const last = deps.clash && ids.length ? await deps.clash.lastRuns(ids) : new Map<string, ClashRunRow>();
  return {
    tests: entries.map((e) => entryOf(e.test, { origin: e.row?.origin ?? "default", last_run: e.row && last.get(e.row.id) ? lastRunOf(last.get(e.row.id)!) : null })),
    note: "Predvolené testy sú pevné. Vlastný test uloží save (test = kód, name, a, b, a_model, b_model, a_storey, b_storey, mode, clearance_mm). Spusti run s test; save=true uloží beh. list s test ukáže jeho behy.",
    runs_in_memory: memory,
    ...(deps.clash ? {} : { warning: "DB tu nie je dostupná: len predvolené testy a behy v pamäti." }),
  };
}

export async function execSave(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const store = need(deps);
  const author = str(input.author) || CLASH_AUTHOR;
  const ref = str(input.test);
  const name = str(input.name);
  if (ref && findTest(ref)) throw new InputError(`'${ref}' je predvolený test (len na čítanie). Ulož vlastný pod iným kódom (test) a názvom (name).`);
  const existing = ref ? await findRow(ref, store) : null;
  if (existing?.origin === "default") throw new InputError(`'${ref}' je predvolený test (len na čítanie).`);
  const code = existing?.code ?? (ref || name.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80));
  if (!code) throw new InputError("Zadaj test (kód nového testu, písmená, čísla, . _ -) alebo name.");
  if (!CODE_RE.test(code)) throw new InputError("Kód testu: písmená, čísla, . _ - (max 80, začína písmenom alebo číslom).");
  if (!existing && !ref && (await store.testByCode(code))) throw new InputError(`Kód ${code} už existuje: zadaj iný test (kód), alebo ten istý test (test=${code}) na úpravu.`);
  const spec = parseSpec({ ...input, test: "" }, existing ? testFromRow(existing) : undefined);
  const known = (deps.sources ?? getIfcModels)().map((m) => m.id);
  for (const side of [spec.a, spec.b]) {
    if (side?.model && !known.includes(side.model)) throw new InputError(`Model ${side.model} nie je vo federácii (${known.join(", ")}).`);
  }
  const description = input.description !== undefined ? str(input.description) || null : (existing?.description ?? null);
  const row = await store.upsertTest(
    writeFromSpec({ ...spec, name: name || existing?.name || spec.name }, { code, description, origin: existing?.origin ?? "chat", by: existing?.created_by ?? author }),
  );
  return {
    saved: true,
    created: !existing,
    test: entryOf(testFromRow(row), { origin: row.origin }),
    note: `Spusti ho: clash(action=run, test=${row.code}, save=true). Úprava s tým istým kódom zachová stav kolízií (kľúč je test a dvojica prvkov).`,
  };
}

export async function execDelete(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const store = need(deps);
  const ref = str(input.test);
  if (!ref) throw new InputError("Zadaj test (kód testu).");
  if (findTest(ref)) throw new InputError("Predvolený test sa nemaže.");
  const row = await findRow(ref, store);
  if (!row) throw new InputError(`Test '${ref}' nie je (action=list ukáže všetky).`);
  const stats = await store.testStats(row.id);
  if (input.confirm !== true) {
    return {
      deleted: false,
      test: row.code,
      would_delete: stats,
      note: "Zmaže test, jeho uložené behy, kolízie a stav kolízií (BCF témy ostanú). Spýtaj sa používateľa a zopakuj s confirm=true.",
    };
  }
  await store.deleteTest(row.id);
  return { deleted: true, test: row.code, removed: stats };
}

// --- uložený beh ---------------------------------------------------------------------------

function resultRow(run: ClashRun, c: Clash): ClashResultRow {
  const a = run.info.get(c.a.key);
  const b = run.info.get(c.b.key);
  return {
    clash_key: clashReviewKey(c),
    rule: c.rule,
    status: c.status as "hard" | "clearance",
    severity: c.severity,
    distance: c.distance,
    a_guid: a?.guid ?? c.a.key,
    a_model: c.a.model,
    a_ifc_type: c.a.tag,
    a_name: a?.name ?? c.a.name ?? null,
    b_guid: b?.guid ?? c.b.key,
    b_model: c.b.model,
    b_ifc_type: c.b.tag,
    b_name: b?.name ?? c.b.name ?? null,
    storey: a?.storey ?? b?.storey ?? null,
    center: toIfc(c.point as Vec3).map((v) => round(v)),
    point: [...c.point],
    bounds: [[...c.bounds.min], [...c.bounds.max]],
  };
}

function coverageOf(run: ClashRun): ClashCoverage | null {
  const cov = run.result.ruleCoverage?.[0];
  if (!cov?.matchedKeysA) return null;
  if (cov.matchedKeysA.length > COVERAGE_CAP || (cov.matchedKeysB?.length ?? 0) > COVERAGE_CAP) return null;
  return { a: [...cov.matchedKeysA], b: cov.matchedKeysB ? [...cov.matchedKeysB] : null };
}

/** Uloží beh a jeho kolízie; test sa viaže podľa kódu (predvolený sa v DB založí). Druhé uloženie ten istý beh nezdvojí. */
export async function persistRun(run: ClashRun, deps: EngineDeps, author?: string): Promise<Record<string, unknown>> {
  const store = need(deps);
  if (run.saved) return { run_id: run.saved.id, already_saved: true, test: run.spec.code };
  const clashes = run.result.clashes.filter((c) => c.status !== "touch");
  if (clashes.length > RESULT_CAP) {
    throw new InputError(`Beh má ${clashes.length} kolízií, nad stropom ${RESULT_CAP} uloženia: zúž test (podlažie a_storey / b_storey, konkrétne triedy) a ulož znova.`);
  }
  const testRow = run.spec.code ? await ensureTestRow(run.spec, deps) : null;
  const coverage = coverageOf(run);
  const d = describeRun(run);
  const id = await store.saveRun(
    {
      test_id: testRow?.id ?? null,
      test_code: run.spec.code,
      rules_snapshot: { spec: run.spec },
      models: run.models,
      engine: CLASH_ENGINE,
      trigger: "chat",
      completeness: { ...(run.result.truncated ? { truncated: run.result.truncated } : {}), ...(coverage ? {} : { coverage_omitted: true }) },
      summary: { total: d.total, by_status: d.by_status, by_severity: d.by_severity, by_storey: d.by_storey, by_type_pair: d.by_type_pair, sets: d.sets },
      coverage,
      created_by: author || CLASH_AUTHOR,
    },
    clashes.map((c) => resultRow(run, c)),
  );
  run.saved = { id, testId: testRow?.id ?? null };
  return {
    run_id: id,
    test: run.spec.code,
    results: clashes.length,
    ...(testRow ? {} : { note: "Ad hoc beh nemá test: stav kolízie a porovnanie podľa testu nejde. Ulož test (action=save) a spusti ho." }),
    ...(coverage ? {} : { warning: "Zoznam overených prvkov je nad stropom: porovnanie tohto behu nepovie 'vyriešené', len 'nepretestované'." }),
  };
}

function summarize(clashes: Clash[]): ClashResult["summary"] {
  const bySeverity = { critical: 0, major: 0, minor: 0, info: 0 };
  const byRule: Record<string, number> = {};
  const byTypePair: Record<string, number> = {};
  for (const c of clashes) {
    bySeverity[c.severity]++;
    byRule[c.rule] = (byRule[c.rule] ?? 0) + 1;
    const pair = `${c.a.tag} x ${c.b.tag}`;
    byTypePair[pair] = (byTypePair[pair] ?? 0) + 1;
  }
  return { total: clashes.length, byRule, byTypePair, bySeverity };
}

/** Obnoví beh z riadkov DB tak, aby fungovali rovnaké zoskupenie, riadky a porovnanie ako pri behu v pamäti. */
export function runFromRows(row: ClashRunRow, results: ClashResultRow[]): ClashRun {
  const spec = row.rules_snapshot.spec as ClashSpec | undefined;
  if (!spec?.a) throw new InputError(`Beh ${row.id} nemá uložené pravidlo (poškodený záznam).`);
  const info = new Map<string, ElInfo>();
  const clashes: Clash[] = results.map((r) => {
    const aKey = `${r.a_model}:${r.a_guid}`;
    const bKey = `${r.b_model}:${r.b_guid}`;
    const storey = r.storey ?? null;
    info.set(aKey, { model: r.a_model, guid: r.a_guid, ifcType: r.a_ifc_type ?? "", name: r.a_name, storey });
    info.set(bKey, { model: r.b_model, guid: r.b_guid, ifcType: r.b_ifc_type ?? "", name: r.b_name, storey });
    const zero: Vec3 = [0, 0, 0];
    return {
      id: r.clash_key,
      a: { key: aKey, ref: 0, model: r.a_model, tag: r.a_ifc_type ?? "", ...(r.a_name ? { name: r.a_name } : {}) },
      b: { key: bKey, ref: 0, model: r.b_model, tag: r.b_ifc_type ?? "", ...(r.b_name ? { name: r.b_name } : {}) },
      rule: r.rule,
      status: r.status,
      distance: r.distance,
      point: (r.point ?? zero) as Vec3,
      bounds: r.bounds ? { min: r.bounds[0] as Vec3, max: r.bounds[1] as Vec3 } : { min: zero, max: zero },
      severity: r.severity,
    };
  });
  const ruleId = spec.code ?? "adhoc";
  const sets = (row.summary.sets as ClashRun["sets"] | undefined) ?? { a: 0, b: null };
  const result: ClashResult = {
    clashes,
    summary: summarize(clashes),
    ...(row.completeness.truncated ? { truncated: row.completeness.truncated as NonNullable<ClashResult["truncated"]> } : {}),
    rulesRun: [{ id: ruleId, name: spec.name, a: "*", mode: spec.mode }],
    ruleCoverage: [
      {
        rule: ruleId,
        matchedA: row.coverage?.a.length ?? sets.a,
        matchedB: row.coverage ? (row.coverage.b?.length ?? null) : sets.b,
        ...(row.coverage ? { matchedKeysA: row.coverage.a, matchedKeysB: row.coverage.b } : {}),
      },
    ],
    settings: { tolerance: spec.tolerance, excludeVoidsAndHosts: true },
  };
  return {
    id: row.id,
    spec,
    fingerprint: "",
    result,
    info,
    sets,
    models: row.models,
    ms: { tessellate: 0, detect: 0 },
    createdAt: row.created_at,
    saved: { id: row.id, testId: row.test_id },
  };
}

export async function loadSavedRun(id: string, deps: EngineDeps): Promise<ClashRun> {
  if (!UUID_RE.test(id)) throw new InputError(`run_id '${id}' nie je beh z pamäte (run-N) ani uložený beh (UUID z action=list test=...).`);
  const fresh = memoryRuns().find((r) => r.saved?.id === id);
  if (fresh) return fresh;
  const store = need(deps);
  const row = await store.run(id);
  if (!row) throw new InputError(`Uložený beh '${id}' nie je.`);
  return runFromRows(row, await store.results(id));
}

/** Najnovší beh testu: pamäť alebo DB, podľa času. */
export async function latestRunOfTest(ref: string, deps: EngineDeps, memory?: ClashRun): Promise<ClashRun> {
  const row = deps.clash ? await findRow(ref, deps.clash) : null;
  const last = row && deps.clash ? (await deps.clash.runs(row.id, 1))[0] : undefined;
  if (memory && (!last || memory.createdAt >= last.created_at)) return memory;
  if (last) return loadSavedRun(last.id, deps);
  throw new InputError(`Test '${ref}' nemá žiadny beh (ani v pamäti, ani uložený): spusti action=run, save=true ho uloží.`);
}

export async function reviewMap(run: ClashRun, deps: EngineDeps): Promise<Map<string, ClashReviewRow>> {
  const testId = await testIdFor(run, deps, false);
  if (!testId || !deps.clash) return new Map();
  return new Map((await deps.clash.reviews(testId)).map((r) => [r.clash_key, r]));
}

// --- stav kolízie --------------------------------------------------------------------------

export async function execReview(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const store = need(deps);
  const status = oneOf(input.review_status, CLASH_STATES, "review_status");
  if (!status) throw new InputError(`Zadaj review_status: ${CLASH_STATES.join(" | ")} (open = späť na otvorenú, resolved = vyriešená, accepted = prijatá).`);
  const run = await findRun(input, deps);
  if (!run.spec.code) throw new InputError("Stav kolízie patrí testu: ad hoc beh test nemá. Ulož test (action=save) a spusti ho.");
  const testRow = await ensureTestRow(run.spec, deps);
  const byKey = new Map(run.result.clashes.map((c) => [clashReviewKey(c), c]));
  const wanted = Array.isArray(input.keys) ? input.keys.filter((k): k is string => typeof k === "string" && k !== "") : [];
  let keys: string[];
  let scope: Record<string, unknown>;
  if (wanted.length > 0) {
    const unknown = wanted.filter((k) => !byKey.has(k));
    if (unknown.length > 0) throw new InputError(`Beh ${run.saved?.id ?? run.id} tieto kľúče nemá: ${unknown.slice(0, 3).join("; ")}${unknown.length > 3 ? ` (a ${unknown.length - 3} ďalších)` : ""}. Kľúče (key) dá action=results.`);
    keys = [...new Set(wanted)];
    scope = { keys: keys.length };
  } else if (str(input.group)) {
    const by = (str(input.group_by) || "storey") as ClashGroupBy;
    if (!CLASH_GROUPS.includes(by)) throw new InputError(`group_by je jedno z ${CLASH_GROUPS.join(", ")}.`);
    const systems = by === "system" ? await systemsFor(run, deps) : undefined;
    const g = pickGroup(groupRun({ run, systems }, by), str(input.group));
    keys = [...new Set(g.members.map(clashReviewKey))];
    scope = { group: { key: g.key, title: g.title, group_by: by }, clashes: keys.length };
  } else {
    throw new InputError("Zadaj keys (kľúče z action=results) alebo group (+ group_by): stav sa nastavuje kolíziám, nie celému behu naraz.");
  }
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 2000) : undefined;
  const n = await store.setReviews(testRow.id, keys, { status, ...(comment !== undefined ? { comment } : {}) }, str(input.author) || CLASH_AUTHOR);
  return {
    test: testRow.code,
    review_status: status,
    ...(comment !== undefined ? { comment } : {}),
    updated: n,
    ...scope,
    note: "Stav sa viaže na test a dvojicu prvkov, nie na beh: platí aj v ďalších behoch a pri porovnaní (compare) sa ukáže pri každej kolízii.",
  };
}

// --- porovnanie ----------------------------------------------------------------------------

const refOf = (r: ClashRun) => ({ run_id: r.saved?.id ?? r.id, created_at: r.createdAt, total: r.result.clashes.length });

async function previousRun(run: ClashRun, deps: EngineDeps): Promise<ClashRun> {
  const store = need(deps);
  const testId = await testIdFor(run, deps, false);
  if (!testId) throw new InputError("Predošlý beh sa hľadá podľa testu; tento beh test nemá alebo ho DB nepozná. Daj base_run_id.");
  const runs = await store.runs(testId, 50);
  const idx = run.saved ? runs.findIndex((r) => r.id === run.saved!.id) : -1;
  const prev = run.saved ? (idx >= 0 ? runs[idx + 1] : runs[0]) : runs[0];
  if (!prev) throw new InputError("Test nemá predošlý uložený beh. Ulož beh (run save=true) pred zmenou modelu a po nej ho porovnaj, alebo daj base_run_id.");
  return loadSavedRun(prev.id, deps);
}

/** Porovnanie dvoch behov podľa `clashReviewKey`; "vyriešené" len ak beh prvky naozaj znova overil, inak "nepretestované". */
export async function execCompare(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const run = await findRun(input, deps);
  const baseId = str(input.base_run_id);
  const base = baseId ? await findRun({ run_id: baseId }, deps) : await previousRun(run, deps);
  if (base === run || (base.saved && base.saved.id === run.saved?.id)) throw new InputError("Porovnávaš ten istý beh: daj base_run_id iného behu.");
  const side = (r: ClashRun) => ({ result: r.result, modelNames: Object.fromEntries(Object.keys(r.models).map((m) => [m, m])) });
  const cmp = compareClashRevisions(side(base), side(run));
  // Beh orezaný stropom dvojíc nevidel všetko: chýbajúca kolízia nie je dôkaz opravy.
  const cut = !!run.result.truncated;
  const buckets: Record<ClashBucket, Clash[]> = {
    added: cmp.added,
    persistent: cmp.persistent,
    resolved: cut ? [] : cmp.resolved,
    unretested: cut ? [...cmp.unretested, ...cmp.resolved] : cmp.unretested,
  };
  const owner = (b: ClashBucket) => (b === "added" || b === "persistent" ? run : base);
  const reviews = await reviewMap(run, deps);
  const row = (b: ClashBucket, c: Clash) => {
    const r = clashRow(owner(b), c);
    const rv = reviews.get(r.key);
    return rv ? { ...r, review: { status: rv.status, ...(rv.comment ? { comment: rv.comment } : {}) } } : r;
  };

  const warnings: string[] = [];
  if (cut) warnings.push("Nový beh bol orezaný stropom dvojíc: žiadna kolízia sa nepovažuje za vyriešenú (všetky chýbajúce sú nepretestované); zúž test.");
  if (base.result.truncated) warnings.push("Základný beh bol orezaný stropom dvojíc: časť 'nových' kolízií tam len chýbala.");
  if (!same([base.spec.mode, base.spec.clearance, base.spec.tolerance], [run.spec.mode, run.spec.clearance, run.spec.tolerance])) {
    warnings.push("Behy majú iný režim, odstup alebo toleranciu: rozdiel môže byť z nastavenia, nie z modelu.");
  }
  if (!same([base.spec.a, base.spec.b], [run.spec.a, run.spec.b])) {
    warnings.push("Behy majú iný rozsah (triedy, model, podlažie): kolízie mimo nového rozsahu sú nepretestované, nie vyriešené.");
  }
  if (base.spec.code !== run.spec.code) warnings.push("Behy sú rôznych testov: stav kolízií sa berie z testu nového behu.");
  if (run.result.ruleCoverage?.[0]?.matchedKeysA === undefined) warnings.push("Nový beh nemá zoznam overených prvkov: chýbajúce kolízie sú nepretestované.");
  const changed = Object.keys({ ...base.models, ...run.models }).filter((m) => {
    const x = base.models[m] as { etag?: unknown; size?: unknown } | undefined;
    const y = run.models[m] as { etag?: unknown; size?: unknown } | undefined;
    return !same([x?.etag, x?.size], [y?.etag, y?.size]);
  });

  const out: Record<string, unknown> = {
    test: run.spec.name,
    run: refOf(run),
    base: refOf(base),
    summary: { added: buckets.added.length, persistent: buckets.persistent.length, resolved: buckets.resolved.length, unretested: buckets.unretested.length },
    by_storey: { added: countBy(buckets.added, (c) => storeyOfClash(run, c)), resolved: countBy(buckets.resolved, (c) => storeyOfClash(base, c)) },
    models_changed: changed,
    ...(Object.values(cmp.reasons).some((v) => v.length > 0) ? { reasons: cmp.reasons } : {}),
    ...(buckets.persistent.some((c) => reviews.get(clashReviewKey(c))?.status === "resolved")
      ? { persistent_marked_resolved: buckets.persistent.filter((c) => reviews.get(clashReviewKey(c))?.status === "resolved").length }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  const bucket = oneOf(input.bucket, CLASH_BUCKETS, "bucket");
  const pick = bucket ? [bucket] : [...CLASH_BUCKETS];
  const limit = bucket ? clamp(input.limit, 1, ROWS_MAX, 20) : SAMPLE;
  const offset = bucket ? clamp(input.offset, 0, buckets[bucket].length, 0) : 0;
  const rows = pick.map((b) => [b, buckets[b].slice(offset, offset + limit).map((c) => row(b, c))] as const);
  const refs = await withAim(rows.flatMap(([, rs]) => rs.flatMap((r) => [r.a, r.b])), deps);
  const withRef = (e: { global_id: string }) => ({ ...e, object_ref: refs.get(e.global_id) ?? null });
  out[bucket ? "rows" : "samples"] = Object.fromEntries(rows.map(([b, rs]) => [b, rs.map((r) => ({ ...r, a: withRef(r.a), b: withRef(r.b) }))]));
  if (bucket) {
    out.bucket = { name: bucket, count: buckets[bucket].length, next_offset: offset + limit < buckets[bucket].length ? offset + limit : null };
    out.show_in_3d = idsOf(owner(bucket), buckets[bucket]);
  }
  out.note =
    "added = nové, persistent = pretrvávajú, resolved = vyriešené (beh ich prvky znova overil), unretested = chýbajú, ale beh ich nemohol nájsť (iný rozsah, model alebo pravidlo). " +
    "bucket + limit + offset rozbalí kolízie a vráti show_in_3d (global_ids strany a a b).";
  return out;
}

// --- BCF téma ------------------------------------------------------------------------------

export interface TopicProposal {
  title: string;
  description: string;
  type: string;
  model: string | null;
  priority: string;
  labels: string[];
  global_ids: string[];
}

function viewpointOf(center: Vec3, span: number, selection: number): Record<string, unknown> {
  const [x, y, z] = center;
  const d = Math.max(span * 1.5, 3);
  return {
    guid: randomUUID(),
    source: "clash",
    frame: "ifc_world",
    units: "m",
    camera: {
      position: { x: round(x + d * 0.7), y: round(y - d * 0.7), z: round(z + d * 0.5) },
      target: { x, y, z },
      up: { x: 0, y: 0, z: 1 },
      projection: "perspective",
      fov_deg: 60,
    },
    selection_count: selection,
  };
}

/**
 * Založí BCF tému Clash za skupinu cez BCF vrstvu (D-099) a pripojí ju ku kolíziám skupiny
 * (`clash_reviews.bcf_topic_id`). Skupina, ktorá už tému má, novú nedostane (bez duplicít).
 */
export async function createBcfTopic(a: {
  run: ClashRun;
  members: Clash[];
  proposal: TopicProposal;
  center: { center: Vec3; span: number };
  deps: EngineDeps;
  author: string;
}): Promise<Record<string, unknown>> {
  const { run, members, proposal, deps } = a;
  if (!deps.bcf) throw new InputError("Založenie BCF témy potrebuje DB (BCF vrstvu), tu nie je dostupná.");
  const keys = [...new Set(members.map(clashReviewKey))];
  const testId = deps.clash ? await testIdFor(run, deps, true) : null;
  if (deps.clash && testId) {
    const inGroup = new Set(keys);
    const linked = (await deps.clash.reviews(testId)).filter((r) => r.bcf_topic_id && inGroup.has(r.clash_key));
    if (linked.length > 0) {
      const ids = [...new Set(linked.map((r) => r.bcf_topic_id!))];
      const numbers = await deps.clash.topicNumbers(ids);
      return {
        created: false,
        existing: { topics: ids.map((id) => ({ id, number: numbers.get(id) ?? null })), linked_clashes: linked.length },
        note: "Skupina už má BCF tému, nová sa nezakladá. Komentár, stav alebo priradenie: bcf_topic(action=update).",
      };
    }
  }
  const row = await deps.bcf.create({
    title: proposal.title,
    description: proposal.description,
    topic_type: "Clash",
    priority: proposal.priority,
    labels: proposal.labels,
    model: proposal.model,
    components: proposal.global_ids,
    viewpoint: viewpointOf(a.center.center, a.center.span, proposal.global_ids.length),
    author: a.author || CLASH_AUTHOR,
  });
  await deps.bcf.notify?.().catch(() => undefined);
  let linkError: string | undefined;
  if (deps.clash && testId) {
    try {
      await deps.clash.linkTopic(testId, keys, row.id);
    } catch (err) {
      linkError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    created: true,
    topic: { id: row.id, number: row.number, title: proposal.title },
    linked_clashes: deps.clash && testId && !linkError ? keys.length : 0,
    ...(linkError ? { warning: `Téma je založená, ale odkaz z kolízií sa nezapísal: ${linkError}` } : {}),
    ...(testId ? {} : { warning: "Téma je založená bez odkazu z kolízií (beh nemá test)." }),
    note: "Ukáž ju cez bcf_topic_list(guid) a show_in_3d(global_ids). Priradenie, stav a komentár: bcf_topic(action=update).",
  };
}

export type { ReviewStatus };
