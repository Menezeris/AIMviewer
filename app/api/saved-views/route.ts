import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { currentModelRevisions, supabaseSavedViewStore, type SavedViewStore } from "@/lib/views/store";
import { deleteWire, listWires, renameWire, saveWire } from "@/lib/views/wire";
import { isViewWire } from "@/lib/viewer-views";
import { currentProjectId } from "@/lib/live/caller";
import { withRequestProject } from "@/lib/project/request";

/**
 * Views from the Presentation panel (D-161, #188): `saved_views` is a persistent copy of `BasketView` with the same `id`.
 *
 * - `GET` returns the list for `VIEWS_LOAD` (read-only, without a gate).
 * - `POST {view}` creates or overwrites a view (`VIEW_SAVE`), `PATCH {id, name}` renames (`VIEW_RENAME`),
 *   `DELETE {id}` deletes (`VIEW_DELETE`). Writing is called by the host page after a bridge message from the embed viewer and the response
 *   carries the full list (`views`), which the host sends back as `VIEWS_LOAD` (a name collision gets a suffix).
 *
 * Protection as for underlays (D-072): the viewer is public read-only, so writing is behind the env gate, OFF by default
 * (`VIEWS_WRITE_ENABLED=true` turns it on), plus origin guard and per-IP rate limit (D-068). Without
 * login anyone who opens the viewer can change views; an honest conscious limit until auth arrives.
 */

const WRITE_ENABLED = process.env.VIEWS_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(process.env.VIEWS_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 120 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.VIEWS_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

/** Body cap: a view with 5000 GUIDs is around 150 kB. */
const MAX_BODY_CHARS = 1_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

type Fail = NextResponse;

/** Gate, origin guard and rate limit; null = continue. */
function guard(req: Request): Fail | null {
  if (!WRITE_ENABLED) {
    return NextResponse.json({ error: "zápis pohľadov z viewera je vypnutý (VIEWS_WRITE_ENABLED)" }, { status: 403 });
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = limiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek, skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }
  }
  return null;
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | Fail> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  try {
    const body: unknown = JSON.parse(raw);
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // falls through to the error below
  }
  return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
}

const isFail = (v: unknown): v is Fail => v instanceof NextResponse;

async function getHandler() {
  try {
    return NextResponse.json({ views: await listWires(supabaseSavedViewStore(currentProjectId())) }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

/** Write + full list in the response; DB error = 500. */
async function write(run: (store: SavedViewStore) => Promise<Record<string, unknown>>) {
  try {
    const store = supabaseSavedViewStore(currentProjectId());
    const extra = await run(store);
    return NextResponse.json({ ok: true, ...extra, views: await listWires(store) }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "write failed" }, { status: 500 });
  }
}

async function postHandler(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await bodyOf(req);
  if (isFail(body)) return body;
  const view = body.view;
  if (!isViewWire(view) || !UUID_RE.test(view.id)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  return write(async (store) => {
    const revisions = await currentModelRevisions(currentProjectId()).catch(() => ({}));
    return { ...(await saveWire(store, view, revisions)) };
  });
}

async function patchHandler(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await bodyOf(req);
  if (isFail(body)) return body;
  const { id, name } = body;
  if (typeof id !== "string" || !UUID_RE.test(id) || typeof name !== "string" || !name.trim() || name.length > 200) {
    return NextResponse.json({ error: "invalid rename" }, { status: 400 });
  }
  return write(async (store) => ({ ...((await renameWire(store, id, name)) ?? { missing: true }) }));
}

async function deleteHandler(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await bodyOf(req);
  if (isFail(body)) return body;
  const { id } = body;
  if (typeof id !== "string" || !UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  return write(async (store) => {
    await deleteWire(store, id);
    return {};
  });
}

export const GET = withRequestProject<[Request]>(getHandler);
export const POST = withRequestProject(postHandler);
export const PATCH = withRequestProject(patchHandler);
export const DELETE = withRequestProject(deleteHandler);
