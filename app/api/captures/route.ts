import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import {
  createCapturePoint,
  fetchCapturesForDocument,
  fetchCapturesForSpace,
  isValidCaptureV1,
  spaceExists,
  type CaptureKind,
} from "@/lib/data/captures";

/**
 * Reality Capture (D-073) — capture point endpoint.
 *
 * `GET  /api/captures?space=<objects.id>` — captures naviazané na priestor
 *   (obojsmerné čítanie „fotky priestoru"). Read-only, server-side (D-026).
 * `POST /api/captures` — vytvor capture point (objects+captures riadok, `_capture`
 *   placement, hrana na IfcSpace). Za env bránou `CAPTURE_WRITE_ENABLED` (default
 *   VYPNUTÝ) + origin guard + per-IP rate limit (vzor D-068/D-072). Snímka sa
 *   následne nahrá cez `POST /api/captures/{id}/media`.
 */

const WRITE_ENABLED = process.env.CAPTURE_WRITE_ENABLED === "true";

const RATE_LIMIT_MAX = Number(
  process.env.CAPTURE_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.CAPTURE_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const captureLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KINDS: CaptureKind[] = ["photo", "pano360"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const space = url.searchParams.get("space");
  const document = url.searchParams.get("document");
  try {
    if (space) {
      if (!UUID_RE.test(space)) {
        return NextResponse.json({ error: "invalid space id" }, { status: 400 });
      }
      const captures = await fetchCapturesForSpace(space);
      return NextResponse.json(
        { captures },
        { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } }
      );
    }
    if (document) {
      if (!UUID_RE.test(document)) {
        return NextResponse.json({ error: "invalid document id" }, { status: 400 });
      }
      const pins = await fetchCapturesForDocument(document);
      return NextResponse.json(
        { pins },
        { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } }
      );
    }
    return NextResponse.json({ error: "missing space or document" }, { status: 400 });
  } catch (err) {
    console.error("[api/captures GET]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!WRITE_ENABLED) {
    return NextResponse.json(
      { error: "zápis captures je vypnutý (CAPTURE_WRITE_ENABLED)" },
      { status: 403 }
    );
  }
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }
  if (RATE_LIMIT_MAX > 0) {
    const rate = captureLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const kind = b.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as CaptureKind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const spaceId = b.spaceId;
  if (typeof spaceId !== "string" || !UUID_RE.test(spaceId)) {
    return NextResponse.json({ error: "invalid spaceId" }, { status: 400 });
  }
  if (!isValidCaptureV1(b.placement)) {
    return NextResponse.json({ error: "invalid _capture payload" }, { status: 400 });
  }
  // Plán-pin dokument (ak je) musí byť UUID; existenciu neblokujeme (drawing sa
  // môže doplniť neskôr), ale tvar strážime.
  if (b.placement.plan && !UUID_RE.test(b.placement.plan.documentId)) {
    return NextResponse.json({ error: "invalid plan.documentId" }, { status: 400 });
  }
  const name =
    typeof b.name === "string" && b.name.trim().length > 0 ? b.name.trim() : null;
  const source =
    typeof b.source === "string" && b.source.trim().length > 0 ? b.source.trim() : null;

  try {
    if (!(await spaceExists(spaceId))) {
      return NextResponse.json({ error: "space not found" }, { status: 404 });
    }
    const id = await createCapturePoint({
      kind: kind as CaptureKind,
      name,
      spaceId,
      placement: b.placement,
      source,
    });
    revalidateTag("aim", { expire: 0 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("[api/captures POST]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
