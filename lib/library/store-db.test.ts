import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const volania: Array<{ fn: string; args: Record<string, unknown> }> = [];
let odpoved: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      volania.push({ fn, args });
      return fn === "library_texty" ? { data: Object.entries(vzor).map(([cesta, text]) => ({ cesta, text })), error: null } : odpoved;
    },
  }),
}));

const vzor = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;

describe("sklad v DB (D-186 krok 3)", () => {
  it("projekcie sa posielajú podľa cieľovej cesty (aj pri premenovaní a viacerých súboroch), nie podľa poradia", async () => {
    const { supabaseStore: supabaseSklad } = await import("./store-db");
    const s = supabaseSklad("assetin");
    const a = "zadanie/IU-O/IU-O-space Priestor.md";
    const b = "zadanie/registre/DEF/DEF-plocha-cista Čistá plocha miestnosti.md";
    const b2 = "zadanie/registre/DEF/DEF-plocha-cista Iná plocha.md";
    odpoved = { data: [], error: null };
    await s.zapis(
      [
        { cesta: b, text: vzor[b], ocakavana: "x", nova_cesta: b2 },
        { cesta: a, text: vzor[a], ocakavana: "y", nova_cesta: null },
      ],
      { autor: "Samuel", zdroj: "editor" },
    );
    const z = volania.find((v) => v.fn === "library_zapis")!.args;
    expect(Object.keys(z.p_projekcie as object).sort()).toEqual([a, b2].sort());
    expect((z.p_projekcie as Record<string, { data: { id: string } }>)[a].data.id).toBe("IU-O-space");
    expect((z.p_projekcie as Record<string, { data: { id: string } }>)[b2].data.id).toBe("DEF-plocha-cista");
    expect(z.p_zapisy).toEqual([
      expect.objectContaining({ cesta: b, nova_cesta: b2, note_id: "DEF-plocha-cista", typ: "DEF" }),
      expect.objectContaining({ cesta: a, nova_cesta: null, note_id: "IU-O-space", typ: "IU-O" }),
    ]);
    expect(z.p_autor).toBe("Samuel");
  });

  it("AS409 z DB = Konflikt s cestami; prázdny autor sa nepošle", async () => {
    const { supabaseStore: supabaseSklad } = await import("./store-db");
    const { Konflikt } = await import("./write");
    const s = supabaseSklad("assetin");
    odpoved = { data: null, error: { code: "AS409", details: '["zadanie/IU-O/IU-O-space Priestor.md"]', message: "conflict" } };
    await expect(s.zapis([{ cesta: "zadanie/IU-O/IU-O-space Priestor.md", text: "x", ocakavana: "0", nova_cesta: null }], { autor: "S" })).rejects.toBeInstanceOf(Konflikt);
    await expect(s.zapis([], { autor: " " })).rejects.toThrow(/autora/);
  });
});
