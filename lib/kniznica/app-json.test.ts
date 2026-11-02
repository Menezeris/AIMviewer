import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dokumentEditora } from "./app-json";
import { nacitajKniznicuGraf } from "./graf";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

// Diagnostiky validátora (krok 5) zatiaľ prichádzajú z korpusu: dokument ich len rozdelí po poznámkach.
describe("korpus zhody: dokument editora (krok 4c portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    describe(`strom ${strom}`, () => {
      const editor = json(`${strom}/editor.json`);
      const got = plain(dokumentEditora(nacitajKniznicuGraf(json(`${strom}/subory.json`)), editor.diagnostiky));
      it("rovnaké kľúče dokumentu", () => expect(Object.keys(got).sort()).toEqual(Object.keys(editor).sort()));
      for (const kl of Object.keys(editor).filter((x) => x !== "poznamky")) it(kl, () => expect(got[kl]).toEqual(editor[kl]));
      it("poradie poznámok", () => expect(got.poznamky.map((p: { id: string }) => p.id)).toEqual(editor.poznamky.map((p: { id: string }) => p.id)));
      for (const [i, p] of (editor.poznamky as Array<{ id: string }>).entries()) it(`poznámka ${p.id}`, () => expect(got.poznamky[i]).toEqual(p));
    });
  }
});
