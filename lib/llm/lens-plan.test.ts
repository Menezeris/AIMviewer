import { describe, expect, it } from "vitest";

import { autoColorSpec, exactNamesRegex, lensGroup } from "./lens-plan";
import { StyleInputError } from "./style-plan";

describe("lens-plan (D-096)", () => {
  it("všetky kritériá v jednej skupine AND, v poradí trieda, podlažie, systém...", () => {
    const g = lensGroup({
      types: ["IfcDuctFitting", "IfcDuctFitting"],
      predefinedType: "bend",
      storeys: ["1NP"],
      systemNames: ["Prívod-1NP", "Prívod-2NP"],
      model: "VZT",
      zoneIds: ["z"],
    });
    expect(g.combinator).toBe("AND");
    expect(g.rules.map((r) => r.kind)).toEqual(["ifcType", "predefinedType", "storey", "group", "model", "aim_zone"]);
    expect(g.rules[0]).toEqual({ kind: "ifcType", op: "in", values: ["IfcDuctFitting"] });
    expect(g.rules[1]).toMatchObject({ values: ["BEND"] });
    expect(g.rules[3]).toMatchObject({ groupClass: "IfcSystem", op: "matches", valueKind: "regex" });
  });

  it("presné mená systémov ako regex s escapovaním", () => {
    const re = new RegExp(exactNamesRegex(["Prívod-1NP", "a.b (c)"]));
    expect(re.test("Prívod-1NP")).toBe(true);
    expect(re.test("a.b (c)")).toBe(true);
    expect(re.test("Prívod-1NP2")).toBe(false);
    expect(re.test("axb (c)")).toBe(false);
  });

  it("vlastnosť: dedičnosť z typu, bez psetu regex na všetky, boolean porovnanie", () => {
    const [p] = lensGroup({ types: [], property: { name: "LoadBearing", value: "TRUE" } }).rules;
    expect(p).toMatchObject({ kind: "property", setName: ".*", setNameKind: "regex", inherit: "type", comparison: { caseMode: "lensBoolean" } });
    const [q] = lensGroup({ types: [], property: { pset: "Pset_WallCommon", name: "FireRating", value: "EI 60" } }).rules;
    expect(q).toMatchObject({ setName: "Pset_WallCommon", comparison: { caseMode: "fold" } });
    expect(q).not.toHaveProperty("setNameKind");
  });

  it("bez systému, konkrétne prvky, text; prázdny filter je chyba", () => {
    const g = lensGroup({ types: [], notInSystem: true, guids: ["G"], query: "VZT" });
    expect(g.rules).toEqual([
      { kind: "group", groupClass: "IfcSystem", op: "isNotSet", value: "" },
      { kind: "name", op: "contains", value: "VZT" },
      { kind: "globalId", op: "in", values: ["G"] },
    ]);
    expect(() => lensGroup({ types: [] })).toThrow(StyleInputError);
  });

  it("color_by -> autoColor", () => {
    expect(autoColorSpec("system")).toEqual({ source: "group" });
    expect(autoColorSpec("ifc_type")).toEqual({ source: "ifcType" });
    expect(autoColorSpec("property", "Pset_WallCommon.FireRating")).toEqual({
      source: "property",
      psetName: "Pset_WallCommon",
      propertyName: "FireRating",
    });
    expect(autoColorSpec("attribute", "ObjectType")).toEqual({ source: "attribute", propertyName: "ObjectType" });
    expect(() => autoColorSpec("property", "FireRating")).toThrow(/Pset/);
    expect(() => autoColorSpec("bogus")).toThrow(StyleInputError);
  });
});
