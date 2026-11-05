import { InputError, str, type EngineDeps } from "../engine/tools";
import { CLASH_UUID_RE, parseClashSave, type ClashOpenReq, type ClashSaveWire } from "../viewer-clash";

import { ClashViewerError, loadForViewer, saveFromViewer, VIEWER_AUTHOR } from "./viewer";

/**
 * `clash action=open` and `from_viewer` (D-164, host PR3): the clash panel in the viewer. Pattern of `ids_document` (D-162):
 * `open` sends the live viewer the op `clash_open` and waits for `APPLIED`, `from_viewer` reads `view_state.clash_local`.
 */

export type ClashOpenOutcome = { ok: true; issues: string[] } | { ok: false; reason: string };

export interface ClashViewerDeps {
  /** Sends the viewer the op `clash_open` and waits for the `APPLIED` acknowledgement. */
  open: (req: ClashOpenReq) => Promise<ClashOpenOutcome>;
  /** Raw `view_state` response from the open viewer; string = why it could not be read. */
  viewState: () => Promise<unknown>;
}

function need(deps: EngineDeps): NonNullable<EngineDeps["clash"]> {
  if (!deps.clash) throw new InputError("Kolízie v AIM (testy, behy, stav) potrebujú DB, tu nie je dostupná.");
  return deps.clash;
}

function viewer(deps: EngineDeps, action: string): ClashViewerDeps {
  if (!deps.clashViewer) throw new InputError(`action=${action}: živý viewer nie je nastavený (LIVE_CHANNEL).`);
  return deps.clashViewer;
}

const asInput = (err: unknown): never => {
  if (err instanceof ClashViewerError) throw new InputError(err.message);
  throw err;
};

/** `open`: the test and optionally a saved run from the DB into the clash panel in the viewer (clashes with state for highlighting). */
export async function execOpen(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const v = viewer(deps, "open");
  const ref = str(input.test);
  if (!ref) throw new InputError("Zadaj test (kód alebo názov; action=list ukáže všetky).");
  const run = str(input.run_id) || undefined;
  if (run && run !== "latest" && !CLASH_UUID_RE.test(run)) {
    throw new InputError("run_id pre open: UUID uloženého behu (action=list test=...) alebo 'latest'; beh z pamäte (run-N) sa do viewera neprenáša, najprv ho ulož (run save=true).");
  }
  const payload = await loadForViewer(need(deps), { test: ref, ...(run ? { run } : {}) }).catch(asInput);
  const outcome = await v.open({ test: payload.test.code, ...(run ? { run } : {}) });
  if (!outcome.ok) throw new InputError(`Viewer panel clash neotvoril: ${outcome.reason}`);
  return {
    opened: true,
    test: { code: payload.test.code, name: payload.test.name, mode: payload.test.mode },
    ...(payload.run ? { run: { run_id: payload.run.id, total: payload.run.total, by_status: payload.run.by_status, trigger: payload.run.trigger } } : {}),
    ...(payload.results ? { results_in_viewer: payload.results.length, ...(payload.results_truncated ? { results_truncated: true, results_total: payload.results_total } : {}) } : {}),
    ...(outcome.issues.length ? { issues: outcome.issues } : {}),
    note: "Používateľ kolízie vidí v paneli (stav open / resolved / accepted z AIM). Ukázať ich v 3D: results + show_in_3d / style_in_3d nad global_ids. Čo upraví v paneli, uloží tlačidlom Uložiť do AIM alebo from_viewer.",
  };
}

/** `from_viewer`: saves the test and the changed clash states the user has in the clash panel (a run is saved only by the button in the panel). */
export async function execFromViewer(input: Record<string, unknown>, deps: EngineDeps): Promise<Record<string, unknown>> {
  const v = viewer(deps, "from_viewer");
  const store = need(deps);
  const state = await v.viewState();
  if (typeof state === "string") throw new InputError(`Stav viewera sa nedal prečítať: ${state}`);
  const local = (state as { clash_local?: Record<string, unknown> } | null)?.clash_local;
  if (!local || typeof local !== "object") {
    throw new InputError("Vo vieweri nie je otvorený panel clash s testom (clash_local nie je; starší fork?). Otvor ho: clash(action=open).");
  }
  const override = str(input.test) || undefined;
  const reviews = Array.isArray(local.reviews) ? local.reviews : [];
  const hasTest = local.test !== undefined && local.test !== null;
  if (local.from_aim === true && local.dirty !== true && reviews.length === 0 && !override) {
    return { saved: false, test: (local.test as { code?: string } | undefined)?.code, note: "Test v paneli je rovnaký ako v AIM a nemá zmenený stav kolízie, nič sa neuložilo." };
  }
  if (!hasTest && reviews.length === 0) throw new InputError("V paneli clash nie je test ani zmenený stav kolízie, nie je čo uložiť.");
  const test = hasTest && typeof local.test === "object" ? { ...(local.test as Record<string, unknown>), ...(override ? { code: override } : {}) } : undefined;
  const save = parseClashSave({
    ...(test ? { test } : {}),
    ...(!test && override ? { test_code: override } : {}),
    ...(!test && !override && typeof local.test_code === "string" ? { test_code: local.test_code } : {}),
    ...(reviews.length > 0 ? { reviews } : {}),
  }) as ClashSaveWire | null;
  if (!save) throw new InputError("Test alebo stavy kolízií v paneli majú neplatný tvar (starší fork?); použi tlačidlo Uložiť do AIM v paneli.");
  const saved = await saveFromViewer(store, save, str(input.author) || `${VIEWER_AUTHOR} (cez Claude)`).catch(asInput);
  return {
    saved: true,
    ...saved,
    note: "Test a stavy sú v AIM (posledný zápis vyhráva). Beh s kolíziami z panela uloží len tlačidlo Uložiť do AIM; chat si beh vie spustiť na serveri (run test=<kód> save=true). Viewer o zmene vie, ak ho otvoríš znova (open).",
  };
}
