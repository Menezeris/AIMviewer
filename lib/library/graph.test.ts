import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nacitajKniznicuGraf, slug } from "./graph";
import { grafJson } from "./graph-json";
import type { Diagnostika } from "./loader";
import { validuj } from "./validator";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));
const kluc = (d: Diagnostika) => JSON.stringify([d.note_id, d.json_pointer, d.uroven, d.kod, d.subor, d.riadok]);
const KODY_GRAFU = new Set(["A4", "A10", "B1", "B2", "B3"]);

describe("korpus zhody: graf knižnice a graf_json (krok 4a portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    describe(`strom ${strom}`, () => {
      const k = nacitajKniznicuGraf(json(`${strom}/subory.json`));
      const editor = json(`${strom}/editor.json`);
      const g = JSON.parse(JSON.stringify(grafJson(k, validuj(k))));

      for (const cast of ["kniznica", "kaskada", "rodiny", "hrany"]) it(cast, () => expect(g[cast]).toEqual(editor[cast]));
      it("uzly", () => {
        expect(g.uzly.map((u: { id: string }) => u.id)).toEqual(editor.uzly.map((u: { id: string }) => u.id));
        g.uzly.forEach((u: unknown, i: number) => expect(u).toEqual(editor.uzly[i]));
      });
      it("kotvy", () => expect(Object.fromEntries(k.kotvy)).toEqual(editor.kotvy));
      it("diagnostiky grafu (A4, A10, B1-B3) = validacia.json", () => {
        const ocak = (json(`${strom}/validacia.json`) as Diagnostika[]).filter((d) => KODY_GRAFU.has(d.kod)).map(kluc).sort();
        expect(k.diagnostiky.filter((d) => KODY_GRAFU.has(d.kod)).map(kluc).sort()).toEqual(ocak);
      });
    });
  }

  it("slug ako Python (Unicode \\w)", () => {
    expect(slug("Prepisy pre túto výmenu")).toBe("prepisy-pre-túto-výmenu");
    expect(slug("  A/B — c ")).toBe("a-b-c");
  });
});
