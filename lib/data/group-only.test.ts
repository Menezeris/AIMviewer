import { describe, expect, it } from "vitest";

import { isGroupOnly, treeEdges } from "./group-only";

describe("isGroupOnly (D-049, D-183 K3)", () => {
  it("potrubie a tvarovky sú len v systéme", () => {
    expect(isGroupOnly({ object_type: "asset", ifc_type: "IfcDuctSegment" })).toBe(true);
    expect(isGroupOnly({ object_type: "asset", ifc_type: "IfcDuctFitting" })).toBe(true);
  });
  it("vyústka, klapka a jednotka ostávajú v strome", () => {
    for (const t of ["IfcAirTerminal", "IfcDamper", "IfcUnitaryEquipment", null]) {
      expect(isGroupOnly({ object_type: "asset", ifc_type: t })).toBe(false);
    }
  });
  it("platí len pre prvky", () => {
    expect(isGroupOnly({ object_type: "system", ifc_type: "IfcDuctSegment" })).toBe(false);
  });
});

describe("treeEdges (D-183 K3)", () => {
  const byId = new Map([
    ["F", { object_type: "floor" }],
    ["S", { object_type: "space" }],
    ["ST", { object_type: "asset" }],
    ["R", { object_type: "asset" }],
  ]);
  it("časť zostavy (asset) má rodiča len z umiestnenia, štruktúra z agregácie", () => {
    const agg = [
      { from_id: "S", to_id: "F" },
      { from_id: "R", to_id: "ST" }, // zábradlie v schodisku
      { from_id: null, to_id: "ST" }, // rameno bez uzla AIM
    ];
    const contained = [
      { from_id: "ST", to_id: "F" },
      { from_id: "R", to_id: "F" },
      { from_id: "X", to_id: "F" }, // mimo grafu
      { from_id: "ST", to_id: null },
    ];
    expect(treeEdges(agg, contained, byId)).toEqual([
      ["S", "F"],
      ["ST", "F"],
      ["R", "F"],
    ]);
  });
});
