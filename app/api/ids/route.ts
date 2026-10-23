import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { IdsEngineError } from "@/lib/ids/engine";
import { supabaseIdsStore } from "@/lib/ids/store";
import { conflictDiff, IdsInputError, saveFromViewer, type IdsToolDeps } from "@/lib/ids/tools";
import { IdsConflictError } from "@/lib/ids/types";
import { MAX_IDS_XML, parseIdsSave } from "@/lib/viewer-ids";

/**
 * IDS z AIM pre viewer (D-162, #285).
 *
 * - `GET` bez brány (len čítanie, ako BCF API): bez parametrov zoznam IDS, `?code=<kód>[&version=<n>]` posledná alebo
 *   danej verzie s XML (z toho klient hosta skladá `IDS_LOAD`), s `&format=ids` XML ako súbor na stiahnutie.
 * - `POST {xml, code?, base_version?, title?}` uloží IDS z panela viewera (`IDS_SAVE`) ako novú verziu so
 *   `source='viewer'`. Bez `code` vznikne nové pracovné IDS, knižničná snímka sa neprepíše (uloží sa ako kópia).
 *   Konflikt (`base_version` nie je posledná) je 409 s `latest_version` a `diff` zmien v AIM.
 *
 * Ochrana ako pri pohľadoch a podkladoch (D-161, D-072): viewer je verejný read-only, preto je zápis za env
 * bránou, predvolene VYPNUTOU (`IDS_WRITE_ENABLED=true` ju zapne), k tomu origin guard a per-IP rate limit
 * (D-068). Bez prihlásenia môže IDS ukladať každý, kto viewer otvorí; poctivý vedomý limit, kým nepríde auth.
 */

export const dynamic = "force-dynamic";
/** Audit a čítanie XML idú cez motor `@ifc-lite/mcp` (relácia bez modelov). */
export const maxDuration = 60;

const WRITE_ENABLED = process.env.IDS_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(process.env.IDS_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 60 : 0));
const RATE_LIMIT_WINDOW_MS = Number(process.env.IDS_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000);
const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });

const MAX_BODY_CHARS = MAX_IDS_XML + 10_000;
const NO_STORE = { "Cache-Control": "no-store" };

type Fail = NextResponse;

function guard(req: Request): Fail | null {
  if (!WRITE_ENABLED) {
    return NextResponse.json({ error: "ukladanie IDS z viewera je vypnuté (IDS_WRITE_ENABLED), ulož ho v chate" }, { status: 403 });
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

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  try {
    const store = supabaseIdsStore();
    if (!code) {
      const docs = await store.listDocuments();
      const latest = await store.latestVersions(docs.map((d) => d.id));
      return NextResponse.json(
        { items: docs.map((d) => ({ code: d.code, title: d.title, origin: d.origin, status: d.status, version: latest.get(d.id)?.version ?? null, updated_at: d.updated_at })) },
        { headers: NO_STORE },
      );
    }
    const doc = await store.byCode(code);
    if (!doc) return fail(`IDS '${code}' neexistuje`, 404);
    const raw = params.get("version");
    const version = raw === null ? undefined : Number(raw);
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) return fail("version: celé číslo od 1", 400);
    const row = await store.version(doc.id, version);
    if (!row) return fail(`IDS '${code}' nemá ${version === undefined ? "žiadnu verziu" : `verziu ${version}`}`, 404);
    if (params.get("format") === "ids") {
      return new NextResponse(row.xml, {
        headers: {
          ...NO_STORE,
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${doc.code}-v${row.version}.ids"`,
        },
      });
    }
    return NextResponse.json(
      { code: doc.code, title: doc.title, origin: doc.origin, version: row.version, sha256: row.sha256, xml: row.xml },
      { headers: NO_STORE },
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : "čítanie IDS zlyhalo", 500);
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
  const save = parseIdsSave(body);
  if (!save) return fail("invalid IDS payload", 400);
  const deps: IdsToolDeps = { store: supabaseIdsStore() };
  try {
    const out = await saveFromViewer(deps, {
      xml: save.xml,
      ...(save.code ? { code: save.code } : {}),
      ...(save.base_version ? { base_version: save.base_version } : {}),
      ...(save.title ? { title: save.title } : {}),
    });
    return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof IdsConflictError) {
      const diff = save.code ? await conflictDiff(deps, save.code, err.base, err.latest).catch(() => null) : null;
      return fail(err.message, 409, { latest_version: err.latest, ...(diff ? { diff } : {}) });
    }
    if (err instanceof IdsEngineError) return fail(err.message, 400, { ...(err.code ? { code: err.code } : {}) });
    if (err instanceof IdsInputError) return fail(err.message, 400);
    return fail(err instanceof Error ? err.message : "uloženie IDS zlyhalo", 500);
  }
}
