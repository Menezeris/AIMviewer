import { NextResponse } from "next/server";

import { clientIpKey, createRateLimiter, isCrossOriginBlocked } from "@/lib/api-guard";
import { checkImportRequest, type ImportRequest } from "@/lib/icdd/import";
import { applyIcddImport, computeImportPreview, ImportConflictError, saveImportPreview } from "@/lib/icdd/import-fetch";

/**
 * Import kontajnera ICDD (D-181 dodatok "import"): `POST /api/icdd/import`.
 * Telo `{action: "preview", request}` = náhľad (dry-run) nad stavom AIM; `{action: "apply", importId, aimStateSha256,
 * request}` = zápis väzieb prvok -> dokument. Kontajner neprichádza (~63 MB), len `ImportRequest` z prehliadača.
 * Zápis (aj uloženie náhľadu do `icdd_imports`) je za env bránou, predvolene VYPNUTOU (`ICDD_IMPORT_ENABLED=true`),
 * k tomu origin guard a per-IP rate limit, rovnako ako `/api/clash` a `/api/ids` (Samuel 1. 11.). Bez brány náhľad
 * beží, ale nič sa neuloží.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WRITE_ENABLED = process.env.ICDD_IMPORT_ENABLED === "true";
const RATE_LIMIT_MAX = Number(process.env.ICDD_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === "production" ? 20 : 0));
const limiter = createRateLimiter({ windowMs: 10 * 60_000, max: RATE_LIMIT_MAX || Number.MAX_SAFE_INTEGER });
const MAX_BODY_CHARS = 4_000_000;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (error: string, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });

export async function POST(req: Request) {
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) return fail("cross-origin request denied", 403);
  const rate = limiter.check(clientIpKey(req.headers));
  if (!rate.allowed) return fail("Priveľa požiadaviek, skús to o chvíľu.", 429, { "Retry-After": String(rate.retryAfterSeconds) });
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return fail("payload too large", 413);
  let body: { action?: string; request?: unknown; importId?: unknown; aimStateSha256?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("invalid JSON", 400);
  }
  const bad = checkImportRequest(body.request);
  if (bad) return fail(`request: ${bad}`, 400);
  const request = body.request as ImportRequest;

  try {
    if (body.action === "preview") {
      const preview = await computeImportPreview(request);
      const importId = WRITE_ENABLED ? await saveImportPreview(request, preview) : null;
      return NextResponse.json({ preview, importId, writeEnabled: WRITE_ENABLED }, { headers: NO_STORE });
    }
    if (body.action === "apply") {
      if (!WRITE_ENABLED) return fail("zápis importu ICDD je vypnutý (ICDD_IMPORT_ENABLED)", 403);
      if (typeof body.importId !== "string" || !UUID_RE.test(body.importId)) return fail("importId: UUID náhľadu", 400);
      if (typeof body.aimStateSha256 !== "string") return fail("aimStateSha256 chýba", 400);
      const r = await applyIcddImport(body.importId, body.aimStateSha256, request);
      return NextResponse.json({ ...r, writeEnabled: true }, { headers: NO_STORE });
    }
    return fail("action: preview | apply", 400);
  } catch (err) {
    if (err instanceof ImportConflictError) return fail(err.message, 409);
    return fail(err instanceof Error ? err.message : "import ICDD zlyhal", 500);
  }
}
