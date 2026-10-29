import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { supabaseClashStore } from "@/lib/clash/store";
import { ClashViewerError, listForViewer, loadForViewer, saveFromViewer } from "@/lib/clash/viewer";
import { CLASH_UUID_RE, parseClashSave } from "@/lib/viewer-clash";

/**
 * Clash detection z AIM pre viewer (D-164, #292).
 *
 * - `GET` bez brány (len čítanie, ako BCF API): bez parametrov zoznam testov s posledným behom, `?test=<kód>`
 *   test, s `&run=latest|<UUID>` aj uložený beh s kolíziami a ich stavom (z toho klient hosta skladá `CLASH_LOAD`).
 * - `POST` uloží z panela clash (`CLASH_SAVE`) test, beh a/alebo stav kolízií; beh má `trigger='viewer'`.
 *   Test vyhráva posledným zápisom, predvolený test sa neprepisuje, stav kolízií sa píše po kolíziách.
 *
 * Ochrana ako pri pohľadoch, podkladoch a IDS (D-161, D-162, D-072): viewer je verejný read-only, preto je zápis za
 * env bránou, predvolene VYPNUTOU (`CLASH_WRITE_ENABLED=true` ju zapne), k tomu origin guard a per-IP rate limit
 * (D-068). Bez prihlásenia môže ukladať každý, kto viewer otvorí; vedomý limit, kým nepríde auth.
 */

export const dynamic = "force-dynamic";

const WRITE_ENABLED = process.env.CLASH_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(process.env.CLASH_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.CLASH_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

/** Beh s 10 000 kolíziami (~300 B na riadok) + stavy; nad Vercel limit 4,5 MB beh neprejde. */
const MAX_BODY_CHARS = 4_000_000;
const NO_STORE = { "Cache-Control": "no-store" };

function guard(req: Request): NextResponse | null {
  if (!WRITE_ENABLED) {
    return NextResponse.json({ error: "ukladanie kolízií z viewera je vypnuté (CLASH_WRITE_ENABLED), ulož ich v chate" }, { status: 403 });
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

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const test = params.get("test");
  const run = params.get("run") ?? undefined;
  if (run !== undefined && run !== "latest" && !CLASH_UUID_RE.test(run)) return fail("run: 'latest' alebo UUID uloženého behu", 400);
  try {
    const store = supabaseClashStore();
    if (!test) return NextResponse.json({ items: await listForViewer(store) }, { headers: NO_STORE });
    return NextResponse.json(await loadForViewer(store, { test, ...(run ? { run } : {}) }), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ClashViewerError) return fail(err.message, 404);
    return fail(err instanceof Error ? err.message : "čítanie kolízií zlyhalo", 500);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return fail("payload too large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("invalid JSON", 400);
  }
  const save = parseClashSave(body);
  if (!save) return fail("invalid clash payload", 400);
  try {
    return NextResponse.json(await saveFromViewer(supabaseClashStore(), save), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ClashViewerError) return fail(err.message, 400);
    return fail(err instanceof Error ? err.message : "uloženie kolízií zlyhalo", 500);
  }
}
