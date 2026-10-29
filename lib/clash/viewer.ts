import { clashReviewKey } from "@ifc-lite/clash";

import { DEFAULT_TESTS, findTest, type ClashTest } from "../engine/clash-tests";
import {
  MAX_LOAD_RESULTS,
  MAX_SAVE_RESULTS,
  type ClashElementWire,
  type ClashLoadPayload,
  type ClashResultWire,
  type ClashSaveResult,
  type ClashSaveWire,
  type ClashTestWire,
} from "../viewer-clash";

import type { ClashResultRow, ClashReviewRow, ClashRunRow, ClashStore, ClashTestRow, ClashTestWrite, ReviewStatus } from "./types";

/**
 * Clash z AIM pre viewer (D-164, host PR3): čítanie testu a behu pre `CLASH_LOAD` a zápis `CLASH_SAVE` z panela
 * (test, beh, stav kolízií) do `clash_*`. Bez motora: len `@ifc-lite/clash` kvôli `clashReviewKey`, aby kľúč
 * kolízie z panela bol ten istý, aký píše `clash` v chate (pravidlo + dvojica `model:GUID` bez ohľadu na poradie).
 */

export class ClashViewerError extends Error {}

export const VIEWER_AUTHOR = "Viewer (panel clash)";
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** Verzia enginu v panele; nesie ju beh, aby sa dalo porovnávať behy rovnakého pôvodu. */
export const VIEWER_ENGINE = "ifc-lite-viewer";

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
const keyOf = (e: Pick<ClashElementWire, "model" | "guid">) => `${e.model}:${e.guid}`;
/** Kľúč kolízie ako `clashReviewKey` v chate: pravidlo = kód testu. */
export const clashKey = (rule: string, a: ClashElementWire, b: ClashElementWire) => clashReviewKey({ rule, a: { key: keyOf(a) }, b: { key: keyOf(b) } } as Parameters<typeof clashReviewKey>[0]);
/** Súradnice IFC (Z hore) -> engine (Y hore), inverzia `toIfc` z `lib/engine/measure.ts`. */
const toEngine = (c: readonly number[]): number[] => [c[0], c[2], -c[1] || 0];

function countBy<T>(items: T[], key: (x: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// --- test <-> wire -------------------------------------------------------------------------

export const testToWire = (t: ClashTest): ClashTestWire & { code: string } => ({
  code: t.code,
  name: t.name,
  ...(t.description ? { description: t.description } : {}),
  a: t.a,
  ...(t.b ? { b: t.b } : {}),
  mode: t.mode,
  ...(t.clearance_mm ? { clearance_mm: t.clearance_mm } : {}),
  ...(t.tolerance_mm !== undefined ? { tolerance_mm: t.tolerance_mm } : {}),
});

function rowToWire(r: ClashTestRow): ClashTestWire & { code: string } {
  const rule = r.rules[0];
  return testToWire({
    code: r.code,
    name: r.name,
    description: r.description ?? "",
    a: rule.a,
    ...(rule.b ? { b: rule.b } : {}),
    mode: r.settings.mode ?? "hard",
    ...(r.settings.clearance_mm !== undefined ? { clearance_mm: r.settings.clearance_mm } : {}),
    ...(r.settings.tolerance_mm !== undefined ? { tolerance_mm: r.settings.tolerance_mm } : {}),
  });
}

function writeOf(t: ClashTestWire & { code: string }, origin: ClashTestWrite["origin"], by: string | null): ClashTestWrite {
  return {
    code: t.code,
    name: t.name,
    description: t.description ?? null,
    origin,
    created_by: by,
    rules: [{ id: t.code, a: t.a, ...(t.b ? { b: t.b } : {}) }],
    settings: {
      mode: t.mode,
      ...(t.mode === "clearance" ? { clearance_mm: t.clearance_mm } : {}),
      tolerance_mm: t.tolerance_mm ?? 2,
    },
  };
}

async function findRow(store: ClashStore, ref: string): Promise<ClashTestRow | null> {
  const want = ref.trim().toLowerCase();
  return (await store.listTests()).find((t) => t.code.toLowerCase() === want || t.name.toLowerCase() === want) ?? null;
}

// --- čítanie (CLASH_LOAD) --------------------------------------------------------------------

function toResultWire(r: ClashResultRow, review: ClashReviewRow | undefined): ClashResultWire {
  return {
    key: r.clash_key,
    kind: r.status,
    severity: r.severity,
    distance: r.distance,
    a: { model: r.a_model, guid: r.a_guid, ...(r.a_ifc_type ? { type: r.a_ifc_type } : {}), ...(r.a_name ? { name: r.a_name } : {}) },
    b: { model: r.b_model, guid: r.b_guid, ...(r.b_ifc_type ? { type: r.b_ifc_type } : {}), ...(r.b_name ? { name: r.b_name } : {}) },
    storey: r.storey,
    center: r.center,
    review: review?.status ?? "open",
    ...(review?.comment ? { comment: review.comment } : {}),
  };
}

const RANK = { critical: 0, major: 1, minor: 2, info: 3 } as const;

function runInfo(r: ClashRunRow): NonNullable<ClashLoadPayload["run"]> {
  return {
    id: r.id,
    created_at: r.created_at,
    trigger: r.trigger,
    total: typeof r.summary.total === "number" ? r.summary.total : null,
    by_status: (r.summary.by_status as Record<string, number> | undefined) ?? null,
    models: r.models,
    ...(r.completeness.truncated ? { truncated: true } : {}),
  };
}

/** Test (predvolený z kódu alebo z DB) a voliteľne uložený beh s kolíziami a ich stavom; `run` = UUID | `latest`. */
export async function loadForViewer(store: ClashStore, req: { test: string; run?: string }): Promise<ClashLoadPayload> {
  const preset = findTest(req.test);
  const row = await findRow(store, req.test);
  if (!preset && !row) {
    throw new ClashViewerError(`Test '${req.test}' nie je (clash action=list ukáže všetky).`);
  }
  const wire = row ? rowToWire(row) : testToWire(preset!);
  // Predvolený test z kódu vyhráva nad riadkom v DB (riadok sa pri uložení behu vyrovná s kódom).
  const test = { ...(preset ? testToWire(preset) : wire), origin: row?.origin ?? "default" };
  if (!req.run) return { test };
  if (!row) throw new ClashViewerError(`Test '${test.code}' ešte nemá uložený beh.`);
  let run: ClashRunRow | null | undefined;
  if (req.run === "latest") run = (await store.runs(row.id, 1))[0];
  else run = await store.run(req.run);
  if (!run || run.test_id !== row.id) {
    throw new ClashViewerError(req.run === "latest" ? `Test '${test.code}' nemá uložený beh.` : `Beh '${req.run}' nepatrí testu '${test.code}' alebo neexistuje.`);
  }
  const reviews = new Map((await store.reviews(row.id)).map((x) => [x.clash_key, x]));
  const all = await store.results(run.id);
  const sorted = [...all].sort((x, y) => RANK[x.severity] - RANK[y.severity] || x.distance - y.distance);
  const rows = sorted.slice(0, MAX_LOAD_RESULTS);
  return {
    test,
    run: runInfo(run),
    results: rows.map((r) => toResultWire(r, reviews.get(r.clash_key))),
    results_total: all.length,
    ...(all.length > rows.length ? { results_truncated: true } : {}),
  };
}

/** Zoznam testov s posledným behom (`GET /api/clash` bez parametrov). */
export async function listForViewer(store: ClashStore): Promise<Array<Record<string, unknown>>> {
  const rows = await store.listTests();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const entries = [
    ...DEFAULT_TESTS.map((t) => ({ test: testToWire(t), row: byCode.get(t.code) })),
    ...rows.filter((r) => r.origin !== "default").map((r) => ({ test: rowToWire(r), row: r })),
  ];
  const ids = entries.flatMap((e) => (e.row ? [e.row.id] : []));
  const last = ids.length ? await store.lastRuns(ids) : new Map<string, ClashRunRow>();
  return entries.map((e) => {
    const run = e.row ? last.get(e.row.id) : undefined;
    return { code: e.test.code, name: e.test.name, origin: e.row?.origin ?? "default", last_run: run ? runInfo(run) : null };
  });
}

// --- zápis (CLASH_SAVE, from_viewer) -------------------------------------------------------------

const slug = (name: string) =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 76);

/** Kód nového testu z názvu; pri kolízii s iným testom `-2`, `-3`... */
async function freshCode(store: ClashStore, name: string): Promise<string> {
  const base = slug(name);
  if (!base) throw new ClashViewerError("Test potrebuje kód alebo názov s písmenami a číslami.");
  for (let n = 1; n < 100; n++) {
    const code = n === 1 ? base : `${base}-${n}`;
    if (!findTest(code) && !(await store.testByCode(code))) return code;
  }
  throw new ClashViewerError(`Pre názov '${name}' sa nenašiel voľný kód testu.`);
}

/** Riadok testu pre beh a stav kolízií: predvolený sa vyrovná s kódom, vlastný musí existovať. */
async function testRowFor(store: ClashStore, code: string): Promise<ClashTestRow> {
  const preset = findTest(code);
  if (preset) return store.upsertTest(writeOf({ ...testToWire(preset) }, "default", null));
  const row = await store.testByCode(code);
  if (!row) throw new ClashViewerError(`Test '${code}' v AIM nie je: pošli ho spolu s behom (test) alebo ho ulož v chate.`);
  return row;
}

function resultRow(code: string, r: ClashResultWire): ClashResultRow {
  const center = r.center ? r.center.map((v) => round(v)) : null;
  return {
    clash_key: clashKey(code, r.a, r.b),
    rule: code,
    status: r.kind,
    severity: r.severity,
    distance: r.distance,
    a_guid: r.a.guid,
    a_model: r.a.model,
    a_ifc_type: r.a.type ?? null,
    a_name: r.a.name ?? null,
    b_guid: r.b.guid,
    b_model: r.b.model,
    b_ifc_type: r.b.type ?? null,
    b_name: r.b.name ?? null,
    storey: r.storey ?? null,
    center,
    point: center ? toEngine(center) : null,
    bounds: null,
  };
}

/**
 * Zápis z panela: test (posledný zápis vyhráva, predvolený sa neprepisuje), beh (`trigger='viewer'`, bez zoznamu
 * overených prvkov, preto porovnanie povie "nepretestované", nie "vyriešené") a stav kolízií po kolíziách.
 */
export async function saveFromViewer(store: ClashStore, save: ClashSaveWire, by = VIEWER_AUTHOR): Promise<Extract<ClashSaveResult, { ok: true }>> {
  const notes: string[] = [];
  let code = save.test?.code ?? save.test_code;
  if (code && !CODE_RE.test(code)) throw new ClashViewerError("Kód testu: písmená, čísla, . _ - (max 80, začína písmenom alebo číslom).");
  let testSaved = false;
  if (save.test) {
    if (code && findTest(code)) {
      notes.push(`'${code}' je predvolený test (len na čítanie): zmeny testu sa neuložili, ulož ho pod iným názvom.`);
    } else {
      const existing = code ? await store.testByCode(code) : null;
      code = code ?? (await freshCode(store, save.test.name));
      const row = await store.upsertTest(writeOf({ ...save.test, code }, existing?.origin ?? "viewer", existing?.created_by ?? by));
      code = row.code;
      testSaved = true;
    }
  }
  const out: Extract<ClashSaveResult, { ok: true }> = { ok: true, ...(code ? { test_code: code } : {}) };
  if (testSaved) notes.push("Test je v AIM; posledný zápis vyhráva.");

  if (save.run || (save.reviews && save.reviews.length > 0)) {
    if (!code) throw new ClashViewerError("Beh a stav kolízií patria testu: ulož test (názov) alebo pošli jeho kód.");
  }
  if (save.run) {
    const row = await testRowFor(store, code!);
    const seen = new Set<string>();
    const rows: ClashResultRow[] = [];
    for (const r of save.run.results) {
      const next = resultRow(row.code, r);
      if (seen.has(next.clash_key)) continue;
      seen.add(next.clash_key);
      rows.push(next);
    }
    if (rows.length > MAX_SAVE_RESULTS) throw new ClashViewerError(`Beh má ${rows.length} kolízií, nad stropom ${MAX_SAVE_RESULTS}: zúž test (podlažie, konkrétne triedy).`);
    const rule = row.rules[0];
    const spec = {
      name: row.name,
      code: row.code,
      a: rule.a,
      ...(rule.b ? { b: rule.b } : {}),
      mode: row.settings.mode,
      clearance: (row.settings.clearance_mm ?? 0) / 1000,
      tolerance: (row.settings.tolerance_mm ?? 2) / 1000,
    };
    const runId = await store.saveRun(
      {
        test_id: row.id,
        test_code: row.code,
        rules_snapshot: { spec },
        models: save.run.models ?? {},
        engine: VIEWER_ENGINE,
        trigger: "viewer",
        completeness: { coverage_omitted: true, ...(save.run.truncated ? { truncated: true } : {}) },
        summary: {
          total: rows.length,
          by_status: countBy(rows, (x) => x.status),
          by_severity: countBy(rows, (x) => x.severity),
          by_storey: countBy(rows, (x) => x.storey),
          by_type_pair: countBy(rows, (x) => `${x.a_ifc_type ?? "?"} x ${x.b_ifc_type ?? "?"}`),
        },
        coverage: null,
        created_by: by,
      },
      rows,
    );
    out.run_id = runId;
    out.results = rows.length;
    notes.push("Beh z panela nemá zoznam overených prvkov: porovnanie s ním povie 'nepretestované', nie 'vyriešené'. Porovnávaj behy rovnakého pôvodu.");
  }
  if (save.reviews && save.reviews.length > 0) {
    const row = await testRowFor(store, code!);
    const groups = new Map<string, { status: ReviewStatus; comment?: string; keys: Set<string> }>();
    for (const r of save.reviews) {
      const id = `${r.status}\u0000${r.comment ?? ""}\u0000${r.comment === undefined ? "keep" : "set"}`;
      const g = groups.get(id) ?? { status: r.status, ...(r.comment !== undefined ? { comment: r.comment } : {}), keys: new Set<string>() };
      g.keys.add(clashKey(row.code, r.a, r.b));
      groups.set(id, g);
    }
    let n = 0;
    for (const g of groups.values()) {
      n += await store.setReviews(row.id, [...g.keys], { status: g.status, ...(g.comment !== undefined ? { comment: g.comment } : {}) }, by);
    }
    out.reviews = n;
  }
  if (notes.length > 0) out.notes = notes;
  return out;
}
