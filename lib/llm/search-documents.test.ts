import { beforeEach, describe, expect, it, vi } from "vitest";

const { DOC, state } = vi.hoisted(() => ({
  DOC: "91776a5e-3c9f-49ad-8ba9-f7a5927a47ff",
  state: { rpcArgs: [] as Record<string, unknown>[], hasText: true, ocr: false },
}));

// Moduly sú server-only (D-026); DB vráti dokument, jeho stranu a zhodu RPC.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => {
  const docRow = {
    id: DOC,
    object_type: "document",
    object_ref: "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP",
    name: "D.1.1.01 Pôdorys 1NP",
    ifc_type: null,
    predefined_type: null,
  };
  const page = {
    document_id: DOC,
    page: 1,
    text: "1.05 Technická miestnosť 250",
    blocks: [
      { t: "1.05", x: 38.33, y: 56.05, w: 0.75, h: 1.2 },
      { t: "Technická miestnosť", x: 37.48, y: 57.46, w: 2.46, h: 0.8 },
      { t: "250", x: 50, y: 50, w: 1, h: 1 },
    ],
  };
  // D-169: titulka bez textovej vrstvy prečítaná OCR (riadky so src a conf, alias src z prvého riadku).
  const ocrPage = {
    document_id: DOC,
    page: 1,
    text: "VYSOKÉ UČENÍ TECHNICKÉ V BRNĚ Fakulta stavební",
    src: "ocr",
    blocks: [
      { t: "VYSOKÉ UČENÍ TECHNICKÉ V BRNĚ", x: 12, y: 14, w: 60, h: 2.5, src: "ocr", conf: 0.95 },
      { t: "Fakulta stavební", x: 12, y: 18, w: 30, h: 2, src: "ocr", conf: 0.8 },
    ],
  };
  const table = (name: string) => {
    const rows = () => (name === "objects" ? [docRow] : !state.hasText ? [] : state.ocr ? [ocrPage] : [page]);
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      in: () => q,
      order: async () => ({ data: rows(), error: null }),
      limit: async () => ({ data: rows(), error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: rows(), error: null }),
    };
    return q;
  };
  return {
    getSupabaseAdmin: () => ({
      from: table,
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        state.rpcArgs.push(args);
        return {
          data: [
            {
              document_id: DOC,
              document_ref: docRow.object_ref,
              document_name: docRow.name,
              page: 1,
              rank: 0.1,
              snippet: "<b>1.05</b> technicka miestnost",
            },
          ],
          error: null,
        };
      },
    }),
  };
});

import { AskToolRuntime } from "./tools";

describe("search_documents: čítanie strany a výrezy (D-123)", () => {
  beforeEach(() => {
    state.rpcArgs = [];
    state.hasText = true;
    state.ocr = false;
  });

  it("q + document_id hľadá len v dokumente a vráti výrez pre open_drawing region", async () => {
    const rt = new AskToolRuntime();
    const res = await rt.exec("search_documents", { q: "1.05", document_id: "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP" });
    expect(res.isError).toBe(false);
    expect(state.rpcArgs[0]).toMatchObject({ q: "1.05", doc_id: DOC });
    const [hit] = JSON.parse(res.content);
    expect(hit.deep_link).toBe(`/drawing/${DOC}?page=1`);
    expect(hit.regions).toEqual([
      { text: "1.05", bbox: { x: 38.3, y: 56.1, width: 0.8, height: 1.2 }, region: expect.objectContaining({ width: 15, height: 15 }) },
    ]);

    // Výrez sa dá priamo použiť v open_drawing (D-117) - ten istý tvar {x, y, width, height}.
    expect(Object.keys(hit.regions[0].region).sort()).toEqual(["height", "width", "x", "y"]);
  });

  it("document_id bez q prečíta stranu, s include_blocks aj riadky s polohou", async () => {
    const rt = new AskToolRuntime();
    const res = JSON.parse((await rt.exec("search_documents", { document_id: DOC, include_blocks: true })).content);
    expect(state.rpcArgs).toHaveLength(0);
    expect(res).toMatchObject({ document_ref: "OCB_SO01_ASR_D-1-1-01_PODORYS-1NP", page: 1, pages_with_text: [1] });
    expect(res.text).toContain("Technická miestnosť");
    expect(res.blocks).toHaveLength(3);
    const plain = JSON.parse((await rt.exec("search_documents", { document_id: DOC })).content);
    expect(plain.blocks).toBeUndefined();
    // Textová vrstva: žiadny príznak OCR, výsledok sa nemení.
    expect(res.source).toBeUndefined();
    expect(res.ocr_pages).toBeUndefined();
    expect(res.blocks[0].src).toBeUndefined();
  });

  it("strana z OCR (D-169) nesie source, istotu a upozornenie pri čítaní aj pri hľadaní", async () => {
    state.ocr = true;
    const rt = new AskToolRuntime();
    const read = JSON.parse((await rt.exec("search_documents", { document_id: DOC })).content);
    expect(read).toMatchObject({ source: "ocr", ocr_confidence: 0.9, ocr_pages: [1] });
    expect(read.ocr_note).toContain("OCR");
    expect(read.blocks).toBeUndefined();

    const withBlocks = JSON.parse((await rt.exec("search_documents", { document_id: DOC, include_blocks: true })).content);
    expect(withBlocks.blocks[0]).toEqual({ t: "VYSOKÉ UČENÍ TECHNICKÉ V BRNĚ", x: 12, y: 14, w: 60, h: 2.5, src: "ocr", conf: 0.95 });

    const [hit] = JSON.parse((await rt.exec("search_documents", { q: "Brně", document_id: DOC })).content);
    expect(hit).toMatchObject({ source: "ocr", ocr_confidence: 0.9 });
    expect(hit.regions[0]).toMatchObject({ text: "VYSOKÉ UČENÍ TECHNICKÉ V BRNĚ", source: "ocr", confidence: 0.95 });
  });

  it("dokument bez extrahovaného textu povie, ako ho načítať; bez q aj document_id je chyba", async () => {
    state.hasText = false;
    const rt = new AskToolRuntime();
    const res = JSON.parse((await rt.exec("search_documents", { document_id: DOC })).content);
    expect(res.hint).toContain("etl.pdf_text --from-db");
    const bad = await rt.exec("search_documents", {});
    expect(bad.isError).toBe(true);
  });
});
