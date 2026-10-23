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

  it("neznámy stĺpec vráti chybu s nápovedou", () => {
    expect(() => parseListColumn("cena")).toThrow(/nepoznám/);
  });
});
