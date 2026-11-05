import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { currentModelRevisions, supabaseSavedViewStore, type SavedViewStore } from "@/lib/views/store";
import { deleteWire, listWires, renameWire, saveWire } from "@/lib/views/wire";
import { isViewWire } from "@/lib/viewer-views";

/**
 * Pohľady z panela Presentation (D-161, #188): `saved_views` je trvalá kópia `BasketView` s tým istým `id`.
 *
 * - `GET` vráti zoznam pre `VIEWS_LOAD` (len čítanie, bez brány).
 * - `POST {view}` vytvorí alebo prepíše pohľad (`VIEW_SAVE`), `PATCH {id, name}` premenuje (`VIEW_RENAME`),
 *   `DELETE {id}` zmaže (`VIEW_DELETE`). Zápis volá host stránka po bridge správe z embed viewera a odpoveď
 *   nesie úplný zoznam (`views`), ktorý host pošle späť ako `VIEWS_LOAD` (kolízia mena dostane príponu).
 *
 * Ochrana ako pri podkladoch (D-072): viewer je verejný read-only, preto je zápis za env bránou, predvolene
 * VYPNUTOU (`VIEWS_WRITE_ENABLED=true` ju zapne), k tomu origin guard a per-IP rate limit (D-068). Bez
 * prihlásenia môže pohľady meniť každý, kto viewer otvorí; poctivý vedomý limit, kým nepríde auth.
 */

const WRITE_ENABLED = process.env.VIEWS_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(process.env.VIEWS_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 120 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.VIEWS_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

/** Strop tela: pohľad s 5000 GUID má okolo 150 kB. */
const MAX_BODY_CHARS = 1_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

type Fail = NextResponse;

/** Brána, origin guard a rate limit; null = pokračuj. */
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
    // padá na chybu nižšie
  }
  return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
}

const isFail = (v: unknown): v is Fail => v instanceof NextResponse;

export async function GET() {
  try {
    return NextResponse.json({ views: await listWires(supabaseSavedViewStore()) }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "list failed" }, { status: 500 });
  }
}

/** Zápis + úplný zoznam v odpovedi; chyba DB = 500. */
async function write(run: (store: SavedViewStore) => Promise<Record<string, unknown>>) {
  try {
    const store = supabaseSavedViewStore();
    const extra = await run(store);
    return NextResponse.json({ ok: true, ...extra, views: await listWires(store) }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "write failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = await bodyOf(req);
  if (isFail(body)) return body;
  const view = body.view;
  if (!isViewWire(view) || !UUID_RE.test(view.id)) return NextResponse.json({ error: "invalid view" }, { status: 400 });
  return write(async (store) => {
    const revisions = await currentModelRevisions().catch(() => ({}));
    return { ...(await saveWire(store, view, revisions)) };
  });
}

export async function PATCH(req: Request) {
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

export async function DELETE(req: Request) {
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
