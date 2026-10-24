import { describe, expect, it } from "vitest";

import { docOp, opToBridgeMessage, parseOps } from "./viewer-ops";
import { parseTabsOp, sectionBoxAroundOp, sectionBoxOp, tabOp } from "./viewer-tabs";
import { hasLayoutParams, planLayout, planSectionBox, planViewTabs } from "./llm/view-tabs";

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

describe("dlaždice, op tab:layout (D-157)", () => {
  const floors: Record<string, string> = { "1NP": G, "2NP": "0abcdefghijklmnopqrstu" };
  const floorGuid = async (ref: string) => (floors[ref] ? { guid: floors[ref], label: ref } : null);

  it("layout a tiles: podlažie ide ako GUID pôdorysu, ostatné ako menovka, none = prázdna", async () => {
    const plan = await planLayout({ layout: "three_left", tiles: ["3D", "1NP", "none"] }, floorGuid);
    expect(bridge(plan.ops.join(";"))).toEqual([
      { type: "VIEW_TABS", action: "layout", layout: "three_left", tiles: [{ tab: "3D" }, { plan: G }, null] },
    ]);
    expect(plan.result).toMatchObject({ ok: true, layout: "three_left", tiles: ["3D", "1NP", null] });
  });

  it("meno pohľadu z Presentation ide ako id pohľadu (D-161), podlažie a 3D majú prednosť", async () => {
    const views = [{ id: "v-uuid-1", name: "Rez A-A" }, { id: "v-uuid-2", name: "1NP" }, { id: "v-uuid-3", name: "3D" }];
    const plan = await planLayout({ layout: "split_h", tiles: ["3D", "rez a-a"] }, floorGuid, views);
    expect(bridge(plan.ops.join(";"))).toEqual([
      { type: "VIEW_TABS", action: "layout", layout: "split_h", tiles: [{ tab: "3D" }, { view: "v-uuid-1" }] },
    ]);
    expect(plan.result).toMatchObject({ tiles: ["3D", "Rez A-A"] });
    // Pohľad pomenovaný ako podlažie ostáva pôdorysom; neznáme meno ostáva menovkou záložky (dokument).
    const mixed = await planLayout({ tiles: ["1NP", "TS.pdf"] }, floorGuid, views);
    expect(bridge(mixed.ops.join(";"))[0]).toMatchObject({ tiles: [{ plan: G }, { tab: "TS.pdf" }] });
    expect(parseTabsOp("tab", "layout", "")).toBeNull();
  });

  it("tab a beside s menom pohľadu: viewer dostane id; 'none' a '3D' sa neprekladajú", () => {
    const views = [{ id: "v-uuid-1", name: "Rez A-A" }, { id: "v-uuid-3", name: "none" }];
    const plan = planViewTabs({ tab: "3D", beside: "Rez A-A" }, views);
    expect(plan.ops.flatMap(bridge)).toEqual([
      { type: "VIEW_TABS", action: "activate", tab: "3D" },
      { type: "VIEW_TABS", action: "beside", tab: "v-uuid-1" },
    ]);
    expect(plan.label).toContain("pohľad Rez A-A");
    expect(planViewTabs({ beside: "none" }, views).ops.flatMap(bridge)).toEqual([{ type: "VIEW_TABS", action: "unbeside" }]);
  });

  it("len tiles: rozloženie podľa počtu; single bez dlaždíc", async () => {
    const two = await planLayout({ tiles: ["3D", "2NP"] }, floorGuid);
    expect(bridge(two.ops.join(";"))[0]).toMatchObject({ layout: "split_h", tiles: [{ tab: "3D" }, { plan: "0abcdefghijklmnopqrstu" }] });
    expect((await planLayout({ tiles: ["3D", "A", "B", "C"] }, floorGuid)).result).toMatchObject({ layout: "grid4" });
    const single = await planLayout({ layout: "single" }, floorGuid);
    expect(bridge(single.ops.join(";"))).toEqual([{ type: "VIEW_TABS", action: "layout", layout: "single" }]);
  });

  it("chybný vstup: neznáme rozloženie, viac dlaždíc ako rozloženie, kombinácia s tab", async () => {
    await expect(planLayout({ layout: "2x2" }, floorGuid)).rejects.toThrow(/layout/);
    await expect(planLayout({ layout: "split_v", tiles: ["3D", "1NP", "2NP"] }, floorGuid)).rejects.toThrow(/2 dlaždice/);
    await expect(planLayout({ tiles: ["a", "b", "c", "d", "e"] }, floorGuid)).rejects.toThrow(/1 až 4/);
    await expect(planLayout({ layout: "split_h", tab: "3D" }, floorGuid)).rejects.toThrow(/nekombinujú/);
    expect(hasLayoutParams({ tiles: [] })).toBe(true);
    expect(hasLayoutParams({ tab: "3D" })).toBe(false);
  });

  it("wire: neplatné rozloženie alebo dlaždica sa zahodí", () => {
    expect(parseTabsOp("tab", "layout", "")).toBeNull();
    expect(bridge(tabOp("layout", { layout: "grid9" as never }))).toEqual([]);
    expect(bridge(tabOp("layout", { layout: "split_h", tiles: [{ tab: "3D" }, { tab: "1" }, { tab: "2" }] }))).toEqual([]);
    expect(bridge(tabOp("layout", { layout: "split_h", tiles: [{ x: 1 } as never] }))).toEqual([]);
  });
});
