import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { handleBcfApi } from "@/lib/bcf/api";
import { defaultBcfDeps } from "@/lib/bcf/runtime";

/**
 * BCF API 2.1 (D-099 fáza B): báza `<site>/api/bcf`. BCF panel viewera sa
 * pripojí cez "Pripojiť server" -> vlastná adresa + token (`BCF_API_TOKEN`).
 * `/versions` a `/2.1/auth` sú bez tokenu (objavenie služby), zvyšok s
 * `Authorization: Bearer`. Bez `BCF_API_TOKEN` je API vypnuté (404).
 * CORS je otvorený: panel beží na doméne viewera a autentifikácia je token,
 * nie cookie.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
};

function configuredToken(): string | null {
  const t = process.env.BCF_API_TOKEN?.trim();
  return t && t.length >= 16 ? t : null;
}

function bearerMatches(header: string | null, expected: string): boolean {
  const m = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const expected = configuredToken();
  if (!expected) return new NextResponse("Not found", { status: 404 });
  const { path } = await ctx.params;
  let body: unknown = null;
  if (req.method === "POST" || req.method === "PUT") {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Telo nie je platný JSON." }, { status: 400, headers: CORS });
    }
  }
  const res = await handleBcfApi(
    { method: req.method, segments: path, query: new URL(req.url).searchParams, body },
    {
      deps: defaultBcfDeps(),
      user: process.env.BCF_API_USER?.trim() || "aim",
      authenticated: bearerMatches(req.headers.get("authorization"), expected),
    },
  );
  return NextResponse.json(res.body, { status: res.status, headers: CORS });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;

export async function OPTIONS(): Promise<Response> {
  if (!configuredToken()) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(null, { status: 204, headers: CORS });
}
