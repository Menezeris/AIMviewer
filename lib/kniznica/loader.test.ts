import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rozober } from "./cesty";
import { nacitajKniznicu, nacitajSubor, poznamkaJson, riadokPrePointer, rozdelInline } from "./loader";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));

describe("korpus zhody: loader (krok 2b portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    describe(`strom ${strom}`, () => {
      const subory = json(`${strom}/subory.json`) as Record<string, string>;
      const ocakavane = json(`${strom}/poznamky.json`) as Record<string, unknown>;
      const nacitane = Object.fromEntries(nacitajKniznicu(subory).map((n) => [n.rel, poznamkaJson(n)]));

      it("rovnaké poznámky (bez KNIZNICA.md)", () => {
        expect(Object.keys(nacitane).sort()).toEqual(Object.keys(ocakavane).sort());
      });
      for (const cesta of Object.keys(ocakavane)) {
        it(cesta, () => {
          expect(JSON.parse(JSON.stringify(nacitane[cesta]))).toEqual(ocakavane[cesta]);
        });
      }
    });
  }
});

describe("loader mimo korpusu: diagnostiky (kľúč note_id, json_pointer, uroven, kod, subor, riadok)", () => {

  it("rozbor cesty: vrstva, typ, ID, ACT z hierarchie", () => {
    expect(rozober("zadanie/IU-O/IU-O-space Priestor.md")).toMatchObject({ typ: "IU-O", id: "IU-O-space", nazov_zo_suboru: "Priestor" });
    expect(rozober("zadanie/registre/ACT/poverena/ARCH/ARCH.md")).toMatchObject({ typ: "ACT", id: "ACT-poverena/ARCH", act_uroven: "tim", act_strana: "poverena" });
    expect(rozober("zadanie/STD/STD.md")).toMatchObject({ typ: "STD", id: "STD" });
    expect(() => rozober("ine/X.md")).toThrow(/mimo vrstiev/);
  });

  const orakulum = JSON.parse(readFileSync(join(process.cwd(), "lib", "kniznica", "__fixtures__", "loader-diagnostiky.json"), "utf8")) as {
    pripady: Record<string, { cesta: string; text: string; ocakavane: unknown[] }>;
  };
  for (const [nazov, p] of Object.entries(orakulum.pripady)) {
    it(`proti Python loaderu: ${nazov}`, () => {
      const got = nacitajSubor(p.cesta, p.text).diagnostiky.map((d) => [d.note_id, d.json_pointer, d.uroven, d.kod, d.subor, d.riadok]);
      expect(got.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))).toEqual(
        [...p.ocakavane].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
      );
    });
  }

  it("riadok YAML uzla ako ruamel lc; delenie inline odkazov", () => {
    expect(riadokPrePointer("a: 1\nb:\n  - x: 1\n  - x: 2\n", ["b", 1, "x"])).toBe(3);
    expect(riadokPrePointer("a: 1\n", ["nie"])).toBeNull();
    expect(rozdelInline("[[A|b, c]], [[B]] ,#aktivum,")).toEqual(["[[A|b, c]]", "[[B]]", "#aktivum"]);
  });
});
