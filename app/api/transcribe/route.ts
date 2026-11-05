import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import { getSttProvider, SttConfigError } from "@/lib/stt/provider";
import { withRequestProject } from "@/lib/project/request";

/**
 * Voice transcription of instructions (D-069): the client uploads dictation (MediaRecorder,
 * webm/opus or mp4 from Safari), the server transcribes it via the STT provider layer
 * (`lib/stt/`) and returns plain text - the client puts it into the chat input, the user
 * checks it and sends it themselves (dictation pattern, no auto-send).
 */

/** The client records at most 60 s; opus ~200 kB/min, mp4/AAC from Safari more - reserve. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const maxDuration = 30;

// The same protection as /api/ask (D-068): the endpoint passes audio to a paid/
// quota-limited STT backend - without a limit it is a vector for exhausting the free tier.
// Default only in production; override via TRANSCRIBE_RATE_LIMIT_MAX (0 = off).
const RATE_LIMIT_MAX = Number(
  process.env.TRANSCRIBE_RATE_LIMIT_MAX ??
    (process.env.NODE_ENV === "production" ? 30 : 0)
);
const RATE_LIMIT_WINDOW_MS = Number(
  process.env.TRANSCRIBE_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000
);
const transcribeLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
});

async function postHandler(req: Request) {
  if (isCrossOriginBlocked(req.headers.get("origin"), req.headers.get("host"))) {
    return NextResponse.json({ error: "cross-origin request denied" }, { status: 403 });
  }

  if (RATE_LIMIT_MAX > 0) {
    const rate = transcribeLimiter.check(clientIpKey(req.headers));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Priveľa požiadaviek — skús to o chvíľu." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "chýba audio nahrávka" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "nahrávka je príliš veľká" }, { status: 413 });
  }
  // The MediaRecorder type also carries a codecs suffix (audio/webm;codecs=opus) - for STT
  // the base MIME is enough. Empty type = webm (Chrome always sets it, safeguard).
  const mimeType = (audio.type.split(";")[0] || "audio/webm").trim();
  if (!mimeType.startsWith("audio/")) {
    return NextResponse.json({ error: "nepodporovaný formát nahrávky" }, { status: 415 });
  }

  let provider;
  try {
    provider = await getSttProvider();
  } catch (err) {
    if (err instanceof SttConfigError) {
      return NextResponse.json({ error: err.message, configured: false }, { status: 503 });
    }
    throw err;
  }

  try {
    const text = await provider.transcribe({
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType,
    });
    return NextResponse.json({ text, provider: provider.id });
  } catch (err) {
    console.error("[api/transcribe]", err);
    return NextResponse.json(
      { error: "Prepis nahrávky zlyhal. Skús to znova." },
      { status: 500 }
    );
  }
}

export const POST = withRequestProject(postHandler);
