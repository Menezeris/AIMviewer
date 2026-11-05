import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter } from "@/lib/api-guard";
import { importBcfArchive, type ConflictPolicy } from "@/lib/bcf/import";
import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { BcfInputError } from "@/lib/bcf/tools";

/**
 * Import `.bcfzip` (BCF 2.1 aj 3.0) do DB (D-158 krok 8): `POST /api/bcf/import`, telo = súbor
 * (application/zip), `Authorization: Bearer <BCF_API_TOKEN>` ako zápis BCF API. Query: `dry_run=1`,
 * `conflict=keep|overwrite`, `model`, `guids=a,b`. Odpoveď je súhrn ako pri `bcf_topic action=import`.
 * Telo je najviac ~4,4 MB (limit funkcie na Verceli); väčší súbor ide cez tool (`url` do úložiska).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 4_400_000;
const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: 20 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
};

function bearerMatches(header: string | null, expected: string | null): boolean {
  if (!expected) return false;
  const m = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const fail = (status: number, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json({ message }, { status, headers: { ...CORS, ...headers } });

export async function POST(req: Request): Promise<Response> {
  const token = process.env.BCF_API_TOKEN?.trim();
  const expected = token && token.length >= 16 ? token : null;
  if (!expected) return fail(403, "Import cez API je vypnutý (bez BCF_API_TOKEN); použi bcf_topic action=import v chate.");
  if (!bearerMatches(req.headers.get("authorization"), expected)) return fail(401, "Import potrebuje token (Authorization: Bearer).");
  const rate = limiter.check(clientIpKey(req.headers));
  if (!rate.allowed) return fail(429, "Príliš veľa importov, skús neskôr.", { "Retry-After": String(rate.retryAfterSeconds) });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) return fail(413, "Súbor je príliš veľký pre priamy import; nahraj ho do úložiska a použi bcf_topic action=import s url.");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY) return fail(413, "Súbor je príliš veľký pre priamy import; nahraj ho do úložiska a použi bcf_topic action=import s url.");
  const q = new URL(req.url).searchParams;
  const conflict = q.get("conflict") ?? "keep";
  if (conflict !== "keep" && conflict !== "overwrite") return fail(400, "conflict: keep | overwrite.");
  try {
    const summary = await importBcfArchive(bytes, defaultBcfDeps(), {
      dryRun: q.get("dry_run") === "1" || q.get("dry_run") === "true",
      conflict: conflict as ConflictPolicy,
      model: q.get("model")?.trim() || null,
      author: process.env.BCF_API_USER?.trim() || "aim",
      guids: q.get("guids")?.split(",").map((g) => g.trim()).filter(Boolean),
    });
    if (!summary.dry_run) await defaultBcfDeps().notify?.().catch(() => undefined);
    return NextResponse.json(summary, { status: 200, headers: CORS });
  } catch (e) {
    if (e instanceof BcfInputError) return fail(400, e.message);
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, { status: 204, headers: CORS });
}
