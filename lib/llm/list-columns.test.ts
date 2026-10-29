import { describe, expect, it } from "vitest";

import { parseListColumn } from "./list-columns";

describe("open_list: stĺpce (D-111)", () => {
  it("atribúty, priestor, materiál, pset a Qto zo slov", () => {
    expect(parseListColumn("name")).toEqual({ s: "attribute", k: "Name" });
    expect(parseListColumn("Podlažie")).toEqual({ s: "spatial", k: "Storey", l: "Podlažie" });
    expect(parseListColumn("material")).toEqual({ s: "material", k: "Material", l: "Material" });
    expect(parseListColumn("Pset_DoorCommon.FireRating")).toEqual({ s: "property", p: "Pset_DoorCommon", k: "FireRating" });
    expect(parseListColumn("Qto_DoorBaseQuantities.Width")).toEqual({ s: "quantity", p: "Qto_DoorBaseQuantities", k: "Width" });
  });

  it("D-171: stĺpce zo vzťahov IFC (#277) majú vlastnú úroveň a popis; space ostáva Container", () => {
    expect(parseListColumn("space_referenced")).toEqual({ s: "spatial", k: "Referenced", l: "Priestor (referenced)" });
    expect(parseListColumn("relation.rel_referenced_in_spatial_structure")).toEqual(parseListColumn("space_referenced"));
    expect(parseListColumn("Space_Boundary")).toEqual({ s: "spatial", k: "Boundary", l: "Hranica priestoru" });
    expect(parseListColumn("relation.rel_space_boundary")).toEqual(parseListColumn("space_boundary"));
    expect(parseListColumn("aggregate")).toEqual({ s: "spatial", k: "Aggregate", l: "Zostava (aggregate)" });
    expect(parseListColumn("space")).toEqual({ s: "spatial", k: "Container" });
  });

  it("D-174: odvodené väzby z DB sú host stĺpce, odlíšené od stĺpcov zo súboru", () => {
    expect(parseListColumn("space_derived")).toEqual({ s: "host", k: "derived_referenced", l: "Priestor (odvodený z DB)" });
    expect(parseListColumn("space_referenced_db")).toEqual(parseListColumn("derived_referenced"));
    expect(parseListColumn("space_boundary_derived")).toEqual({ s: "host", k: "derived_boundary", l: "Hranica priestoru (odvodená z DB)" });
    expect(parseListColumn("space_referenced").s).toBe("spatial");
  });

  it("neznámy stĺpec vráti chybu s nápovedou", () => {
    expect(() => parseListColumn("cena")).toThrow(/nepoznám/);
  });
});
