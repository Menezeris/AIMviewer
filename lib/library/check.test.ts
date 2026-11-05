import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { kontrola } from "./check";
import { skladPamat, type Zmena } from "./write";

const subory = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8"));
const ORAKULUM = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "kontrola-orakulum.json"), "utf8")) as Array<{
  nazov: string;
  vstup: { zmeny?: Zmena[]; nova?: Record<string, unknown> };
  vysledok: { ok: boolean; odmietnute: string[]; diagnostiky: Array<Record<string, unknown>> };
}>;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
/** Text výnimky Pythonu a chyby pydantic sa od JS a zod líši (D-186 krok 2b); kľúč diagnostiky nie. */
const INFORMATIVNE = new Set(["W1", "A5", "A7", "LOAD"]);
const bezSpravy = (ds: Array<Record<string, unknown>>) => ds.map((d) => (INFORMATIVNE.has(String(d.kod)) ? { ...d, sprava: "" } : d));

describe("kontrola pracovnej kópie = Python zapis.kontrola nad vstupmi upravy/* (orákulum f7c103c)", () => {
  for (const c of ORAKULUM) {
    it(c.nazov, async () => {
      const r = plain(await kontrola(skladPamat({ ...subory }), (c.vstup.zmeny ?? []).map((z) => ({ ...z, hodnota: z.hodnota ?? null })), c.vstup.nova ?? null));
      expect(r.ok).toBe(c.vysledok.ok);
      expect(r.odmietnute).toEqual(c.vysledok.odmietnute);
      expect(bezSpravy(r.diagnostiky)).toEqual(bezSpravy(c.vysledok.diagnostiky));
    });
  }
});
