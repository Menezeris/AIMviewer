import { describe, expect, it } from "vitest";

import { opToBridgeMessage, panelsOp, parseOps, selectOp } from "../viewer-ops";

import { lookupProperty, selectPanelInput } from "./select-panel";

const G = "0MJFXziqDE$gGyPWwro9fq";

describe("select_in_3d s panelom vlastností (D-113)", () => {
  it("vstup toolu -> panel", () => {
    expect(selectPanelInput({ id_or_ref: "x" })).toBeUndefined();
    expect(selectPanelInput({ panel_section: "quantities" })).toEqual({ section: "quantities" });
    // D-127: záložka AIM | IFC zanikla, starý vstup sa ignoruje (nie chyba).
    expect(selectPanelInput({ panel_tab: "aim" })).toBeUndefined();
    expect(selectPanelInput({ panel_tab: "ifc", panel_section: "properties" })).toEqual({ section: "properties" });
    expect(selectPanelInput({ highlight: " Pset_WallCommon.FireRating " })).toEqual({
      focus: { pset: "Pset_WallCommon", property: "FireRating" },
    });
    // Bodka vo vlastnosti ostáva vo vlastnosti (delí sa na prvej).
    expect(selectPanelInput({ highlight: "Pset_X.U.value" })).toEqual({ focus: { pset: "Pset_X", property: "U.value" } });
  });

  it("Qto sa zvýrazní ako ostatné vlastnosti (D-127), sekciu určí viewer", () => {
    expect(selectPanelInput({ highlight: "Qto_SpaceBaseQuantities.NetFloorArea", panel_section: "properties" })).toEqual({
      focus: { pset: "Qto_SpaceBaseQuantities", property: "NetFloorArea" },
    });
  });

  it("vlastnosť v dátach AIM: presne, bez ohľadu na veľkosť písmen, chýbajúca so zoznamom psetov", () => {
    const props = { AIM_FireSafety: { FireCompartments: "N1.01" }, Pset_DoorCommon: { IsExternal: false }, _contact: { x: 1 } };
    expect(lookupProperty(props, "AIM_FireSafety", "FireCompartments")).toEqual({ in_aim: true, value: "N1.01" });
    expect(lookupProperty(props, "aim_firesafety", "firecompartments")).toEqual({
      in_aim: true,
      pset: "AIM_FireSafety",
      property: "FireCompartments",
      value: "N1.01",
    });
    expect(lookupProperty(props, "Pset_DoorCommon", "FireRating")).toEqual({ in_aim: false, psets: ["AIM_FireSafety", "Pset_DoorCommon"] });
    expect(lookupProperty(props, "Pset_DoorCommon", "IsExternal")).toEqual({ in_aim: true, value: false });
    expect(lookupProperty(null, "P", "X")).toEqual({ in_aim: false, psets: [] });
  });

  it("chybný vstup je chyba toolu", () => {
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

describe("panely z chatu (D-127)", () => {
  it("op panels -> SET_PANELS, all len close, neplatné sa zahodí", () => {
    const raw = panelsOp({ all: "close", properties: "open" });
    expect(raw).toBe("panels:~all=close~properties=open:");
    expect(parseOps(raw).map(opToBridgeMessage)).toEqual([{ type: "SET_PANELS", panels: { all: "close", properties: "open" } }]);
    expect(parseOps("panels:~lens=toggle~model_tree=close:").map(opToBridgeMessage)).toEqual([
      { type: "SET_PANELS", panels: { lens: "toggle", model_tree: "close" } },
    ]);
    expect(parseOps("panels:~all=open~legend=close~lens=hide:")).toEqual([]);
  });
});
