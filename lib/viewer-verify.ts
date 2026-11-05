/**
 * Verification of quantities in the viewer (D-185 UI): bridge for the checkmarks in the properties panel and the ribbon AIM > Overovanie (Verification).
 * Pattern of `REQLIB_REQUEST` (D-182, `lib/viewer-reqlib.ts`), the data shape is binding in the fork `aim/verify-protocol.ts`.
 *
 * Viewer -> host `VERIFY_REQUEST {id, action, payload}`, host -> viewer `VERIFY_RESULT {id, ok, data?, error?}`:
 *  - `latest`  {global_id} -> `GET /api/verify/latest` (`VerifyElementWire | null`);
 *  - `run`     {global_id} -> `POST /api/verify/run` (verifies and saves against the revision);
 *  - `run_all` {check}     -> `POST /api/verify/run_all` (all IfcSpace, summary); only one at a time from one card.
 */

export const VERIFY_ACTIONS = ["latest", "run", "run_all"] as const;
export type VerifyAction = (typeof VERIFY_ACTIONS)[number];

export interface VerifyRequest {
  id: string;
  action: VerifyAction;
  payload: { global_id?: string; check?: string };
}

const GUID_RE = /^[0-9A-Za-z_$]{22}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseVerifyRequest(raw: unknown): VerifyRequest | null {
  if (!isObj(raw) || raw.type !== "VERIFY_REQUEST") return null;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > 100) return null;
  if (!(VERIFY_ACTIONS as readonly string[]).includes(raw.action as string)) return null;
  const p = isObj(raw.payload) ? raw.payload : {};
  const payload: VerifyRequest["payload"] = {};
  if (typeof p.global_id === "string") payload.global_id = p.global_id;
  if (typeof p.check === "string") payload.check = p.check.slice(0, 100);
  return { id: raw.id, action: raw.action as VerifyAction, payload };
}

export interface VerifyDeps {
  fetch: typeof fetch;
  /** Message to the viewer (the host fills in `source`). */
  post: (msg: Record<string, unknown>) => void;
  /** State "run_all is running" for this card (a second run is rejected without calling the server). */
  runAll: { busy: boolean };
}

async function call(f: typeof fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await f(url, { cache: "no-store", ...init });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${r.status}`);
  return body;
}

const postJson = (f: typeof fetch, url: string, body: unknown) =>
  call(f, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function guidOf(req: VerifyRequest): string {
  const g = req.payload.global_id ?? "";
  if (!GUID_RE.test(g)) throw new Error("Prvok nemá platné IFC GlobalId.");
  return g;
}

/** Executes the request and sends `VERIFY_RESULT` (also on error, so the viewer does not wait until the limit). */
export async function runVerifyRequest(req: VerifyRequest, deps: VerifyDeps): Promise<void> {
  const reply = (r: { ok: boolean; data?: unknown; error?: string }) => deps.post({ type: "VERIFY_RESULT", id: req.id, ...r });
  try {
    let data: unknown;
    switch (req.action) {
      case "latest":
        data = (await call(deps.fetch, `/api/verify/latest?global_id=${encodeURIComponent(guidOf(req))}`)).data ?? null;
        break;
      case "run":
        data = (await postJson(deps.fetch, "/api/verify/run", { global_id: guidOf(req) })).data;
        break;
      case "run_all":
        if (deps.runAll.busy) throw new Error("overenie už beží");
        deps.runAll.busy = true;
        try {
          data = (await postJson(deps.fetch, "/api/verify/run_all", { check: req.payload.check })).data;
        } finally {
          deps.runAll.busy = false;
        }
        break;
    }
    reply({ ok: true, data });
  } catch (err) {
    reply({ ok: false, error: (err instanceof Error ? err.message : "overenie zlyhalo").slice(0, 4000) });
  }
}
