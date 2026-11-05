import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { supabaseClashStore } from "@/lib/clash/store";
import { ClashViewerError, listForViewer, loadForViewer, saveFromViewer } from "@/lib/clash/viewer";
import { CLASH_UUID_RE, parseClashSave } from "@/lib/viewer-clash";
import { withRequestProject } from "@/lib/project/request";
import { currentProjectId } from "@/lib/live/caller";

/**
 * Clash detection z AIM pre viewer (D-164, #292).
 *
 * - `GET` without the gate (read-only, like BCF API): without parameters a list of tests with the latest run, `?test=<code>`
 *   a test, with `&run=latest|<UUID>` also the saved run with collisions and their state (the host client builds `CLASH_LOAD` from it).
 * - `POST` saves from the clash panel (`CLASH_SAVE`) a test, run and/or collision state; the run has `trigger='viewer'`.
 *   The test wins by the last write, the default test is not overwritten, the collision state is written after the collisions.
 *
 * Protection as for views, underlays and IDS (D-161, D-162, D-072): the viewer is public read-only, so writing is behind
 * the env gate, OFF by default (`CLASH_WRITE_ENABLED=true` turns it on), plus origin guard and per-IP rate limit
 * (D-068). Without login anyone who opens the viewer can save; a conscious limit until auth arrives.
 */

export const dynamic = "force-dynamic";

const WRITE_ENABLED = process.env.CLASH_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(process.env.CLASH_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.CLASH_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

/** A run with 10,000 collisions (~300 B per row) + states; above the Vercel 4.5 MB limit the run will not pass. */
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

async function getHandler(req: Request) {
  const params = new URL(req.url).searchParams;
  const test = params.get("test");
  const run = params.get("run") ?? undefined;
  if (run !== undefined && run !== "latest" && !CLASH_UUID_RE.test(run)) return fail("run: 'latest' alebo UUID uloženého behu", 400);
  try {
    const store = supabaseClashStore(currentProjectId());
    if (!test) return NextResponse.json({ items: await listForViewer(store) }, { headers: NO_STORE });
    return NextResponse.json(await loadForViewer(store, { test, ...(run ? { run } : {}) }), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ClashViewerError) return fail(err.message, 404);
    return fail(err instanceof Error ? err.message : "čítanie kolízií zlyhalo", 500);
  }
}

async function postHandler(req: Request) {
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
    return NextResponse.json(await saveFromViewer(supabaseClashStore(currentProjectId()), save), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ClashViewerError) return fail(err.message, 400);
    return fail(err instanceof Error ? err.message : "uloženie kolízií zlyhalo", 500);
  }
}

export const GET = withRequestProject(getHandler);
export const POST = withRequestProject(postHandler);
