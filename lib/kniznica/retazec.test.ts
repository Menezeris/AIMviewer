import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nacitajKniznicuGraf } from "./graf";
import { cestyPre, retazceJson, retazcePre, skratkaUloh } from "./retazec";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));

describe("korpus zhody: reťazec ako strom (krok 4b portu, D-186)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    it(`strom ${strom}: editor.json retazce`, () => {
      const k = nacitajKniznicuGraf(json(`${strom}/subory.json`));
      const ocak = json(`${strom}/editor.json`).retazce;
      const got = JSON.parse(JSON.stringify(retazceJson(k)));
      expect(got.map((r: { id: string }) => r.id)).toEqual(ocak.map((r: { id: string }) => r.id));
      got.forEach((r: unknown, i: number) => expect(r).toEqual(ocak[i]));
    });
  }

  it("skratka úloh: tri a viac po sebe = rozsah", () => {
    expect(skratkaUloh(["T2", "T3", "T4", "T5", "T6"])).toBe("T2–T6");
    expect(skratkaUloh(["T1", "T2", "T5"])).toBe("T1, T2, T5");
  });
});

describe("pruh 'kde to sedí' a stromy pri poznámke (editor.json poznamky[].cesty, retazce, pod_zaznamy[].cesty)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    const k = nacitajKniznicuGraf(json(`${strom}/subory.json`));
    const poznamky = json(`${strom}/editor.json`).poznamky as Array<{ id: string; cesty: unknown; retazce: unknown; pod_zaznamy: Array<{ id: string; cesty: unknown }> }>;
    for (const p of poznamky) {
      it(`${strom}: ${p.id}`, () => {
        expect(JSON.parse(JSON.stringify(cestyPre(k, p.id)))).toEqual(p.cesty);
        expect(JSON.parse(JSON.stringify(retazcePre(k, p.id)))).toEqual(p.retazce);
        for (const pz of p.pod_zaznamy) expect(JSON.parse(JSON.stringify(cestyPre(k, pz.id))), pz.id).toEqual(pz.cesty);
      });
    }
  }
});
