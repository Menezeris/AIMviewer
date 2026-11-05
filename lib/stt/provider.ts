import "server-only";

/**
  * Provider layer of voice transcription (STT, D-069). Mirrors `lib/llm/provider.ts`:
  * a neutral interface, the concrete service is chosen via env (`STT_PROVIDER`,
  * `STT_MODEL`). Server-only - the API key never leaves the server (D-026 line).
  * Further services (OpenAI gpt-4o-transcribe, Deepgram...) are added additively
  * as new cases without a UI change.
 */

export interface SttRequest {
    /** Raw audio data of the recording. */
  audio: Uint8Array;
    /** MIME type of the recording (audio/webm, audio/mp4...). */
  mimeType: string;
}

export interface SttProvider {
    /** Identifier for trace/log (e.g. 'gemini:gemini-flash-lite-latest'). */
  id: string;
    /** Verbatim transcript of the recording; an empty string = no intelligible speech. */
  transcribe(req: SttRequest): Promise<string>;
}

/** Configuration error (missing key...) - the API maps it to 503 with instructions. */
export class SttConfigError extends Error {}

/** Without an explicit STT_PROVIDER the provider is derived from the available key. */
function detectProvider(): string {
  if (process.env.GEMINI_API_KEY) return "gemini";
  throw new SttConfigError(
    "Hlasový prepis nie je nakonfigurovaný — doplň GEMINI_API_KEY do " +
      ".env.local (lokálne) / Vercel env (deploy)."
  );
}

export async function getSttProvider(): Promise<SttProvider> {
    // `||`, not `??` - an empty env value means "unset".
  const provider = process.env.STT_PROVIDER || detectProvider();
  switch (provider) {
    case "gemini": {
      const { createGeminiSttProvider } = await import("./gemini");
      return createGeminiSttProvider();
    }
    case "mock": {
      const { createMockSttProvider } = await import("./mock");
      return createMockSttProvider();
    }
    default:
      throw new SttConfigError(
        `Neznámy STT_PROVIDER '${provider}' — podporované: gemini, mock.`
      );
  }
}
