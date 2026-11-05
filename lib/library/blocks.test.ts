import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blocksJson, parsuj, preindexuj, serializuj, splitlines } from "./blocks";

/** Korpus zhody z assetin-library (`library/KORPUS_COMMIT`), vygenerovaný Python enginom (orákulum). */
const KORPUS = join(process.cwd(), "library", "korpus");
const STROMY = ["vzor", "kniznica", "chybne"] as const;
const json = (rel: string) => JSON.parse(readFileSync(join(KORPUS, rel), "utf8"));

describe("korpus zhody: blokový model poznámky (krok 1 portu, V30)", () => {
  it("korpus je celý: MANIFEST pokrýva všetky stromy", () => {
    const m = json("MANIFEST.json");
    expect(m.stromy).toEqual([...STROMY]);
    for (const s of STROMY) expect(m.subory[`stromy/${s}/bloky.json`]).toMatch(/^[0-9a-f]{64}$/);
  });

  for (const strom of STROMY) {
    describe(`strom ${strom}`, () => {
      const subory = json(`stromy/${strom}/subory.json`) as Record<string, string>;
      const bloky = json(`stromy/${strom}/bloky.json`) as Record<string, unknown>;

      it("každý súbor stromu má blokový model a naopak", () => {
        expect(Object.keys(subory).sort()).toEqual(Object.keys(bloky).sort());
        expect(Object.keys(subory).length).toBeGreaterThan(0);
      });

      for (const cesta of Object.keys(subory)) {
        it(cesta, () => {
          const text = subory[cesta];
          // zhoda s orákulom ako JSON (poradie kľúčov nerozhoduje)
          expect(blocksJson(text)).toEqual(bloky[cesta]);
          // spojenie raw = vstup, bajtovo
          const out = serializuj(parsuj(text));
          expect(Buffer.from(out, "utf8").equals(Buffer.from(text, "utf8"))).toBe(true);
        });
      }
    });
  }
});

describe("okrajové vstupy proti orákulu (Python, __fixtures__/okraje.json)", () => {
  const okraje = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "okraje.json"), "utf8")) as {
    pripady: Record<string, { vstup: string; ocakavane: unknown }>;
  };
  for (const [nazov, p] of Object.entries(okraje.pripady)) {
    it(nazov, () => {
      expect(blocksJson(p.vstup)).toEqual(p.ocakavane);
      expect(serializuj(parsuj(p.vstup))).toBe(p.vstup);
    });
  }
});

describe("bajtový round-trip mimo korpusu", () => {
  const vstupy: Record<string, string> = {
    prazdny: "",
    "bez koncového riadku": "---\nid: X\n---\n# Nadpis",
    crlf: "---\r\nid: X\r\n---\r\n# Nadpis  \r\nkluc:: hodnota \r\n\r\n```yaml\r\na: 1\r\n```\r\n",
    "neukončený fence": "# A\n```ids\n<ids/>\n",
    "neukončený frontmatter": "---\nid: X\n# A\n",
    "neukončený komentár": "<!-- a\nb\n",
    "unicode zlomy riadkov": "# A\u2028b\x85c\fd\ve\x1c",
    bom: "\ufeff---\nid: X\n---\n",
    "chybný yaml": "---\nid: [\n---\n```yaml\n: :\n  - x\n```\n",
  };
  for (const [nazov, text] of Object.entries(vstupy)) {
    it(nazov, () => {
      const d = parsuj(text);
      expect(serializuj(d)).toBe(text);
      const pred = [d.frontmatter?.riadok, ...d.telo.map((b) => b.riadok)];
      preindexuj(d);
      // riadky z parsera sedia s prepočtom tam, kde sú zlomy len \n
      if (!/[\r\v\f\x1c-\x1e\x85\u2028\u2029]/.test(text)) expect([d.frontmatter?.riadok, ...d.telo.map((b) => b.riadok)]).toEqual(pred);
    });
  }

  it("splitlines ako Python (keepends)", () => {
    expect(splitlines("a\r\nb\rc\n\nd")).toEqual(["a\r\n", "b\r", "c\n", "\n", "d"]);
    expect(splitlines("")).toEqual([]);
    expect(splitlines("x\u2028y")).toEqual(["x\u2028", "y"]);
  });

  it("frontmatter s BOM nie je frontmatter (Python lstrip ani porovnanie BOM nevynechá)", () => {
    expect(parsuj("\ufeff---\nid: X\n---\n").frontmatter).toBeNull();
  });

  it("chybný YAML: chyba = true, data = null, text bloku ostáva", () => {
    const d = parsuj("---\nid: [\n---\n```yaml\na: 1\na: 2\n```\n");
    expect(d.frontmatter).toMatchObject({ chyba: true, data: null });
    expect(d.telo[0]).toMatchObject({ druh: "YamlBlok", chyba: true, data: null, yaml_text: "a: 1\na: 2\n" });
  });
});
