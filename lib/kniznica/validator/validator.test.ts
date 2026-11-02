import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nacitajKniznicuGraf } from "../graf";
import { validuj } from "./index";
import { platnyRegex } from "./kontext";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
/** Korpus zapisuje diagnostiky zoradené podľa `json.dumps(d, sort_keys=True)`. */
const kluc = (d: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]])));
const zorad = (ds: Array<Record<string, unknown>>) => [...ds].sort((a, b) => (kluc(a) < kluc(b) ? -1 : kluc(a) > kluc(b) ? 1 : 0));

describe("korpus zhody: validátor (krok 5 portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    it(`validacia.json stromu ${strom}`, () => {
      const got = plain(validuj(nacitajKniznicuGraf(json(`${strom}/subory.json`))));
      expect(zorad(got)).toEqual(zorad(json(`${strom}/validacia.json`)));
    });
  }
});

const ORAKULUM = JSON.parse(readFileSync(join(process.cwd(), "lib", "kniznica", "__fixtures__", "validator-orakulum.json"), "utf8"));

describe("validátor mimo korpusu (orákulum assetin-library f7c103c)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    it(`preflight H2 stromu ${strom}`, () => {
      const got = plain(validuj(nacitajKniznicuGraf(json(`${strom}/subory.json`)), { preflight: true }).filter((d) => d.kod === "H2"));
      expect(zorad(got)).toEqual(zorad(ORAKULUM[strom]));
    });
  }
  it("platnosť a text chyby regexu ako Python re", () => {
    for (const [vzor, chyba] of Object.entries(ORAKULUM.regexy)) expect(platnyRegex(vzor), vzor).toBe(chyba);
  });
});
