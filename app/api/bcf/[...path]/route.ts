import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { clientIpKey } from "@/lib/api-guard";
import { LEGACY_PROJECT_ID, handleBcfApi } from "@/lib/bcf/api";
import { currentProject } from "@/lib/live/caller";
import { defaultBcfDeps } from "@/lib/bcf/runtime";
import { snapshotFor } from "@/lib/bcf/snapshot-http";
import { withRequestAuth } from "@/lib/auth/request";
import { withRequestProject } from "@/lib/project/request";

/**
 * BCF API 2.1 (D-099): base `<site>/api/bcf`. Reading is without a token - the viewer
 * loads the topics itself via the bridge (`AIM_BCF_LOAD`, addendum to D-099), as publicly
 * as the other AIM data. Writing (POST/PUT) only with `Authorization: Bearer
 * <BCF_API_TOKEN>`; without this env the API is read-only and topics are created in
 * chat. CORS is open: the viewer runs on another domain and writing is protected by a token,
 * not a cookie.
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
      // Snapshot of a document crop (D-158 step 3), rendered on demand with a cache in the bucket.
      snapshot: (r) => snapshotFor(r, clientIpKey(req.headers)),
      project: { code: currentProject().code, name: currentProject().name },
    },
  );
  if (res.binary) {
    // The snapshot for the same link changes only with the document revision: one hour from the browser cache.
    return new Response(new Uint8Array(res.binary.bytes), {
      status: res.status,
      headers: { ...CORS, ...res.binary.headers, "Cache-Control": "public, max-age=3600" },
    });
  }
  return NextResponse.json(res.body, { status: res.status, headers: CORS });
}

/**
 * D-189: the viewer calls the API cross-origin without cookies, so the project is the BCF project
 * in the path (`/2.1/projects/<code>/...`); the legacy `aim` and paths without a project fall back to
 * `?project=`, the cookie and the default.
 */
async function bcfProjectCode(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<string | null> {
  const { path } = await ctx.params;
  const code = path[1] === "projects" ? path[2] : undefined;
  return code && code !== LEGACY_PROJECT_ID ? code : null;
}

export const GET = withRequestAuth(withRequestProject(handle, { code: bcfProjectCode }), { source: "app:/api/bcf", write: false });
export const POST = withRequestAuth(withRequestProject(handle, { code: bcfProjectCode }), { source: "app:/api/bcf", write: true });
export const PUT = withRequestAuth(withRequestProject(handle, { code: bcfProjectCode }), { source: "app:/api/bcf", write: true });

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, { status: 204, headers: CORS });
}
