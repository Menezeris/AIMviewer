import { describe, expect, it } from "vitest";

import { appliedText, appliedWarnings } from "./applied-text";
import type { LiveAppliedPayload } from "./protocol";

const SECTION = { axis: "y", crosses: "IFC Z (výška)", coordinate: 1.2 };
const applied = (state: Record<string, unknown>): LiveAppliedPayload => ({ cmdId: "c", ok: true, issues: [], state });

describe("upozornenia v potvrdení príkazu (D-125)", () => {
  it("zmeny mimo príkazov (#180): povie ich a nech na starom stave nestavia", () => {
    const w = appliedWarnings("style_in_3d", applied({ changed_outside_commands: ["izolácia zrušená (bolo 21 prvkov)"] }));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/izolácia zrušená \(bolo 21 prvkov\)/);
  });

  it("aktívny rez pri isolate, xray a colorize (#177), nie pri hide, set_section ani s clear_section", () => {
    const a = applied({ section: SECTION });
    expect(appliedWarnings("style_in_3d", a, { args: { action: "isolate" } })[0]).toMatch(/Aktívny rez \(IFC Z \(výška\) = 1.2 m\)/);
    expect(appliedWarnings("style_in_3d", a, { args: { action: "colorize" } })).toHaveLength(1);
    expect(appliedWarnings("style_in_3d", a, { args: { action: "hide" } })).toEqual([]);
    expect(appliedWarnings("set_section", a, { args: { action: "isolate" } })).toEqual([]);
    expect(appliedWarnings("style_in_3d", a, { args: { action: "isolate", clear_section: true } })).toEqual([]);
    expect(appliedWarnings("style_in_3d", applied({ section: null }), { args: { action: "isolate" } })).toEqual([]);
  });

  it("viac okien viewera (#182) a text s POZOR na konci", () => {
    expect(appliedWarnings("show_in_3d", applied({}), { viewers: 1 })).toEqual([]);
    const text = appliedText("show_in_3d", applied({}), 10, { viewers: 2 });
    expect(text).toMatch(/^Vykonané vo vieweri \(10 ms\)\./);
    expect(text).toMatch(/POZOR: Na živý kanál odpovedá 2 okien viewera/);
  });
});

describe("stav tabuľky po open_list (D-148)", () => {
  const text = (state: Record<string, unknown>, run = true) => appliedText("open_list", applied(state), 5, { args: { run } });
  it("hotová, beží, zlyhala a nespustená majú každá vlastnú vetu", () => {
    expect(text({ list: { status: "done", rows: 42 } })).toContain("hotová: 42 riadkov");
    expect(text({ list: { status: "running" } })).toContain("Tabuľka beží");
    expect(text({ list: { status: "failed", error: "zlý regex" } })).toContain("nespustila: zlý regex");
    expect(text({ list: { status: "not_started", reason: "nie je načítaný model" } })).toContain("nie je načítaný model");
  });
  it("run bez stavu zoznamu (starý fork) nepotvrdí beh; bez run a iný tool mlčia", () => {
    expect(text({})).toContain("netvrď, že tabuľka beží");
    expect(text({}, false)).not.toContain("tabuľka");
    expect(text({ list: { status: "opened" } }, false)).toContain("Run stlačí používateľ");
    expect(appliedText("style_in_3d", applied({ list: { status: "done", rows: 1 } }), 5)).not.toContain("riadkov");
  });
});

describe("úpravy zoznamu v potvrdení (D-149)", () => {
  const text = (list: Record<string, unknown> | undefined, args: Record<string, unknown>) =>
    appliedText("open_list", applied(list ? { list } : {}), 5, { args });
  const DONE = { status: "done", rows: 52, visible_rows: 7, sort: null, maximized: true, sums: [{ column: "NetVolume", value: 17.5775, unit: "m³" }] };
  it("súčty povie vetou za zobrazené riadky", () => {
    expect(text(DONE, { action: "update", sum: ["Qto_ColumnBaseQuantities.NetVolume"] })).toContain("Súčty za 7 zobrazených riadkov: NetVolume = 17.5775 m³.");
  });
  it("nevykonaná maximalizácia, zoradenie a súčet sa nehlásia ako hotové", () => {
    const t = text({ ...DONE, maximized: false, sums: [] }, { maximize: true, sort_by: "Name", sum: ["X.Y"] });
    expect(t).toContain("nemaximalizoval");
    expect(t).toContain("Zoradenie sa neprejavilo");
    expect(t).toContain("súčet nehlás");
  });
  it("farby a export (krok 2): potvrdí len to, čo viewer hlási", () => {
    const t = text({ ...DONE, color_by: "Pset_ColumnCommon.FireRating", export_ready: "csv" }, { action: "update", color_by: "Pset_ColumnCommon.FireRating", export: "csv" });
    expect(t).toContain("ofarbené podľa stĺpca Pset_ColumnCommon.FireRating");
    expect(t).toContain("tlačidlo Stiahnuť CSV");
    const no = text(DONE, { action: "update", color_by: "storey", export: "xlsx" });
    expect(no).toContain("ofarbenie nepotvrdzuj");
    expect(no).toContain("tlačidlom Export");
  });
  it("starý fork bez stavu tabuľky: úpravy nepotvrdzuj; bez úprav ticho", () => {
    expect(text({ status: "done", rows: 3 }, { action: "update" })).toContain("nepotvrdzuj");
    expect(text({ status: "done", rows: 3 }, {})).not.toContain("nepotvrdzuj");
  });
});

describe("príkaz odmietnutý cudzím oknom (D-159)", () => {
  it("rejected foreign = jasne nevykonané, bez stavu", () => {
    const text = appliedText("set_section", { cmdId: "c", ok: false, issues: ["viewer ovláda iný chat"], rejected: "foreign" });
    expect(text).toMatch(/NEVYKONAL/);
    expect(text).toMatch(/Prevziať/);
    expect(text).not.toMatch(/Stav po príkaze/);
  });
});
