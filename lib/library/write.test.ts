import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { memoryStore, uloz, vytvor, type NewNote, type Zmena } from "./write";

const KORPUS = join(process.cwd(), "library", "korpus");
const vzor = JSON.parse(readFileSync(join(KORPUS, "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;
const kluc = (d: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]])));

interface Uprava {
  nazov: string;
  vstup: { zmeny?: Zmena[]; nova?: NewNote };
  vysledok: Record<string, unknown> & { diagnostiky: Array<Record<string, unknown>> };
  texty_po: Record<string, string>;
  zmazane: string[];
}

describe("korpus zhody: writer a uloženie z editora (krok 3 portu, D-186)", () => {
  for (const f of readdirSync(join(KORPUS, "upravy")).sort()) {
    const u = JSON.parse(readFileSync(join(KORPUS, "upravy", f), "utf8")) as Uprava;
    it(f, async () => {
      const sklad = memoryStore(vzor);
      const v = u.vstup.nova ? await vytvor(sklad, u.vstup.nova, { autor: "korpus", zdroj: "nova" }) : await uloz(sklad, u.vstup.zmeny ?? [], { autor: "korpus" });
      const po = sklad.subory;
      const zmenene = Object.fromEntries(Object.entries(po).filter(([rel, t]) => vzor[rel] !== t).sort());
      // texty bajtovo
      expect(Object.keys(zmenene).sort()).toEqual(Object.keys(u.texty_po).sort());
      for (const [rel, t] of Object.entries(u.texty_po)) expect(Buffer.from(zmenene[rel] ?? "", "utf8").equals(Buffer.from(t, "utf8")), rel).toBe(true);
      expect(Object.keys(vzor).filter((rel) => !(rel in po)).sort()).toEqual(u.zmazane);
      // výsledok ako JSON; diagnostiky na kľúči (note_id, json_pointer, uroven, kod, subor, riadok)
      const { diagnostiky, ...rest } = u.vysledok;
      const { diagnostiky: d, ...mine } = v;
      expect(JSON.parse(JSON.stringify(mine))).toEqual(rest);
      const k = (x: Record<string, unknown>) => kluc({ note_id: x.note_id, json_pointer: x.json_pointer, uroven: x.uroven, kod: x.kod, subor: x.subor, riadok: x.riadok });
      expect(d.map((x) => k(x as never)).sort()).toEqual(diagnostiky.map(k).sort());
    });
  }
});
