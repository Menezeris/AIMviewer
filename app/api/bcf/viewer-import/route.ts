import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { importBcfArchive } from "@/lib/bcf/import";
import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { BcfInputError } from "@/lib/bcf/tools";
import { BCF_VIEWER_IMPORT_MAX_BYTES, summaryToWire } from "@/lib/viewer-bcf-import";

/**
 * Import `.bcfzip` z BCF panela viewera (D-158 krok 8, dodatok 1. 11.): `POST /api/bcf/viewer-import`,
 * telo = súbor (application/zip), query `dry_run=1`. Bez tokenu, ako ostatné zápisy z viewera
 * (`/api/clash`, `/api/ids`): env brána predvolene VYPNUTÁ (`BCF_VIEWER_IMPORT_ENABLED=true` ju zapne),
 * origin guard a per-IP rate limit. Konflikty sa pri zápise ponechajú (`conflict=keep`).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: 20 });

const fail = (status: number, error: string, headers: Record<string, string> = {}) =>
  NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(req: Request): Promise<Response> {
  if (process.env.BCF_VIEWER_IMPORT_ENABLED !== "true") {
    return fail(403, "Import BCF z viewera je vypnutý (BCF_VIEWER_IMPORT_ENABLED); importuj súbor v chate (bcf_topic action=import).");
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) return fail(403, "cross-origin request denied");
  const rate = limiter.check(clientIpKey(req.headers));
  if (!rate.allowed) return fail(429, "Príliš veľa importov, skús neskôr.", { "Retry-After": String(rate.retryAfterSeconds) });
  const tooBig = "Súbor je príliš veľký, importuj ho v chate (bcf_topic action=import).";
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BCF_VIEWER_IMPORT_MAX_BYTES) return fail(413, tooBig);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return fail(400, "Prázdny súbor.");
  if (bytes.byteLength > BCF_VIEWER_IMPORT_MAX_BYTES) return fail(413, tooBig);
  const q = new URL(req.url).searchParams;
  const dryRun = q.get("dry_run") === "1" || q.get("dry_run") === "true";
  try {
    const deps = defaultBcfDeps();
    const summary = await importBcfArchive(bytes, deps, { dryRun, conflict: "keep", author: process.env.BCF_API_USER?.trim() || "aim" });
    if (!summary.dry_run) await deps.notify?.().catch(() => undefined);
    return NextResponse.json({ ok: true, summary: summaryToWire(summary as unknown as Record<string, unknown>) }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof BcfInputError) return fail(400, e.message);
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}
