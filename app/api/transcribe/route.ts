import { NextResponse } from "next/server";

import {
  clientIpKey,
  createRateLimiter,
  isCrossOriginBlocked,
} from "@/lib/api-guard";
import { getSttProvider, SttConfigError } from "@/lib/stt/provider";

/**
 * Hlasový prepis pokynov (D-069): klient nahrá diktát (MediaRecorder,
 * webm/opus alebo mp4 zo Safari), server ho prepíše cez STT provider vrstvu
 * (`lib/stt/`) a vráti čistý text — klient ho vloží do chat inputu, používateľ
 * ho skontroluje a odošle sám (dictation pattern, žiadne auto-send).
 */

/** Klient nahráva max 60 s; opus ~200 kB/min, mp4/AAC zo Safari viac — rezerva. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const maxDuration = 30;

// Rovnaká ochrana ako /api/ask (D-068): endpoint prenáša audio na platený/
// kvótovaný STT backend — bez limitu je to vektor na vyčerpanie free tieru.
// Default len v produkcii; override cez TRANSCRIBE_RATE_LIMIT_MAX (0 = vypnuté).
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

export async function POST(req: Request) {
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
  // MediaRecorder typ nesie aj codecs sufix (audio/webm;codecs=opus) — pre STT
  // stačí základný MIME. Prázdny typ = webm (Chrome ho nastavuje vždy, poistka).
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
