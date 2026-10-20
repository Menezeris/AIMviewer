import { describe, expect, it } from "vitest";

import { combineResults, execSearchAll, type AimSearchRow, type IfcSearchItem } from "./search-all";

const door: IfcSearchItem = {
  model: "ASR",
  global_id: "1_YiIDK5n2fvfP1VGIobML",
  ifc_type: "IfcDoor",
  name: "Dvere vstup",
  match_kind: "exact",
  matched: [{ field: "attribute", path: "Description", value: "Karuselové dvere" }],
  object_id: "00000000-0000-0000-0000-000000000001",
  object_ref: "DD01.08.0001",
  aim_url: "/node/00000000-0000-0000-0000-000000000001",
};
const zone: IfcSearchItem = {
  model: "ASR",
  global_id: "2abcdefghijklmnopqrstu",
  ifc_type: "IfcZone",
  name: "Nájomné priestory",
  match_kind: "exact",
  matched: [{ field: "attribute", path: "LongName", value: "Nájomné priestory (prenajímateľné)" }],
  object_id: null,
  object_ref: null,
  aim_url: null,
};
const aimDoor: AimSearchRow = {
  id: door.object_id as string,
  object_type: "asset",
  object_ref: "DD01.08.0001",
  name: "Dvere vstup",
  ifc_type: "IfcDoor",
  match_kind: "fuzzy",
  headline: "Karuselové",
  matched_properties: [{ pset: "AIM_Dvere", key: "Typ" }],
};
const aimDoc: AimSearchRow = {
  id: "00000000-0000-0000-0000-000000000002",
  object_type: "document",
  object_ref: "DOC-01",
  name: "Karuselové dvere - návod",
  ifc_type: null,
  match_kind: "exact",
  headline: null,
  matched_properties: null,
};

function run(input: Record<string, unknown>, ifc: IfcSearchItem[] = [door, zone], aim: AimSearchRow[] = [aimDoc, aimDoor]) {
  return execSearchAll(input, { ifc: async () => ({ items: ifc }), aim: async () => aim });
}

describe("combineResults", () => {
  it("spojí zhodu z oboch zdrojov do IFC+AIM, dá ju na začiatok, ostatné podľa poradia v zdroji", () => {
    const out = combineResults([door, zone], [aimDoc, aimDoor]);
    expect(out.map((i) => [i.badge, i.object_ref ?? i.name])).toEqual([
      ["IFC+AIM", "DD01.08.0001"],
      ["AIM", "DOC-01"], // 1. v AIM
      ["IFC", "Nájomné priestory"], // 2. v IFC
    ]);
    expect(out[0].evidence.ifc).toBeDefined();
    expect(out[0].evidence.aim).toBeDefined();
    expect(out[1].aim_url).toBe("/drawing/00000000-0000-0000-0000-000000000002");
  });

  it("IFC prvok, ktorý AIM pozná, ale text našlo len IFC, má badge IFC a object_ref", () => {
    const [item] = combineResults([door], []);
    expect(item.badge).toBe("IFC");
    expect(item.object_ref).toBe("DD01.08.0001");
  });
});

describe("execSearchAll", () => {
  it("vracia counts pred filtrom a filtruje podľa badges", async () => {
    const res = await run({ text: "karuselové", badges: ["IFC"] });
    const body = JSON.parse(res.content);
    expect(res.isError).toBe(false);
    expect(body.counts).toEqual({ IFC: 1, AIM: 1, "IFC+AIM": 1 });
    expect(body.items.map((i: { badge: string }) => i.badge)).toEqual(["IFC"]);
    expect(body.show_in_3d).toEqual({ ids_or_refs: [], global_ids: [zone.global_id] });
  });

  it("odmietne neznámy badge a krátky text", async () => {
    expect((await run({ text: "dvere", badges: ["DB"] })).isError).toBe(true);
    expect((await run({ text: "d" })).isError).toBe(true);
  });

  it("ifc_types zúži aj AIM časť", async () => {
    const body = JSON.parse((await run({ text: "karuselové", ifc_types: ["IfcDoor"] }, [door])).content);
    expect(body.items.map((i: { badge: string }) => i.badge)).toEqual(["IFC+AIM"]);
  });

  it("zlyhanie jedného zdroja vráti v errors, druhý ostane", async () => {
    const res = await execSearchAll(
      { text: "karuselové" },
      { ifc: async () => { throw new Error("model sa nenačítal"); }, aim: async () => ({ rows: [aimDoc], hint: "x" }) },
    );
    const body = JSON.parse(res.content);
    expect(res.isError).toBe(false);
    expect(body.errors.ifc).toContain("model sa nenačítal");
    expect(body.items.map((i: { badge: string }) => i.badge)).toEqual(["AIM"]);
  });

  it("chyba oboch zdrojov je chyba toolu", async () => {
    const fail = async () => { throw new Error("x"); };
    expect((await execSearchAll({ text: "dvere" }, { ifc: fail, aim: fail })).isError).toBe(true);
  });
});

describe("search_all source (D-115)", () => {
  it("source=ifc vráti len IFC časť s offset a fields, source=aim len graf AIM", async () => {
    let ifcInput: Record<string, unknown> = {};
    const ifcRes = await execSearchAll(
      { text: "karusel", source: "ifc", offset: 30, fields: ["attribute"], fuzzy: false },
      {
        ifc: async (input) => {
          ifcInput = input;
          return { items: [door] };
        },
        aim: async () => {
          throw new Error("AIM sa pri source=ifc nevolá");
        },
      },
    );
    expect(ifcRes.isError).toBe(false);
    expect(ifcInput).toMatchObject({ text: "karusel", offset: 30, fields: ["attribute"], fuzzy: false });
    expect(JSON.parse(ifcRes.content).items).toHaveLength(1);

    const aimRes = await execSearchAll(
      { text: "karusel", source: "aim" },
      { ifc: async () => { throw new Error("IFC sa pri source=aim nevolá"); }, aim: async () => [aimDoc] },
    );
    expect(JSON.parse(aimRes.content).result).toEqual([aimDoc]);
    expect((await run({ text: "karusel", source: "zle" })).isError).toBe(true);
  });

  it("fields a fuzzy idú aj do IFC časti spojeného hľadania", async () => {
    let ifcInput: Record<string, unknown> = {};
    await execSearchAll(
      { text: "karusel", fields: ["property"], fuzzy: false },
      { ifc: async (input) => ((ifcInput = input), { items: [] }), aim: async () => [] },
    );
    expect(ifcInput).toMatchObject({ fields: ["property"], fuzzy: false });
  });
});
