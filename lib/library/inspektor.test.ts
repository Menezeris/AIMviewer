import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nacitajKniznicuGraf } from "./graf";
import { inspektor, inspektorEr } from "./inspektor";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("korpus zhody: inšpektor (krok 4c portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    describe(`strom ${strom}`, () => {
      const k = nacitajKniznicuGraf(json(`${strom}/subory.json`));
      const editor = json(`${strom}/editor.json`);
      it("inspektor_er (kontext každej výmeny)", () => {
        const got = plain(inspektorEr(k));
        expect(Object.keys(got).sort()).toEqual(Object.keys(editor.inspektor_er).sort());
        for (const kl of Object.keys(got)) expect(got[kl], kl).toEqual(editor.inspektor_er[kl]);
      });
      for (const p of editor.poznamky as Array<{ id: string; inspektor: unknown }>) {
        it(`inšpektor ${p.id}`, () => expect(plain(inspektor(k, p.id))).toEqual(p.inspektor));
      }
    });
  }
});
