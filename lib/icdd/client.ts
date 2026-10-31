/**
 * Export a import ICDD v prehliadači (D-181, Samuel 30. 10.: stiahnuť do PC, roundtrip v prvej verzii).
 * Plán dá host (`GET /api/icdd`), payloady sa stiahnu z verejných bucketov (IFC z archívu revízie, D-135),
 * overí sa sha256 a kontajner sa zloží lokálne. Kontrola načíta `.icdd`, overí ho a porovná so stavom AIM.
 */

import { gunzipSync } from "fflate";

import { assembleIcdd } from "./build";
import { containerFileName, ISO_ONTOLOGY_FILES, type IcddPlan } from "./model";
import { compareStates, detectAimNamespace, stateFromContainer, stateFromPlan, type RoundtripDiff } from "./roundtrip";
import { validateIcdd, type ValidationReport } from "./validate";

export type Progress = (msg: string) => void;

async function getPlan(fetchFn: typeof fetch): Promise<IcddPlan> {
  const r = await fetchFn("/api/icdd", { cache: "no-store" });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `plán ICDD: HTTP ${r.status}`);
  return body as IcddPlan;
}

async function getBytes(fetchFn: typeof fetch, url: string): Promise<Uint8Array> {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Rozbalí gzip, ak ho server už nerozbalil sám (Content-Encoding). */
export function maybeGunzip(data: Uint8Array): Uint8Array {
  return data.length > 2 && data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
}

export async function loadOntologies(fetchFn: typeof fetch = fetch): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of ISO_ONTOLOGY_FILES) {
    const r = await fetchFn(`/icdd/ontology/${f}`);
    if (!r.ok) throw new Error(`ontológia ${f}: HTTP ${r.status}`);
    out[f] = await r.text();
  }
  return out;
}

export interface ExportResult {
  plan: IcddPlan;
  filename: string;
  bytes: Uint8Array;
  report: ValidationReport;
}

/** Zloží kontajner a pred odovzdaním ho skontroluje tou istou kontrolou ako import. */
export async function exportIcdd(progress: Progress = () => {}, fetchFn: typeof fetch = fetch): Promise<ExportResult> {
  progress("načítavam plán z AIM");
  const plan = await getPlan(fetchFn);
  const ontologies = await loadOntologies(fetchFn);
  const payloads = new Map<string, Uint8Array>();
  let i = 0;
  for (const p of plan.payloads) {
    progress(`sťahujem ${++i}/${plan.payloads.length}: ${p.filename}`);
    const raw = await getBytes(fetchFn, p.url);
    payloads.set(p.id, p.gzip ? maybeGunzip(raw) : raw);
  }
  progress("skladám kontajner");
  const bytes = assembleIcdd({ plan, payloads, ontologies });
  progress("kontrolujem kontajner");
  const report = validateIcdd(bytes);
  return { plan, filename: containerFileName(plan.versionID), bytes, report };
}

export interface CheckResult {
  report: ValidationReport;
  diff: RoundtripDiff | null;
  versionID: string | null;
}

/** Import späť: kontrola kontajnera a porovnanie s aktuálnym stavom AIM (bez zápisu do DB). */
export async function checkIcdd(bytes: Uint8Array, progress: Progress = () => {}, fetchFn: typeof fetch = fetch): Promise<CheckResult> {
  progress("kontrolujem kontajner");
  const report = validateIcdd(bytes);
  if (!report.contents) return { report, diff: null, versionID: null };
  progress("porovnávam so stavom AIM");
  const plan = await getPlan(fetchFn);
  const container = stateFromContainer(report.contents, detectAimNamespace(report.contents, plan.aimNamespace));
  return { report, diff: compareStates(container, stateFromPlan(plan)), versionID: container.versionID };
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
