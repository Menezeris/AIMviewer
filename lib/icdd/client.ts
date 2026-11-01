/**
 * Export a import ICDD v prehliadači (D-181, Samuel 30. 10.: stiahnuť do PC, roundtrip v prvej verzii).
 * Plán dá host (`GET /api/icdd`), payloady sa stiahnu z verejných bucketov (IFC z archívu revízie, D-135),
 * overí sa sha256 a kontajner sa zloží lokálne. Kontrola načíta `.icdd`, overí ho a porovná so stavom AIM.
 */

import { gunzipSync } from "fflate";

import { assembleIcdd, sideFiles } from "./build";
import { containerFileName, ISO_ONTOLOGY_FILES, type Extra, type IcddPlan } from "./model";
import { importRequestFromContents, type ImportPreview, type ImportRequest } from "./import";
import { compareStates, detectAimNamespace, stateFromContainer, stateFromPlan, type RoundtripDiff } from "./roundtrip";
import { sha256 } from "./sha256";
import { validateIcdd, type ValidationReport } from "./validate";

export type Progress = (msg: string) => void;

async function getPlan(fetchFn: typeof fetch, extras?: Extra[]): Promise<IcddPlan> {
  const r = await fetchFn(extras ? `/api/icdd?extras=${extras.join(",")}` : "/api/icdd", { cache: "no-store" });
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
  /** Súbory navyše mimo `.icdd` (xlsx výpis), stiahnu sa vedľa kontajnera. */
  sideFiles: { filename: string; mime: string; bytes: Uint8Array }[];
}

/** Zloží kontajner a pred odovzdaním ho skontroluje tou istou kontrolou ako import. */
export async function exportIcdd(
  progress: Progress = () => {},
  fetchFn: typeof fetch = fetch,
  extras?: Extra[],
): Promise<ExportResult> {
  progress("načítavam plán z AIM");
  const plan = await getPlan(fetchFn, extras);
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
  return { plan, filename: containerFileName(plan.versionID), bytes, report, sideFiles: sideFiles(plan) };
}

export interface CheckResult {
  report: ValidationReport;
  diff: RoundtripDiff | null;
  versionID: string | null;
  /** Požiadavka na import (bez obsahu payloadov), ak sa kontajner dal prečítať. */
  request: ImportRequest | null;
}

/** Import späť: kontrola kontajnera a porovnanie s aktuálnym stavom AIM (bez zápisu do DB). */
export async function checkIcdd(
  bytes: Uint8Array,
  progress: Progress = () => {},
  fetchFn: typeof fetch = fetch,
  fileName: string | null = null,
): Promise<CheckResult> {
  progress("kontrolujem kontajner");
  const report = validateIcdd(bytes);
  if (!report.contents) return { report, diff: null, versionID: null, request: null };
  progress("porovnávam so stavom AIM");
  const plan = await getPlan(fetchFn);
  const ns = detectAimNamespace(report.contents, plan.aimNamespace);
  const container = stateFromContainer(report.contents, ns);
  const request = importRequestFromContents(report.contents, report, sha256(bytes), fileName, ns, container.versionID);
  return { report, diff: compareStates(container, stateFromPlan(plan)), versionID: container.versionID, request };
}

export interface ImportResponse {
  preview: ImportPreview;
  /** id uloženého náhľadu v `icdd_imports`; null = zápis je vypnutý (ICDD_IMPORT_ENABLED). */
  importId: string | null;
  writeEnabled: boolean;
  record?: { id: string; written_ids: string[]; closed_ids: string[]; applied_at: string };
}

async function postImport(fetchFn: typeof fetch, body: unknown): Promise<ImportResponse> {
  const r = await fetchFn("/api/icdd/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await r.json();
  if (!r.ok) throw new Error(out?.error ?? `import ICDD: HTTP ${r.status}`);
  return out as ImportResponse;
}

/** Náhľad importu (dry-run): čo sa zapíše, čo je bez zmeny a nálezy. Pri zapnutej bráne sa náhľad uloží. */
export function previewImport(request: ImportRequest, fetchFn: typeof fetch = fetch): Promise<ImportResponse> {
  return postImport(fetchFn, { action: "preview", request });
}

/** Zápis importu za bránou; pri zmene stavu AIM od náhľadu server vráti 409. */
export function applyImport(request: ImportRequest, importId: string, aimStateSha256: string, fetchFn: typeof fetch = fetch): Promise<ImportResponse> {
  return postImport(fetchFn, { action: "apply", request, importId, aimStateSha256 });
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/zip") {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
