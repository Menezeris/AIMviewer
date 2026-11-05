import "server-only";

import type { SttProvider, SttRequest } from "./provider";

/**
  * Deterministic STT mock (D-069) - the whole path microphone -> /api/transcribe ->
  * inserting the transcript into the input can be verified without an API key and without a network
  * (devtest/e2e, verify skill). It is switched on via `STT_PROVIDER=mock`.
 */
export function createMockSttProvider(): SttProvider {
  return {
    id: "mock",
    async transcribe(req: SttRequest): Promise<string> {
      return `Koľko VZT jednotiek je v budove? (mock prepis, ${req.audio.byteLength} B ${req.mimeType})`;
    },
  };
}
