import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { jsonSchema } from "./jsonSchema";
import { SCHEMY } from "./models";

const KORPUS = join(process.cwd(), "library", "korpus", "schema");

describe("korpus zhody: zod -> JSON Schema = pydantic (krok 2 portu, D-186)", () => {
  for (const [subor, model] of Object.entries(SCHEMY)) {
    it(`schema/${subor}.json`, () => {
      const ocakavane = JSON.parse(readFileSync(join(KORPUS, `${subor}.json`), "utf8"));
      // ako JSON: poradie kľúčov nerozhoduje
      expect(JSON.parse(JSON.stringify(jsonSchema(model)))).toEqual(ocakavane);
    });
  }
});

describe("korpus zhody: zod parse = pydantic model_dump (validátory, predvolené hodnoty, odvodené polia)", () => {
  for (const strom of ["vzor", "kniznica", "chybne"]) {
    const poznamky = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", strom, "poznamky.json"), "utf8")) as Record<
      string,
      { typ: string; data: unknown; model: unknown }
    >;
    for (const [cesta, n] of Object.entries(poznamky)) {
      it(`${strom}: ${cesta}`, () => {
        const schema = (SCHEMY as Record<string, (typeof SCHEMY)[keyof typeof SCHEMY]>)[n.typ];
        expect(schema, `schéma pre typ ${n.typ}`).toBeDefined();
        const r = schema.safeParse(n.data);
        if (n.model === null) {
          expect(r.success).toBe(false);
          return;
        }
        expect(r.success ? JSON.parse(JSON.stringify(r.data)) : r.error.issues).toEqual(n.model);
      });
    }
  }
});

describe("validátory, ktoré JSON Schema nenesie", () => {
  const er = { id: "ER-1", typ: "ER", nazov: "n", nazov_en: "n", stav: "WD", verzia: 0.1 };
  it("verzia z čísla na text, typ musí sedieť s modelom", () => {
    expect(SCHEMY.ER.parse(er)).toMatchObject({ verzia: "0.1", aliases: [], jazyk: "sk" });
    expect(SCHEMY.ER.safeParse({ ...er, typ: "UC" }).success).toBe(false);
  });
  it("prepis: hodnoty xor slovník, polozka alebo geometria.profil; výstup s menom atribútu geometria_profil", () => {
    const ok = SCHEMY.ER.parse({ ...er, prepisy: [{ iu: "[[IU-O-space]]", "geometria.profil": "[[GEO-G1]]" }] });
    expect(ok.prepisy[0]).toMatchObject({ geometria_profil: "[[GEO-G1]]" });
    expect(SCHEMY.ER.safeParse({ ...er, prepisy: [{ iu: "[[IU-O-space]]" }] }).success).toBe(false);
    expect(SCHEMY.ER.safeParse({ ...er, prepisy: [{ iu: "[[IU-O-space]]", polozka: "Name", hodnoty: ["a"], hodnoty_ref: "[[STD-x#y]]" }] }).success).toBe(false);
  });
  it("odvodené typy požiadavky IU-C (C / E) a IU-O (D1, D2, D3)", () => {
    const iuc = { ...er, id: "IU-C-x", typ: "IU-C", druh: "dokument" };
    expect(SCHEMY["IU-C"].parse(iuc)).toMatchObject({ typ_poziadavky: "E" });
    expect(SCHEMY["IU-C"].parse({ ...iuc, druh: "model" })).toMatchObject({ typ_poziadavky: "C" });
  });
});
