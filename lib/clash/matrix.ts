import { clashReviewKey } from "@ifc-lite/clash";

import { findRun } from "../engine/clash";
import { reviewMap } from "../engine/clash-saved";
import { InputError, str, type EngineDeps } from "../engine/tools";
import { CLASH_UUID_RE } from "../viewer-clash";

/**
 * `clash action=matrix` (D-177): kolízie ako matica modelov (disciplín) federácie, napr. ASR x VZT.
 * Otvorený beh vo vieweri: `view_state.clash_local.matrix` bez zmeny (`source: "local"`); uložený beh
 * z DB (`run_id`): ten istý tvar z uložených výsledkov (`source: "saved"`).
 */

export interface ClashMatrixCell {
  a: string;
  b: string;
  total: number;
  by_status: Record<string, number>;
  by_review: Record<string, number>;
}

export interface ClashMatrix {
  models: string[];
  cells: ClashMatrixCell[];
  filter?: { a: string; b: string };
}

const REVIEWS = ["open", "resolved", "accepted"] as const;

const NOTE =
  "Bunka = neusporiadaná dvojica modelov (a <= b), počty podľa druhu (hard / clearance) a stavu (open / resolved / accepted). " +
  "Na 'koľko kolízií je medzi ASR a VZT a koľko je otvorených' použi túto maticu, nepočítaj z riadkov results (sú orezané).";

/** Matica z uloženého behu: dvojica modelov kolízie je neusporiadaná, chýbajúci stav je open. */
async function savedMatrix(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const id = str(input.run_id);
  if (!CLASH_UUID_RE.test(id)) throw new InputError("run_id pre matrix: UUID uloženého behu (action=list test=...). Bez run_id sa berie beh otvorený vo vieweri; beh z pamäte (run-N) najprv ulož (run save=true).");
  const run = await findRun(input, deps);
  const reviews = await reviewMap(run, deps);
  const models = new Set<string>();
  const cells = new Map<string, ClashMatrixCell>();
  for (const c of run.result.clashes) {
    const [a, b] = c.a.model <= c.b.model ? [c.a.model, c.b.model] : [c.b.model, c.a.model];
    models.add(a).add(b);
    const key = `${a}\u0000${b}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { a, b, total: 0, by_status: { hard: 0, clearance: 0 }, by_review: Object.fromEntries(REVIEWS.map((s) => [s, 0])) };
      cells.set(key, cell);
    }
    const review = reviews.get(clashReviewKey(c))?.status ?? "open";
    cell.total++;
    cell.by_status[c.status] = (cell.by_status[c.status] ?? 0) + 1;
    cell.by_review[review] = (cell.by_review[review] ?? 0) + 1;
  }
  const matrix: ClashMatrix = {
    models: [...models].sort(),
    cells: [...cells.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0)),
  };
  return { source: "saved", run_id: id, total: run.result.clashes.length, matrix, note: NOTE };
}

async function localMatrix(deps: EngineDeps): Promise<Record<string, unknown>> {
  if (!deps.clashViewer) throw new InputError("action=matrix bez run_id: živý viewer nie je nastavený (LIVE_CHANNEL); matica uloženého behu: run_id (UUID).");
  const state = await deps.clashViewer.viewState();
  if (typeof state === "string") throw new InputError(`Stav viewera sa nedal prečítať: ${state}`);
  const local = (state as { clash_local?: { run?: { total?: number }; matrix?: ClashMatrix } } | null)?.clash_local;
  if (!local || typeof local !== "object" || !local.run) throw new InputError("Vo vieweri nie je otvorený beh kolízií: najprv spusti test (clash open run), alebo daj run_id uloženého behu.");
  if (!local.matrix) throw new InputError("Viewer ešte nemá maticu (starší fork bez clash_local.matrix); matica uloženého behu: run_id (UUID).");
  return { source: "local", ...(typeof local.run.total === "number" ? { total: local.run.total } : {}), matrix: local.matrix, note: NOTE };
}

export async function execMatrix(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  return str(input.run_id) ? savedMatrix(input, deps) : localMatrix(deps);
}
