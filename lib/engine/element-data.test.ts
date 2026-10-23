import { describe, expect, it } from "vitest";

import { shapeIfcElement } from "./element-data";

describe("shapeIfcElement (D-142)", () => {
  it("zloží Qto a psety z výskytu aj typu do plochého zoznamu so zdrojom", () => {
    const r = shapeIfcElement({
      model: "ASR",
      global_id: "G1",
      type: "IfcColumn",
      quantities: [{ name: "Qto_ColumnBaseQuantities", quantities: [{ name: "NetVolume", value: 0.9875 }] }],
      properties: [{ name: "Pset_ColumnCommon", properties: [{ name: "LoadBearing", value: true }] }],
      typeProperties: {
        name: "Stlp 350",
        properties: [{ name: "Pset_Manufacturer", properties: [{ name: "Name", value: "X" }] }],
        quantities: [{ name: "Qto_TypeQ", quantities: [{ name: "Height", value: 3 }] }],
      },
    });
    expect(r.quantities).toEqual([
      { qto: "Qto_ColumnBaseQuantities", name: "NetVolume", value: 0.9875, source: "occurrence" },
      { qto: "Qto_TypeQ", name: "Height", value: 3, source: "type" },
    ]);
    expect(r.properties.map((p) => `${p.source}:${p.pset}.${p.name}`)).toEqual([
      "occurrence:Pset_ColumnCommon.LoadBearing",
      "type:Pset_Manufacturer.Name",
    ]);
    expect(r).toMatchObject({ model: "ASR", ifc_type: "IfcColumn", type_name: "Stlp 350" });
  });

  it("bez Qto povie, že chýbajú, a nepadne na null typeProperties", () => {
    const r = shapeIfcElement({ type: "IfcWall", quantities: [], properties: [], typeProperties: null });
    expect(r.quantities).toEqual([]);
    expect(r.note).toContain("ifc_measure");
  });
});
