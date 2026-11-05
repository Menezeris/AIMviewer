import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import {
  addCaptureMedia,
  getCaptureKind,
  uploadCaptureObject,
} from "@/lib/data/captures";

/**
 * Reality Capture (D-073) — upload snímky/verzie k capture pointu.
 *
 * `POST /api/captures/{id}/media` — multipart (`file`, voliteľne `capturedAt`).
 * Server-side `sharp` vygeneruje `preview` (rýchle načítanie; 360 downscale pod
 * GPU limit ~8K mobil / 16K desktop) + `thumb`, nahrá orig/preview/thumb do
 * bucket `captures` a založí `capture_media` riadok + hranu (append-only).
 *
 * Za env bránou `CAPTURE_WRITE_ENABLED` (default VYPNUTÝ) + origin guard + per-IP
 * rate limit (vzor D-068/D-072). sharp vyžaduje Node runtime.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const WRITE_ENABLED = process.env.CAPTURE_WRITE_ENABLED === "true";

/** 360° panorámy bývajú veľké (16K equirect ~ desiatky MB); rezerva 64 MB. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Equirectangular preview širka (2:1 → 4096×2048) — pod GPU limitom aj na mobile. */
const PANO_PREVIEW_WIDTH = 4096;
const PHOTO_PREVIEW_MAX = 2048;
const PANO_THUMB_WIDTH = 1024;
const PHOTO_THUMB_MAX = 512;
/** Tolerancia pomeru strán pre equirect (ideál 2:1). */
const PANO_ASPECT_TOLERANCE = 0.1;

const RATE_LIMIT_MAX = Number(
  process.env.CAPTURE_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.CAPTURE_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const mediaLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const rate = mediaLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  const { id: captureId } = await params;
  if (!UUID_RE.test(captureId)) {
    return NextResponse.json({ error: "invalid capture id" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "chýba súbor" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "súbor je príliš veľký" }, { status: 413 });
  }
  const mime = (file.type.split(";")[0] || "").trim();
  const ext = EXT_BY_MIME[mime];
  if (!ext) {
    return NextResponse.json({ error: "nepodporovaný formát (jpg/png/webp)" }, { status: 415 });
  }

  const capturedAtRaw = form.get("capturedAt");
  let capturedAt: string | null = null;
  if (typeof capturedAtRaw === "string" && capturedAtRaw.length > 0) {
    const d = new Date(capturedAtRaw);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "invalid capturedAt" }, { status: 400 });
    }
    capturedAt = d.toISOString();
  }

  try {
    const kind = await getCaptureKind(captureId);
    if (!kind) return NextResponse.json({ error: "capture not found" }, { status: 404 });

    const input = Buffer.from(await file.arrayBuffer());

    // Rozmery originálu s ohľadom na EXIF orientáciu.
    const meta = await sharp(input).metadata();
    let origW = meta.width ?? 0;
    let origH = meta.height ?? 0;
    if ((meta.orientation ?? 1) >= 5) [origW, origH] = [origH, origW];
    if (origW <= 0 || origH <= 0) {
      return NextResponse.json({ error: "obrázok sa nepodarilo prečítať" }, { status: 422 });
    }
    if (kind === "pano360" && Math.abs(origW / origH - 2) > PANO_ASPECT_TOLERANCE) {
      return NextResponse.json(
        { error: "360° panoráma musí byť equirectangular (pomer strán 2:1)" },
        { status: 422 }
      );
    }

    // preview + thumb (sharp .rotate() zapečie EXIF orientáciu).
    const preview = await sharp(input)
      .rotate()
      .resize(
        kind === "pano360"
          ? { width: PANO_PREVIEW_WIDTH, withoutEnlargement: true }
          : { width: PHOTO_PREVIEW_MAX, height: PHOTO_PREVIEW_MAX, fit: "inside", withoutEnlargement: true }
      )
      .jpeg({ quality: 82 })
      .toBuffer();
    const thumb = await sharp(input)
      .rotate()
      .resize(
        kind === "pano360"
          ? { width: PANO_THUMB_WIDTH, withoutEnlargement: true }
          : { width: PHOTO_THUMB_MAX, height: PHOTO_THUMB_MAX, fit: "inside", withoutEnlargement: true }
      )
      .jpeg({ quality: 75 })
      .toBuffer();

    const base = `${captureId}/${crypto.randomUUID()}`;
    const [location, previewLocation, thumbLocation] = await Promise.all([
      uploadCaptureObject(`${base}_orig.${ext}`, input, mime),
      uploadCaptureObject(`${base}_preview.jpg`, preview, "image/jpeg"),
      uploadCaptureObject(`${base}_thumb.jpg`, thumb, "image/jpeg"),
    ]);

    const mediaId = await addCaptureMedia(captureId, {
      location,
      previewLocation,
      thumbLocation,
      mediaType: mime,
      width: origW,
      height: origH,
      capturedAt,
    });

    revalidateTag("aim", { expire: 0 });
    return NextResponse.json({ id: mediaId, location, previewLocation, thumbLocation }, { status: 201 });
  } catch (err) {
    console.error("[api/captures/[id]/media]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
