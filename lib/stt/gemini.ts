import "server-only";

import { SttConfigError, type SttProvider, type SttRequest } from "./provider";

/**
  * Gemini as STT (D-069) - `generateContent` accepts audio natively
  * (`inline_data`), so transcription runs on the existing `GEMINI_API_KEY`
  * (the free tier covers the demo) without a new service or account. Pattern of `lib/llm/gemini.ts`:
  * plain `fetch` without an SDK, retry on free-tier overload (429/503).
 */

const DEFAULT_MODEL = "gemini-flash-lite-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Retry on free-tier overload/rate-limit (429/503) - pauses in ms. */
const RETRY_DELAYS_MS = [1500, 3000];
/** A transcript of 60 s of dictation has on the order of hundreds of tokens; a margin for diacritics. */
const MAX_OUTPUT_TOKENS = 1024;

/**
  * The domain vocabulary in the prompt steers the model to expert terminology and the shape of
  * element codes - this is the main advantage of LLM-STT over the Web Speech API.
 */
const TRANSCRIBE_PROMPT = `Prepíš priloženú hlasovú nahrávku doslovne.

Kontext: pokyn pre asistenta AIM Viewera (BIM / správa budov). Očakávaná
slovenčina s odbornou terminológiou: VZT (vzduchotechnika), ÚK (ústredné
kúrenie), ZTI (zdravotechnika), MaR, IFC, pset, vyústka, potrubie, podlažie,
miestnosť, výkres, klasifikácia. Kódy prvkov diktované po znakoch zapíš
kompaktne v tvare ako DD01.06.03 (veľké písmená, segmenty oddelené bodkou).

Pravidlá: vráť IBA čistý text prepisu bez úvodzoviek, uvádzacích viet či
komentárov; doplň prirodzenú interpunkciu a diakritiku; ak hovoriaci hovorí
iným jazykom, prepíš v tom jazyku; ak nahrávka neobsahuje zrozumiteľnú reč,
vráť prázdny text.`;

export function createGeminiSttProvider(): SttProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new SttConfigError(
      "Chýba env premenná GEMINI_API_KEY. Doplň ju do .env.local (lokálne) " +
        "alebo do Vercel env (deploy) — hlasový prepis je bez nej vypnutý."
    );
  }
  const model = process.env.STT_MODEL ?? DEFAULT_MODEL;

  return {
    id: `gemini:${model}`,
    async transcribe(req: SttRequest): Promise<string> {
      const body = JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: TRANSCRIBE_PROMPT },
              {
                inline_data: {
                  mime_type: req.mimeType,
                  data: Buffer.from(req.audio).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      });

      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
        });
        if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        break;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(
          `Gemini API ${res.status}: ${errBody.slice(0, 500) || res.statusText}`
        );
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      return parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
    },
  };
}
