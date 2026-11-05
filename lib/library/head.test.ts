import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detail, HlavaMigraciaChyba, HlavaVstupChyba, prehlad, type HeadStore, type HeadFile } from "./head";

/** Hlava knižnice v pamäti zo stromu `vzor` korpusu (rovnaké súbory ako `library.hlava` knižnice assetin 2. 11.). */
function memoryHlava(opts: { bezMigracie?: boolean } = {}): HeadStore {
  const texty = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;
  const subory: HeadFile[] = Object.entries(texty).map(([cesta, text]) => ({
    kniznica: "assetin",
    cesta,
    note_id: cesta === "KNIZNICA.md" ? null : cesta.split("/").pop()!.split(" ")[0].replace(/\.md$/, ""),
    typ: cesta === "KNIZNICA.md" ? null : cesta.split("/")[1],
    rev: 1,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    autor: "Samuel Augustin",
    vytvorena: "2026-11-02T17:45:25.76844+00:00",
    zdroj: "migracia_md",
    text,
  }));
  return {
    async zoznam(k) {
      if (opts.bezMigracie) return null;
      return subory.filter((s) => k === null || s.kniznica === k).map(({ text, ...r }) => ({ ...r, dlzka: text.length }));
    },
    async subor(k, c) {
      if (opts.bezMigracie) return "chyba_migracie";
      return subory.find((s) => s.kniznica === k && s.cesta === c) ?? null;
    },
  };
}

describe("prehliadač knižnice nad library.hlava (krok 1 portu)", () => {
  it("prehľad: knižnice, počty podľa typu, súbory bez textu", async () => {
    const p = await prehlad(memoryHlava(), null);
    expect(p.kniznice).toEqual([{ kod: "assetin", subory: 19, typy: expect.objectContaining({ ER: 1, "IU-C": 2, "IU-O": 3, "(bez typu)": 1 }) }]);
    expect(p.subory[0]).not.toHaveProperty("text");
    expect((await prehlad(memoryHlava(), "ina")).subory).toEqual([]);
    await expect(prehlad(memoryHlava(), "zlý kód")).rejects.toBeInstanceOf(HlavaVstupChyba);
  });

  it("detail: blokový model, sha256 a bajtový round-trip; neznámy súbor null; zlá cesta odmietnutá", async () => {
    const cesta = "zadanie/ER/ER-0101 Priestorový model a protokol zamerania – odovzdanie.md";
    const d = (await detail(memoryHlava(), "assetin", cesta))!;
    expect(d).toMatchObject({ sha256_sedi: true, round_trip: true });
    expect(d.bloky.frontmatter?.data).toMatchObject({ id: "ER-0101" });
    expect(d.bloky.telo.some((b) => b.druh === "Nadpis")).toBe(true);
    expect(d.poznamka).toMatchObject({ id: "ER-0101", typ: "ER", diagnostiky: [], zdroje: { uc: "inline", prepisy: "blok" } });
    expect(d.poznamka?.model).toMatchObject({ id: "ER-0101", jazyk: "sk" });
    expect((await detail(memoryHlava(), "assetin", "KNIZNICA.md"))!.poznamka).toBeNull();
    expect(await detail(memoryHlava(), "assetin", "nie.md")).toBeNull();
    await expect(detail(memoryHlava(), "assetin", "../x.md")).rejects.toBeInstanceOf(HlavaVstupChyba);
  });

  it("bez migrácie RPC povie, čo chýba", async () => {
    await expect(prehlad(memoryHlava({ bezMigracie: true }), null)).rejects.toBeInstanceOf(HlavaMigraciaChyba);
    await expect(detail(memoryHlava({ bezMigracie: true }), "assetin", "KNIZNICA.md")).rejects.toThrow(/20261102200000_library_hlava_read/);
  });
});
