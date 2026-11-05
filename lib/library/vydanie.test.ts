import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { vydaj as vydajApi } from "./editor-api";
import { nacitajKniznicuGraf } from "./graf";
import { generujIds, kodIds, manifest, vydaj, zipExportu, type SkladVydania } from "./vydanie";
import { Konflikt } from "./zapis";

const subory = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;
const chybne = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "chybne", "subory.json"), "utf8")) as Record<string, string>;
const ORAKULUM = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "vydanie-orakulum.json"), "utf8"));

function skladPamat(texty: Record<string, string>, konflikt = false) {
  const volania: Array<Record<string, unknown>> = [];
  const s: SkladVydania & { volania: typeof volania } = {
    kniznica: "assetin",
    volania,
    texty: async () => ({ ...texty }),
    async vydaj(p) {
      volania.push({ druh: "vydaj", ...p });
      if (konflikt) throw new Konflikt(["zadanie/UC/x.md"]);
      return { vydanie_id: "00000000-0000-0000-0000-000000000001", ids: p.polozky.map((x) => ({ code: (x as { code: string }).code, zmena: "nove" })) };
    },
    async exportCesta(id, cesta) {
      volania.push({ druh: "export", id, cesta });
    },
  };
  return s;
}

describe("vydanie = Python db/vydanie.py (D-186 krok 6)", () => {
  it("kód IDS v katalógu", () => {
    for (const [kl, kod] of Object.entries(ORAKULUM.kody as Record<string, string>)) {
      const [er, p] = kl.split("|");
      expect(kodIds(er, p)).toBe(kod);
    }
  });
  it("manifest", () => expect(manifest(subory)).toEqual(ORAKULUM.manifest));
  it("IDS výstupy generátora (bez XSD = neoverené)", async () => {
    const got = JSON.parse(JSON.stringify(await generujIds(nacitajKniznicuGraf(subory), null)));
    const bezGen = (v: Array<{ audit: Record<string, unknown> }>) => v.map((x) => ({ ...x, audit: { ...x.audit, generator: "" } }));
    expect(bezGen(got)).toEqual(bezGen(ORAKULUM.vystupy));
  });
  it("obsah zipu exportu", () => {
    const z = unzipSync(zipExportu(subory, { kniznica: "assetin", vydanie: "2026.11.2" }));
    expect(Object.fromEntries(Object.entries(z).map(([n, b]) => [n, strFromU8(b)]))).toEqual(ORAKULUM.zip);
  });

  it("vydanie: jedna transakcia s IDS a auditom, export po úspechu", async () => {
    const s = skladPamat(subory);
    const nahrane: string[] = [];
    const v = await vydaj(s, "2026.11.2", "Test", "", { uloziste: { nahraj: async (c) => void nahrane.push(c) } });
    expect(v.ok).toBe(true);
    expect(v.manifest_sha256).toBe(ORAKULUM.manifest.manifest_sha256);
    const call = s.volania[0] as { polozky: Array<{ code: string; audit: Record<string, unknown> }>; ocakavane: Record<string, string>; diagnostiky: Record<string, number> };
    expect(call.polozky.map((p) => p.code)).toEqual(["ER-0101.ARCH"]);
    expect(Object.keys(call.ocakavane).length).toBe(Object.keys(subory).length);
    expect(call.polozky[0].audit).toMatchObject({ kniznica: "assetin", vydanie: "2026.11.2", manifest_sha256: ORAKULUM.manifest.manifest_sha256, diagnostiky: call.diagnostiky, xsd: "neoverené" });
    expect(nahrane).toEqual(["assetin/2026.11.2.zip"]);
    expect(v.export_cesta).toBe("assetin/2026.11.2.zip");
    expect(v.sprava).toContain("POZOR: IDS neoverené");
  });

  it("knižnica s chybami sa nevydá a do DB nejde nič", async () => {
    const s = skladPamat(chybne);
    const v = await vydaj(s, "x", "Test");
    expect(v.ok).toBe(false);
    expect(v.chyby.length).toBeGreaterThan(0);
    expect(s.volania).toEqual([]);
  });

  it("XSD chyba zastaví vydanie", async () => {
    const s = skladPamat(subory);
    const v = await vydaj(s, "x", "Test", "", { xsd: async () => ["element 'ids:foo' nie je povolený"] });
    expect(v.ok).toBe(false);
    expect(v.sprava).toContain("neprešlo ids.xsd");
    expect(s.volania).toEqual([]);
  });

  it("API: súbeh = 409, zlý kód = 400, bez autora = 400", async () => {
    const b = { zapis: false, vydanie: true };
    expect((await vydajApi(() => skladPamat(subory, true), b, { kod: "2026.11.2", autor: "Test" })).status).toBe(409);
    expect((await vydajApi(() => skladPamat(subory), b, { kod: "zlý kód", autor: "Test" })).status).toBe(400);
    expect((await vydajApi(() => skladPamat(subory), b, { kod: "2026.11.2" })).status).toBe(400);
    expect((await vydajApi(() => skladPamat(chybne), b, { kod: "2026.11.2", autor: "T" })).status).toBe(422);
  });
});
