import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLibraryGraph } from "../graph";
import { vydaj, type ReleaseStore } from "../release";
import { XsdError, nacitajSchemy, overXsd, SCHEMY } from "./xsd";

const KORPUS = join(process.cwd(), "library", "korpus");
const zlate = readFileSync(join(KORPUS, "ids", "ER-0101_ARCH.ids"), "utf8");

describe("ids.xsd bez siete (D-186 krok 6, variant A)", () => {
  it("nedostupná schéma zastaví vydanie", async () => {
    await expect(nacitajSchemy(async () => { throw new Error("offline"); }, false)).rejects.toBeInstanceOf(XsdError);
  });
  it("iný obsah schémy (sha256) zastaví vydanie", async () => {
    await expect(nacitajSchemy(async () => new TextEncoder().encode("<xs:schema/>"), false)).rejects.toThrow(/sha256/);
  });
  it("vydanie sa pri chybe XSD nerobí a do DB nejde nič", async () => {
    const volania: unknown[] = [];
    const s: ReleaseStore = {
      kniznica: "assetin",
      texty: async () => JSON.parse(readFileSync(join(KORPUS, "stromy", "vzor", "subory.json"), "utf8")),
      vydaj: async (p) => (volania.push(p), { vydanie_id: "x", ids: [] }),
    };
    const v = await vydaj(s, "2026.11.9", "Test", "", { xsd: () => Promise.reject(new XsdError("ids.xsd sa nedá stiahnuť")) });
    expect(v.ok).toBe(false);
    expect(v.sprava).toContain("ids.xsd sa nedá stiahnuť");
    expect(volania).toEqual([]);
  });
  it("pin ids.xsd je tag buildingSMART/IDS", () => expect(SCHEMY[0].url).toContain("/buildingSMART/IDS/v1.0.0/"));
});

// So sieťou (ako assetin-library R8): bez nej sa test preskočí, CI ho má so sieťou.
const siet = await nacitajSchemy().then(() => true, () => false);
describe.skipIf(!siet)("ids.xsd so sieťou: libxml2 (xmllint-wasm)", () => {
  it("zlaté ER-0101_ARCH.ids je platné", async () => expect(await overXsd(zlate)).toEqual([]));
  it("neplatné IDS má chybu s textom libxml2", async () => {
    const chyby = await overXsd(zlate.replace("<ids:info>", "<ids:info><ids:foo />"));
    expect(chyby.join("\n")).toMatch(/foo.*not expected/);
  });
  it("vydanie stromu vzor prejde XSD (audit xsd: ok)", async () => {
    const polozky: Array<{ audit: Record<string, unknown> }> = [];
    const s: ReleaseStore = {
      kniznica: "assetin",
      texty: async () => JSON.parse(readFileSync(join(KORPUS, "stromy", "vzor", "subory.json"), "utf8")),
      vydaj: async (p) => (polozky.push(...(p.polozky as typeof polozky)), { vydanie_id: "x", ids: [] }),
    };
    const v = await vydaj(s, "2026.11.9", "Test", "", { xsd: (xml) => overXsd(xml) });
    expect(v.ok).toBe(true);
    expect(polozky.map((p) => p.audit.xsd)).toEqual(["ok"]);
    expect(v.sprava).not.toContain("neoverené");
  }, 30_000);
  it("každý cieľ korpusu (aj strom chybne) dá platné IDS", async () => {
    const { ciele, generujCiel } = await import("./generator");
    for (const strom of ["vzor", "kniznica", "chybne"]) {
      const k = loadLibraryGraph(JSON.parse(readFileSync(join(KORPUS, "stromy", strom, "subory.json"), "utf8")));
      for (const c of ciele(k)) expect(await overXsd(generujCiel(k, c)[0]), `${strom} ${c.er}`).toEqual([]);
    }
  }, 30_000);
});
