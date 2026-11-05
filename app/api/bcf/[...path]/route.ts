import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { clientIpKey } from "@/lib/api-guard";
import { handleBcfApi } from "@/lib/bcf/api";
import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { snapshotFor } from "@/lib/bcf/snapshot-http";

/**
 * BCF API 2.1 (D-099): báza `<site>/api/bcf`. Čítanie je bez tokenu - viewer
 * si témy načíta sám cez most (`AIM_BCF_LOAD`, dodatok D-099), rovnako
 * verejne ako ostatné dáta AIM. Zápis (POST/PUT) len s `Authorization: Bearer
 * <BCF_API_TOKEN>`; bez tejto env je API len na čítanie a témy sa zakladajú v
 * chate. CORS je otvorený: viewer beží na inej doméne a zápis chráni token,
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

function bearerMatches(header: string | null, expected: string | null): boolean {
  if (!expected) return false;
  const m = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const expected = configuredToken();
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
      writeEnabled: expected !== null,
      origin: new URL(req.url).origin,
      // Snímka výrezu dokumentu (D-158 krok 3), render na požiadanie s keš v buckete.
      snapshot: (r) => snapshotFor(r, clientIpKey(req.headers)),
    },
  );
  if (res.binary) {
    // Snímka sa pre ten istý odkaz mení len s revíziou dokumentu: hodinu z keše prehliadača.
    return new Response(new Uint8Array(res.binary.bytes), {
      status: res.status,
      headers: { ...CORS, ...res.binary.headers, "Cache-Control": "public, max-age=3600" },
    });
  }
  return NextResponse.json(res.body, { status: res.status, headers: CORS });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, { status: 204, headers: CORS });
}
