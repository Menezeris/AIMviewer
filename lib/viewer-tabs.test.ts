import { describe, expect, it } from "vitest";

import { docOp, opToBridgeMessage, parseOps } from "./viewer-ops";
import { parseTabsOp, sectionBoxAroundOp, sectionBoxOp, tabOp } from "./viewer-tabs";
import { planSectionBox, planViewTabs } from "./llm/view-tabs";

const G = "27hbQtAoP6qvoEYhPARoI7";
const bridge = (ops: string) => parseOps(ops).map(opToBridgeMessage);

describe("záložky viewera, op tab a section_box (D-132)", () => {
  it("tab: menovka s dvojbodkou a bodkočiarkou prejde wire formátom", () => {
    const op = tabOp("activate", { tab: "Rez A-A: schody; 1NP" });
    expect(bridge(op)).toEqual([{ type: "VIEW_TABS", action: "activate", tab: "Rez A-A: schody; 1NP" }]);
    expect(bridge(tabOp("unbeside"))).toEqual([{ type: "VIEW_TABS", action: "unbeside" }]);
    expect(bridge(tabOp("open", { open: { kind: "view", viewId: "v1", label: "Detail", locked: true }, beside: true }))).toEqual([
      { type: "VIEW_TABS", action: "open", open: { kind: "view", viewId: "v1", label: "Detail", locked: true }, beside: true },
    ]);
  });

  it("tab: neplatná akcia, chýbajúci odkaz alebo pokazený JSON sa zahodí", () => {
    expect(parseTabsOp("tab", "move", "")).toBeNull();
    expect(parseTabsOp("tab", "activate", "")).toBeNull();
    expect(parseTabsOp("tab", "activate", "%%%")).toBeNull();
    expect(bridge(tabOp("open", { open: { kind: "view", viewId: "v1" } }))).toEqual([]);
    expect(bridge(tabOp("open", { open: { kind: "plan", storeyGuid: G } }))).toEqual([
      { type: "VIEW_TABS", action: "open", open: { kind: "plan", storeyGuid: G } },
    ]);
  });

  it("section_box: okolo prvkov s okrajom alebo presná obálka; prevrátená obálka neprejde", () => {
    expect(bridge(sectionBoxAroundOp([G], 0.5))).toEqual([{ type: "SET_SECTION_BOX", guids: [G], marginM: 0.5 }]);
    expect(bridge(sectionBoxAroundOp([G]))).toEqual([{ type: "SET_SECTION_BOX", guids: [G] }]);
    const box = { min: { x: -1.2344, y: 0, z: 0 }, max: { x: 2, y: 3, z: 4 } };
    expect(sectionBoxOp(box)).toBe("section_box:-1.234,0,0,2,3,4:");
    expect(bridge("section_box:2,0,0,1,3,4:")).toEqual([]);
    expect(bridge("section_box:1,2,3:")).toEqual([]);
    expect(bridge(`section_box:25:${G}`)).toEqual([{ type: "SET_SECTION_BOX", guids: [G] }]);
  });

  it("doc: layout split ide do DOCUMENT_OPEN, bez neho záložka", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(docOp(id, 2, undefined, undefined, "split")).toBe(`doc:2~l=s:${id}`);
    expect(bridge(docOp(id, 2, undefined, undefined, "split"))).toEqual([{ type: "DOCUMENT_OPEN", documentId: id, page: 2, layout: "split" }]);
    expect(bridge(docOp(id))).toEqual([{ type: "DOCUMENT_OPEN", documentId: id }]);
  });

  it("set_view_mode tab / beside / close_tab: poradie, none zruší Vedľa, nekombinuje sa s mode", () => {
    const plan = planViewTabs({ tab: "3D", beside: "TS.pdf", close_tab: "all" });
    expect(plan.ops.flatMap(bridge)).toEqual([
      { type: "VIEW_TABS", action: "activate", tab: "3D" },
      { type: "VIEW_TABS", action: "beside", tab: "TS.pdf" },
      { type: "VIEW_TABS", action: "close", tab: "all" },
    ]);
    expect(planViewTabs({ beside: "none" }).ops.flatMap(bridge)).toEqual([{ type: "VIEW_TABS", action: "unbeside" }]);
    expect(() => planViewTabs({ tab: "3D", mode: "2d" })).toThrow("nekombinujú");
    expect(() => planViewTabs({ tab: "" })).toThrow("tab");
  });

  it("set_section box: cieľ povinný, okraj v rozsahu, predvolene 0,5 m", () => {
    expect(planSectionBox({}, [G]).ops).toEqual([`section_box:0.5:${G}`]);
    expect(planSectionBox({ margin_m: 0 }, [G]).result).toMatchObject({ margin_m: 0 });
    expect(() => planSectionBox({}, [])).toThrow("cieľ");
    expect(() => planSectionBox({ margin_m: 30 }, [G])).toThrow("margin_m");
  });
});
