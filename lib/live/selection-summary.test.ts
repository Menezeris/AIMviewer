import { describe, expect, it } from "vitest";

import { MAX_SELECTION_GUIDS, lookupGuidsFor, summarizeSelection, type SelectionContext } from "./selection-summary";

const guids = (n: number, prefix = "G") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("výber z viewera pre get_viewer_state (D-093)", () => {
  it("orezaný výber povie truncated, covers=returned a varovanie v note", () => {
    const s = summarizeSelection({ count: 1810, guids: guids(50) }, new Map());
    expect(s).toMatchObject({ count: 1810, returned: 50, truncated: true, items_total: 50 });
    expect(s.summary.covers).toBe("returned");
    expect(s.note).toContain("len 50 z 1810");
  });

  it("celý výber so súhrnom podľa triedy, podlažia, zostavy a modelu z viewera", () => {
    const items = [
      ...guids(3, "P").map((guid) => ({ guid, ifc_type: "IfcPlate", storey: "1NP", model: "ASR", parent_guid: "CW1", parent_type: "IfcCurtainWall" })),
      ...guids(2, "M").map((guid) => ({ guid, ifc_type: "IfcMember", storey: "2NP", model: "ASR", parent_guid: "CW2", parent_type: "IfcCurtainWall" })),
    ];
    const ctx: SelectionContext = new Map([
      ["CW1", { object_id: "o1", object_ref: "I1-V.01", name: "I1-V.01", ifc_type: "IfcCurtainWall", floor: "1NP", parent: null }],
    ]);
    const s = summarizeSelection({ count: 5, guids: items.map((i) => i.guid), items }, ctx);
    expect(s.truncated).toBe(false);
    expect(s.summary.covers).toBe("all");
    expect(s.summary.by_ifc_type).toEqual([
      { key: "IfcPlate", count: 3 },
      { key: "IfcMember", count: 2 },
    ]);
    expect(s.summary.by_floor.map((g) => g.key)).toEqual(["1NP", "2NP"]);
    expect(s.summary.by_parent).toEqual([
      { key: "IfcCurtainWall I1-V.01", count: 3 },
      { key: "IfcCurtainWall CW2", count: 2 },
    ]);
    expect(s.summary.by_model).toEqual([{ key: "ASR", count: 5 }]);
    expect(s.items[0]).toMatchObject({ guid: "P0", ifc_type: "IfcPlate", floor: "1NP", in_aim: false });
    expect(s.items[0].parent).toMatchObject({ guid: "CW1", object_ref: "I1-V.01" });
  });

  it("bez údajov z viewera doplní triedu, podlažie a zostavu z AIM", () => {
    const ctx: SelectionContext = new Map([
      ["A", { object_id: "a", object_ref: "DD01.06.03", name: "Dvere", ifc_type: "IfcDoor", floor: "2NP", parent: null }],
    ]);
    const s = summarizeSelection({ count: 2, guids: ["A", "B"] }, ctx);
    expect(s.items[0]).toMatchObject({ guid: "A", object_ref: "DD01.06.03", ifc_type: "IfcDoor", floor: "2NP", in_aim: true });
    expect(s.items[1]).toMatchObject({ guid: "B", ifc_type: null, in_aim: false });
    expect(s.summary.by_floor).toEqual([
      { key: "(neznáme)", count: 1 },
      { key: "2NP", count: 1 },
    ]);
    expect(s.summary.in_aim).toBe(1);
    expect(s.note).toContain("AIM nepozná");
  });

  it("stránkuje položky, súhrn ostáva za celý výber", () => {
    const s = summarizeSelection({ count: 120, guids: guids(120) }, new Map(), { items_offset: 50, items_limit: 30 });
    expect(s.items.map((i) => i.guid)).toEqual(guids(80).slice(50));
    expect(s.items_offset).toBe(50);
    expect(s.summary.of).toBe(120);
    expect(s.note).toContain("items_offset=80");
    expect(summarizeSelection({ guids: guids(500) }, new Map(), { items_limit: 9999 }).items).toHaveLength(200);
  });

  it("prázdny výber a strop GUID", () => {
    expect(summarizeSelection({}, new Map())).toMatchObject({ count: 0, returned: 0, truncated: false, items: [] });
    const big = summarizeSelection({ count: 9000, guids: guids(9000) }, new Map());
    expect(big.returned).toBe(MAX_SELECTION_GUIDS);
    expect(big.truncated).toBe(true);
  });

  it("AIM lookup ide aj na rodičov, ktorých poslal viewer", () => {
    expect(lookupGuidsFor({ guids: ["P0", "P0"], items: [{ guid: "P0", parent_guid: "CW1" }] })).toEqual(["P0", "CW1"]);
  });
});
