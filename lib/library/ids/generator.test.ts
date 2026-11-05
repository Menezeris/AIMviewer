import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLibraryGraph } from "../graph";
import { ciele, generujCiel } from "./generator";

const KORPUS = join(process.cwd(), "library", "korpus");
const subory = (strom: string) => JSON.parse(readFileSync(join(KORPUS, "stromy", strom, "subory.json"), "utf8"));
const ORAKULUM = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "ids-orakulum.json"), "utf8")) as Record<
  string,
  Array<{ er: string; poskytovatel: string; datum: string | null; xml: string; specs: string[]; objekty: string[]; skipped: string[]; missing: string[][]; applicability: Record<string, number>; requirements: Record<string, number> }>
>;

describe("generátor IDS = Python generate/ids.py (D-186 krok 6)", () => {
  it("korpus ids/ER-0101_ARCH.ids bajtovo", () => {
    const k = loadLibraryGraph(subory("vzor"));
    const [xml] = generujCiel(k, { er: "ER-0101", poskytovatel: "ACT-poverena/ARCH" });
    expect(xml).toBe(readFileSync(join(KORPUS, "ids", "ER-0101_ARCH.ids"), "utf8"));
  });
  for (const [strom, prípady] of Object.entries(ORAKULUM)) {
    describe(`strom ${strom}`, () => {
      const k = loadLibraryGraph(subory(strom));
      it("ciele", () => expect(ciele(k)).toEqual([...new Map(prípady.map((c) => [`${c.er}|${c.poskytovatel}`, { er: c.er, poskytovatel: c.poskytovatel }])).values()]));
      for (const c of prípady) {
        it(`${c.er} × ${c.poskytovatel} (dátum ${c.datum ?? "žiadny"})`, () => {
          const [xml, rep] = generujCiel(k, { er: c.er, poskytovatel: c.poskytovatel }, c.datum);
          expect(xml).toBe(c.xml);
          expect(rep.specs).toEqual(c.specs);
          expect(rep.objekty).toEqual(c.objekty);
          expect(rep.skipped).toEqual(c.skipped);
          expect(rep.missing).toEqual(c.missing);
          expect(Object.fromEntries(rep.applicability)).toEqual(c.applicability);
          expect(Object.fromEntries(rep.requirements)).toEqual(c.requirements);
        });
      }
    });
  }
});
