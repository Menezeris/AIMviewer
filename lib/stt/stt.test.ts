import { afterEach, describe, expect, it, vi } from "vitest";

// The modules are server-only (D-026) - outside the RSC runtime the marker must be mocked out.
vi.mock("server-only", () => ({}));

import { getSttProvider, SttConfigError } from "./provider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getSttProvider", () => {
  it("STT_PROVIDER=mock vráti deterministický mock", async () => {
    vi.stubEnv("STT_PROVIDER", "mock");
    const provider = await getSttProvider();
    expect(provider.id).toBe("mock");
    const text = await provider.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
    });
    expect(text).toContain("VZT");
  });

  it("bez kľúča aj bez STT_PROVIDER hodí SttConfigError", async () => {
    vi.stubEnv("STT_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(getSttProvider()).rejects.toBeInstanceOf(SttConfigError);
  });

  it("neznámy STT_PROVIDER hodí SttConfigError", async () => {
    vi.stubEnv("STT_PROVIDER", "deepgram");
    await expect(getSttProvider()).rejects.toBeInstanceOf(SttConfigError);
  });

  it("GEMINI_API_KEY bez STT_PROVIDER auto-detekuje gemini", async () => {
    vi.stubEnv("STT_PROVIDER", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const provider = await getSttProvider();
    expect(provider.id).toMatch(/^gemini:/);
  });
});

describe("gemini STT provider", () => {
  it("pošle audio ako inline_data a vráti orezaný prepis", async () => {
    vi.stubEnv("STT_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("STT_MODEL", "gemini-test-model");

    let captured: { url: string; body: Record<string, unknown> } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, body: JSON.parse(init.body as string) };
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "  Koľko dverí je na 2. podlaží?  " }] } },
            ],
          }),
          { status: 200 }
        );
      })
    );

    const provider = await getSttProvider();
    const audio = new Uint8Array([104, 101, 106]);
    const text = await provider.transcribe({ audio, mimeType: "audio/mp4" });

    expect(text).toBe("Koľko dverí je na 2. podlaží?");
    expect(captured!.url).toContain("gemini-test-model:generateContent");
    const contents = captured!.body.contents as {
      parts: { text?: string; inline_data?: { mime_type: string; data: string } }[];
    }[];
    const inline = contents[0].parts.find((p) => p.inline_data)?.inline_data;
    expect(inline?.mime_type).toBe("audio/mp4");
    expect(inline?.data).toBe(Buffer.from(audio).toString("base64"));
        // The domain vocabulary must be in the prompt - the main advantage over the Web Speech API.
    expect(contents[0].parts.find((p) => p.text)?.text).toContain("VZT");
  });

  it("neúspešná odpoveď API hodí chybu (route ju mapuje na 500)", async () => {
    vi.stubEnv("STT_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 400 }))
    );
    const provider = await getSttProvider();
    await expect(
      provider.transcribe({ audio: new Uint8Array([1]), mimeType: "audio/webm" })
    ).rejects.toThrow(/Gemini API 400/);
  });
});
