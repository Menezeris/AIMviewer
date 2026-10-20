import { describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps, selectOp } from "../viewer-ops";

import { selectPanelInput, selectPanelNote } from "./select-panel";

const G = "0MJFXziqDE$gGyPWwro9fq";

describe("select_in_3d s panelom vlastností (D-113)", () => {
  it("vstup toolu -> panel", () => {
    expect(selectPanelInput({ id_or_ref: "x" })).toBeUndefined();
    expect(selectPanelInput({ panel_tab: "ifc", panel_section: "quantities" })).toEqual({ tab: "ifc", section: "quantities" });
    expect(selectPanelInput({ highlight: " Pset_WallCommon.FireRating " })).toEqual({
      focus: { pset: "Pset_WallCommon", property: "FireRating" },
    });
    // Bodka vo vlastnosti ostáva vo vlastnosti (delí sa na prvej).
    expect(selectPanelInput({ highlight: "Pset_X.U.value" })).toEqual({ focus: { pset: "Pset_X", property: "U.value" } });
  });

  it("Qto sa nezvýrazní: otvorí sekciu Quantities a povie to", () => {
    const input = { highlight: "Qto_SpaceBaseQuantities.NetFloorArea" };
    expect(selectPanelInput(input)).toEqual({ tab: "ifc", section: "quantities" });
    expect(selectPanelNote(input)).toMatch(/Quantities/);
    expect(selectPanelNote({ highlight: "Pset_WallCommon.FireRating" })).toBeUndefined();
  });

  it("chybný vstup je chyba toolu", () => {
    expect(() => selectPanelInput({ panel_tab: "raw" })).toThrow(/panel_tab/);
    expect(() => selectPanelInput({ panel_section: "bsdd" })).toThrow(/panel_section/);
    expect(() => selectPanelInput({ highlight: "FireRating" })).toThrow(/highlight/);
    expect(() => selectPanelInput({ highlight: ".FireRating" })).toThrow(/highlight/);
    expect(() => selectPanelInput({ highlight: 42 })).toThrow(/highlight/);
  });

  it("op select nesie panel do mosta a mená s oddeľovačmi prejdú bez zmeny", () => {
    const panel = { tab: "ifc" as const, section: "properties" as const, focus: { pset: "Pset;A:B~C", property: "x.y z/ž" } };
    const raw = selectOp(G, panel);
    expect(raw.split(":").length).toBe(3);
    expect(parseOps(`${raw};show_all::`).map(opToBridgeMessage)).toEqual([
      { type: "SELECT", guid: G, panel },
      { type: "SHOW_ALL" },
    ]);
    // Prejde aj URL (jedno kódovanie navyše, ako v navigate akcii).
    const viaUrl = new URLSearchParams(`ops=${encodeURIComponent(raw)}`).get("ops")!;
    expect(parseOps(viaUrl)[0]).toEqual({ op: "select", guid: G, panel });
  });

  it("bez panela ostáva op aj správa ako doteraz", () => {
    expect(selectOp(G)).toBe(`select::${G}`);
    expect(parseOps(`select::${G}`).map(opToBridgeMessage)).toEqual([{ type: "SELECT", guid: G }]);
    // Neplatné kľúče sa zahodia, výber ostane.
    expect(parseOps(`select:~t=raw~s=bsdd~p=A:${G}`).map(opToBridgeMessage)).toEqual([{ type: "SELECT", guid: G }]);
  });
});
