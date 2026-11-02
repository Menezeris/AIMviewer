import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Konflikt, skladPamat, type Sklad } from "@/lib/kniznica/zapis";

let sklad: Sklad & { subory?: Record<string, string> };
vi.mock("@/lib/kniznica/sklad-db", () => ({ supabaseSklad: () => sklad, ZapisMigraciaChyba: class extends Error {} }));

const vzor = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;
const post = (url: string, body: unknown, origin = "https://aim.test") =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", host: "aim.test", origin }, body: JSON.stringify(body) });

async function load(env: Record<string, string>) {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  sklad = skladPamat(vzor);
  return { zapis: await import("./route"), nova: await import("../nova/route") };
}

const ZMENA = { kniznica: "assetin", autor: "Samuel", zmeny: [{ id: "IU-O-space", pointer: "/stav", hodnota: "PUB" }] };

describe("/api/library/zapis a /nova (D-186 krok 3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("brána: bez LIBRARY_WRITE_ENABLED 403 a nič sa nezapíše; cudzí origin 403", async () => {
    const off = await load({});
    expect((await off.zapis.POST(post("https://aim.test/api/library/zapis", ZMENA))).status).toBe(403);
    expect((await off.nova.POST(post("https://aim.test/api/library/nova", { kniznica: "assetin", autor: "S", typ: "UC", id: "UC-0201", nazov: "x" }))).status).toBe(403);
    expect(sklad.subory).toEqual(vzor);
    const on = await load({ LIBRARY_WRITE_ENABLED: "true" });
    expect((await on.zapis.POST(post("https://aim.test/api/library/zapis", ZMENA, "https://evil.test"))).status).toBe(403);
  });

  it("uloženie: autor povinný; zmena zapíše text, verzia z editora", async () => {
    const { zapis } = await load({ LIBRARY_WRITE_ENABLED: "true" });
    expect((await zapis.POST(post("https://aim.test/api/library/zapis", { ...ZMENA, autor: " " }))).status).toBe(400);
    const r = await zapis.POST(post("https://aim.test/api/library/zapis", ZMENA));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, zapisane: ["zadanie/IU-O/IU-O-space Priestor.md"] });
    expect(sklad.subory!["zadanie/IU-O/IU-O-space Priestor.md"]).toContain("stav: PUB");
  });

  it("súbeh: iná verzia = 409 konflikt, nič sa neprepíše", async () => {
    const { zapis } = await load({ LIBRARY_WRITE_ENABLED: "true" });
    const r = await zapis.POST(post("https://aim.test/api/library/zapis", { ...ZMENA, verzie: { "IU-O-space": "0".repeat(64) } }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ ok: false, konflikt: true, zapisane: [], diagnostiky: [expect.objectContaining({ kod: "W2" })] });
    expect(sklad.subory).toEqual(vzor);
  });

  it("konflikt zo skladu (AS409) sa hlási ako 409", async () => {
    const { zapis } = await load({ LIBRARY_WRITE_ENABLED: "true" });
    sklad = { ...skladPamat(vzor), zapis: async () => { throw new Konflikt(["zadanie/IU-O/IU-O-space Priestor.md"]); } };
    expect((await zapis.POST(post("https://aim.test/api/library/zapis", ZMENA))).status).toBe(409);
  });

  it("nová poznámka zo šablóny", async () => {
    const { nova } = await load({ LIBRARY_WRITE_ENABLED: "true" });
    const r = await nova.POST(post("https://aim.test/api/library/nova", { kniznica: "assetin", autor: "S", typ: "UC", id: "UC-0201", nazov: "Využitie", data: { nazov_en: "Use", typ_ulohy: "utilization", faza_iso22263: ["maintenance"] } }));
    expect(await r.json()).toMatchObject({ ok: true, vytvorene: ["zadanie/UC/UC-0201 Využitie.md"] });
  });
});
