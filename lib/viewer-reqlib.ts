/**
 * Knižnica požiadaviek vo vieweri (D-182, #351): most pre kartu "Requirements library" a uloženie výsledku kontroly.
 *
 * Viewer -> host `REQLIB_REQUEST {id, action, payload}`, host -> viewer `REQLIB_RESULT {id, ok, data?, error?}`:
 *  - `catalog`  -> `GET /api/ids/library`;
 *  - `assign`   -> `POST /api/ids/library` ("Priradiť k projektu");
 *  - `bind`     -> `POST /api/ids/models` (ručná väzba IDS na model);
 *  - `open`     -> `GET /api/ids?code&version` a existujúci `IDS_LOAD` s pôvodom (`origin`, `library_commit`);
 *  - `save_run` -> `POST /api/ids/runs` pre každý model behu: revíziu doplní host z modelu, ktorý viewer načítal
 *    (kontrola beží raz, vo vieweri; server ju neopakuje).
 * Zápisy sú za `IDS_WRITE_ENABLED` v routes; tu sa len skladajú požiadavky a odpovede.
 */

import { modelKey, type IfcModel } from "./data/ifc-models";

export const REQLIB_ACTIONS = ["catalog", "assign", "bind", "open", "save_run"] as const;
export type ReqlibAction = (typeof REQLIB_ACTIONS)[number];

export interface ReqlibRequest {
  id: string;
  action: ReqlibAction;
  payload: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseReqlibRequest(raw: unknown): ReqlibRequest | null {
  if (!isObj(raw) || raw.type !== "REQLIB_REQUEST") return null;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 100) return null;
  if (!(REQLIB_ACTIONS as readonly string[]).includes(raw.action as string)) return null;
  return { id: raw.id, action: raw.action as ReqlibAction, payload: isObj(raw.payload) ? raw.payload : {} };
}

/** Posledný segment cesty URL bez query (tak model pomenuje viewer pri automatickom načítaní). */
const urlFile = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "");

/**
 * Model behu z viewera -> kľúč modelu v AIM a revízia, ktorú viewer naozaj načítal (z URL, ktorú mu host dal).
 * Viewer pomenuje model podľa súboru (`ASR.ifc`, pri archíve `v079.ifc.gz`); pri viacerých zhodách nič (radšej
 * neuložiť než priradiť zlú revíziu).
 */
export function resolveRunModel(models: readonly IfcModel[], viewer: { model_id?: unknown; model_name?: unknown }): { model: string; revision: number | null } | null {
  const names = [viewer.model_name, viewer.model_id].filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().toLowerCase());
  const hits = models.filter((m) => {
    const file = urlFile(m.url).toLowerCase();
    const key = (modelKey(m.url) ?? "").toLowerCase();
    return names.some((n) => n === file || n === key || n === m.id.toLowerCase() || n === m.label.toLowerCase());
  });
  if (hits.length !== 1) return null;
  const key = modelKey(hits[0].url);
  return key ? { model: key, revision: hits[0].revision ?? null } : null;
}

type Fetch = typeof fetch;

export interface ReqlibDeps {
  fetch: Fetch;
  /** Modely, ktoré host dal vieweru (s revíziou). */
  models: readonly IfcModel[];
  /** Správa do viewera (host doplní `source`). */
  post: (msg: Record<string, unknown>) => void;
}

async function call(f: Fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await f(url, { cache: "no-store", ...init });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${r.status}`);
  return body;
}

const postJson = (f: Fetch, url: string, body: unknown) =>
  call(f, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function saveRun(payload: Record<string, unknown>, deps: ReqlibDeps) {
  const runs = Array.isArray(payload.runs) ? (payload.runs as Array<Record<string, unknown>>) : [];
  if (runs.length === 0) throw new Error("Beh nemá žiadny model.");
  const resolved = runs.map((run) => ({ run, target: resolveRunModel(deps.models, run) }));
  const unknown = resolved.filter((r) => !r.target).map((r) => String(r.run.model_name ?? r.run.model_id ?? "?"));
  if (unknown.length) throw new Error(`Model ${unknown.join(", ")} nie je model federácie AIM; výsledok sa neuložil.`);
  const saved = [];
  for (const { run, target } of resolved) {
    const out = await postJson(deps.fetch, "/api/ids/runs", {
      code: payload.code,
      version: payload.version,
      ids_sha256: payload.ids_sha256,
      engine_version: payload.engine_version,
      author: payload.author,
      model: target!.model,
      revision: target!.revision,
      specs: run.specs,
    });
    saved.push({ model: target!.model, revision: target!.revision, run_id: out.run_id, ...(typeof out.warning === "string" ? { warning: out.warning } : {}) });
  }
  return { saved };
}

async function openIds(payload: Record<string, unknown>, deps: ReqlibDeps) {
  const code = typeof payload.code === "string" ? payload.code : "";
  const version = typeof payload.version === "number" ? payload.version : undefined;
  const target = payload.target === "studio" ? "studio" : "validation";
  if (!code) throw new Error("Chýba kód IDS.");
  const doc = await call(deps.fetch, `/api/ids?code=${encodeURIComponent(code)}${version ? `&version=${version}` : ""}`);
  deps.post({
    type: "IDS_LOAD",
    code: doc.code,
    version: doc.version,
    title: String(doc.title ?? code).slice(0, 200),
    xml: doc.xml,
    target,
    ...(doc.origin === "library" || doc.origin === "chat" ? { origin: doc.origin } : {}),
    ...(typeof doc.library_commit === "string" ? { library_commit: doc.library_commit } : {}),
  });
  return { opened: true, code: doc.code, version: doc.version, target };
}

/** Vykoná žiadosť karty a pošle `REQLIB_RESULT` (aj pri chybe, aby karta neostala čakať). */
export async function runReqlibRequest(req: ReqlibRequest, deps: ReqlibDeps): Promise<void> {
  const reply = (r: { ok: boolean; data?: unknown; error?: string }) => deps.post({ type: "REQLIB_RESULT", id: req.id, ...r });
  try {
    let data: unknown;
    switch (req.action) {
      case "catalog":
        data = await call(deps.fetch, "/api/ids/library");
        break;
      case "assign":
        data = await postJson(deps.fetch, "/api/ids/library", req.payload);
        break;
      case "bind":
        data = await postJson(deps.fetch, "/api/ids/models", req.payload);
        break;
      case "open":
        data = await openIds(req.payload, deps);
        break;
      case "save_run":
        data = await saveRun(req.payload, deps);
        break;
    }
    reply({ ok: true, data });
  } catch (err) {
    reply({ ok: false, error: (err instanceof Error ? err.message : "požiadavka zlyhala").slice(0, 4000) });
  }
}
