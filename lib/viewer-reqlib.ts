/**
 * Requirements library in the viewer (D-182, #351): bridge for the "Requirements library" card and saving the check result.
 *
 * Viewer -> host `REQLIB_REQUEST {id, action, payload}`, host -> viewer `REQLIB_RESULT {id, ok, data?, error?}`:
 *  - `catalog`  -> `GET /api/ids/library`;
 *  - `assign`   -> `POST /api/ids/library` ("Priradiť k projektu", assign to project);
 *  - `bind`     -> `POST /api/ids/models` (manual binding of IDS to a model);
 *  - `open`     -> `GET /api/ids?code&version` and the existing `IDS_LOAD` with origin (`origin`, `library_commit`);
 *  - `save_run` -> `POST /api/ids/runs` for each model of the run: the host fills in the revision from the model the viewer loaded
 *    (the check runs once, in the viewer; the server does not repeat it).
 * Writes are behind `IDS_WRITE_ENABLED` in the routes; here requests and responses are only composed.
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

/** Last URL path segment without query (how the viewer names a model on auto-load). */
const urlFile = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "");

/**
 * Run model from the viewer -> model key in AIM and the revision the viewer really loaded (from the URL the host gave it).
 * The viewer names the model after the file (`ASR.ifc`, for an archive `v079.ifc.gz`); with several matches nothing (better
 * not to save than to assign a wrong revision).
 */
export function resolveRunModel(models: readonly IfcModel[], viewer: { model_id?: unknown; model_name?: unknown }): { model: string; revision: number | null } | null {
  const names = [viewer.model_name, viewer.model_id].filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().toLowerCase());
  const hits = models.filter((m) => {
    const file = urlFile(m.url).toLowerCase();
    const key = (modelKey(m.url) ?? "").toLowerCase();
    return names.some((n) => n === file || n === key || n === m.id.toLowerCase() || n === m.label.toLowerCase());
  });
  if (hits.length !== 1) return null;
  // Models from the DB carry their code (D-190: the file may be named by the container uuid).
  const key = hits[0].containerId ? hits[0].id : modelKey(hits[0].url);
  return key ? { model: key, revision: hits[0].revision ?? null } : null;
}

type Fetch = typeof fetch;

export interface ReqlibDeps {
  fetch: Fetch;
  /** Models the host gave the viewer (with revision). */
  models: readonly IfcModel[];
  /** Message to the viewer (the host fills in `source`). */
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

/** Executes the card request and sends `REQLIB_RESULT` (also on error, so the card does not keep waiting). */
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
