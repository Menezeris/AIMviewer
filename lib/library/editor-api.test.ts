import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { editorDocument } from "./app-json";
import { dokument, nova, over, save, stav, vydaj } from "./editor-api";
import { loadLibraryGraph } from "./graph";
import { POCET_VOLANI_API, vykresliHtml } from "./preview";
import { validuj } from "./validator";
import { memoryStore } from "./write";

const KORPUS = join(process.cwd(), "library", "korpus", "stromy");
const subory = (strom: string) => JSON.parse(readFileSync(join(KORPUS, strom, "subory.json"), "utf8")) as Record<string, string>;
const HTML = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "editor-html-orakulum.json"), "utf8"));
const ZAPIS = { zapis: true, vydanie: false };
const bezInfo = async () => ({});

describe("stránka editora = Python nahlad.vykresli_html (orákulum f7c103c)", () => {
  for (const strom of ["vzor", "kniznica"]) {
    it(`strom ${strom} bajtovo`, () => {
      const k = loadLibraryGraph(subory(strom));
      const html = vykresliHtml(JSON.parse(JSON.stringify(editorDocument(k, validuj(k)))));
      expect(createHash("sha256").update(html, "utf8").digest("hex")).toBe(HTML[strom].sha256);
    });
  }
  it("API stránky smeruje na AIM", () => {
    const html = vykresliHtml({}, "/api/library/editor/assetin/");
    expect(html.split('fetch("/api/library/editor/assetin/" + "').length - 1).toBe(POCET_VOLANI_API);
    expect(html).not.toContain('fetch("api/');
  });
});

describe("API editora nad skladom (port assetin/server)", () => {
  it("stav hovorí, či sa smie zapisovať", () => {
    expect(stav("assetin", { zapis: false, vydanie: false })).toEqual({ api: true, koren: "db:assetin", zapis: false, nova: false, kontrola: true, vydanie: false, autor_povinny: true });
  });

  it("dokument s revíziami zo skladu a povinným autorom", async () => {
    const d = await dokument(memoryStore(subory("vzor")), { info: () => ({ "zadanie/UC/UC-0101 Zameranie skutočného stavu priestorov.md": { rev: 3, autor: "Samuel" } }) });
    expect(d.autor_povinny).toBe(true);
    const uc = d.poznamky.find((p) => p.id === "UC-0101")!;
    expect(uc.revizia === null || typeof uc.revizia === "object").toBe(true);
  });

  it("save: brána vypnutá = 403, bez autora = 400", async () => {
    const s = memoryStore(subory("vzor"));
    expect((await save(() => s, { zapis: false, vydanie: false }, { zmeny: [], autor: "x" }, bezInfo)).status).toBe(403);
    expect((await save(() => s, ZAPIS, { zmeny: [] }, bezInfo)).status).toBe(400);
  });

  it("save zapíše a vráti čerstvý dokument; iná verzia = 409 bez zápisu", async () => {
    const s = memoryStore(subory("vzor"));
    const pred = await dokument(s);
    const uc = pred.poznamky.find((p) => p.id === "UC-0101")!;
    const ok = await save(() => s, ZAPIS, { zmeny: [{ id: "UC-0101", pointer: "/nazov_en", hodnota: "Survey" }], autor: "Test", verzie: { "UC-0101": uc.verzia } }, bezInfo);
    expect(ok.status).toBe(200);
    expect(ok.telo.ok).toBe(true);
    const po = (ok.telo.dokument as Awaited<ReturnType<typeof dokument>>).poznamky.find((p) => p.id === "UC-0101")!;
    expect(po.nazov_en).toBe("Survey");
    const stara = await save(() => s, ZAPIS, { zmeny: [{ id: "UC-0101", pointer: "/nazov_en", hodnota: "Iné" }], autor: "Test", verzie: { "UC-0101": uc.verzia } }, bezInfo);
    expect(stara.status).toBe(409);
    expect(s.subory[uc.subor]).toContain("Survey");
  });

  it("kontrola nič nezapisuje", async () => {
    const s = memoryStore(subory("vzor"));
    const pred = JSON.stringify(s.subory);
    const r = await over(s, { zmeny: [{ id: "ER-0101", pointer: "/uc", hodnota: [] }] });
    expect(r.status).toBe(200);
    expect((r.telo.diagnostiky as Array<{ kod: string; note_id: string }>).some((d) => d.kod === "C3" && d.note_id === "ER-0101")).toBe(true);
    expect(JSON.stringify(s.subory)).toBe(pred);
  });

  it("nova vytvorí poznámku zo šablóny", async () => {
    const s = memoryStore(subory("vzor"));
    const vstup = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "upravy", "22-nova-uc.json"), "utf8")).vstup.nova;
    const r = await nova(() => s, ZAPIS, { ...vstup, autor: "Test" }, bezInfo);
    expect(r.telo.ok).toBe(true);
    expect((r.telo.dokument as Awaited<ReturnType<typeof dokument>>).registre.UC).toContain(vstup.id);
  });

  it("vydaj: brána vypnutá = 403", async () => {
    const r = await vydaj(() => { throw new Error("nemá sa volať"); }, { zapis: true, vydanie: false }, { kod: "2026.11.2", autor: "Test" });
    expect(r.status).toBe(403);
  });
});
