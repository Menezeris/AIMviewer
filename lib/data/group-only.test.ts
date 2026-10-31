import { describe, expect, it } from "vitest";

import { isGroupOnly } from "./group-only";

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
