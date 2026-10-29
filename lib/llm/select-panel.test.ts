import { describe, expect, it } from "vitest";

import { opToBridgeMessage, panelScrollOp, panelZoomOp, panelsOp, parseOps, selectOp } from "../viewer-ops";

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

describe("viacnásobný výber (#217)", () => {
  const H = "1abcdefghijklmnopqrstu";

  it("select nesie všetky GUIDy do mosta, prvý ostáva guid", () => {
    const raw = selectOp([G, H, G]);
    expect(raw).toBe(`select::${G}.${H}.${G}`);
    expect(parseOps(raw).map(opToBridgeMessage)).toEqual([{ type: "SELECT", guid: G, guids: [G, H] }]);
  });

  it("panel ide s viacnásobným výberom a jeden prvok ostáva bez guids", () => {
    const panel = { section: "quantities" as const };
    expect(parseOps(selectOp([G, H], panel)).map(opToBridgeMessage)).toEqual([{ type: "SELECT", guid: G, guids: [G, H], panel }]);
    expect(selectOp([G])).toBe(`select::${G}`);
    expect(parseOps(selectOp([G])).map(opToBridgeMessage)).toEqual([{ type: "SELECT", guid: G }]);
  });
});

describe("panely z chatu (D-127)", () => {
  it("op underlays3d -> SET_UNDERLAYS_3D, neplatné sa zahodí (D-133 doplnok)", () => {
    expect(parseOps("underlays3d:0:;underlays3d:1:;underlays3d:x:").map(opToBridgeMessage)).toEqual([
      { type: "SET_UNDERLAYS_3D", show: false },
      { type: "SET_UNDERLAYS_3D", show: true },
    ]);
  });

  it("op planpos -> SET_PLAN_POSITION, neplatné sa zahodí (D-161 bod 8, #282)", () => {
    expect(parseOps("planpos:0:;planpos:1:;planpos:x:").map(opToBridgeMessage)).toEqual([
      { type: "SET_PLAN_POSITION", show: false },
      { type: "SET_PLAN_POSITION", show: true },
    ]);
  });

  it("op panels -> SET_PANELS, all len close, neplatné sa zahodí", () => {
    const raw = panelsOp({ all: "close", properties: "open" });
    expect(raw).toBe("panels:~all=close~properties=open:");
    expect(parseOps(raw).map(opToBridgeMessage)).toEqual([{ type: "SET_PANELS", panels: { all: "close", properties: "open" } }]);
    expect(parseOps("panels:~lens=toggle~model_tree=close:").map(opToBridgeMessage)).toEqual([
      { type: "SET_PANELS", panels: { lens: "toggle", model_tree: "close" } },
    ]);
    expect(parseOps("panels:~all=open~lens=hide:")).toEqual([]);
    expect(parseOps("panels:~all=open~bcf=close~bad!=open:").map(opToBridgeMessage)).toEqual([{ type: "SET_PANELS", panels: { bcf: "close" } }]);
  });

  it("2D výkres rezu (D-136): drawing ide na most ako ostatné panely", () => {
    expect(parseOps(panelsOp({ drawing: "open" })).map(opToBridgeMessage)).toEqual([{ type: "SET_PANELS", panels: { drawing: "open" } }]);
  });
});

describe("posun panela vlastností (D-146)", () => {
  it("op panel_scroll -> SCROLL_PANEL, neznámy smer sa zahodí", () => {
    expect(panelScrollOp("down")).toBe("panel_scroll:down:");
    expect(parseOps("panel_scroll:top:").map(opToBridgeMessage)).toEqual([{ type: "SCROLL_PANEL", direction: "top" }]);
    expect(parseOps("panel_scroll:left:")).toEqual([]);
    expect(parseOps("panel_scroll::")).toEqual([]);
  });
});

describe("posun a zoom obsahu panela, op a správa mosta (D-150)", () => {
  it("panel_scroll s panelom, položkou a percentom -> SCROLL_PANEL; zlý tvar sa zahodí", () => {
    expect(panelScrollOp({ panel: "bcf", item: "Dvere ~ D12; č=3" })).toBe("panel_scroll:-~p=bcf~i=Dvere%20%7E%20D12%3B%20%C4%8D%3D3:");
    const ops = parseOps(panelScrollOp({ panel: "bcf", item: "Dvere ~ D12; č=3" }));
    expect(ops.map(opToBridgeMessage)).toEqual([{ type: "SCROLL_PANEL", panel: "bcf", item: "Dvere ~ D12; č=3" }]);
    expect(parseOps(panelScrollOp({ panel: "lists", percent: 75 })).map(opToBridgeMessage)).toEqual([{ type: "SCROLL_PANEL", panel: "lists", percent: 75 }]);
    expect(parseOps("panel_scroll:-~pct=120:")).toEqual([]);
    expect(parseOps("panel_scroll:-~pct=abc:")).toEqual([]);
    expect(parseOps("panel_scroll:-:")).toEqual([]);
    expect(parseOps("panel_scroll:down~pct=5:")).toEqual([]);
    expect(parseOps("panel_scroll:-~i=%E0%A4%A:")).toEqual([]);
    expect(parseOps("panel_scroll:down~p=a%20b:")).toEqual([]);
  });

  it("panel_zoom -> ZOOM_PANEL, číslo len v rozsahu", () => {
    expect(panelZoomOp("in", "bcf")).toBe("panel_zoom:in~p=bcf:");
    expect(parseOps("panel_zoom:in~p=bcf:").map(opToBridgeMessage)).toEqual([{ type: "ZOOM_PANEL", zoom: "in", panel: "bcf" }]);
    expect(parseOps("panel_zoom:1.5:").map(opToBridgeMessage)).toEqual([{ type: "ZOOM_PANEL", zoom: 1.5 }]);
    expect(parseOps("panel_zoom:9:")).toEqual([]);
    expect(parseOps("panel_zoom:big:")).toEqual([]);
  });
});

