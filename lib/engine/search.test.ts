import { afterEach, describe, expect, it } from "vitest";

import { MINI_BUILDING_BYTES, guid } from "./__fixtures__/mini-building";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { editDistance, entityFields, normalizeText, searchEntities, type IndexedEntity } from "./search";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"mini"' } })) as typeof fetch;

/** AIM pozná len miestnosť 1.01 (ostatné sú "len v súbore"). */
const AIM: Record<string, AimRef> = {
  [guid("SPA")]: { object_id: "11111111-1111-1111-1111-111111111111", object_ref: "1.01", name: "1.01", object_type: "space" },
};

const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async () => new Map(),
  fetchImpl,
};

const run = async (input: Record<string, unknown>) => {
  const res = await execEngineTool("ifc_search", input, deps);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("ifc_search (D-095)", () => {
  afterEach(() => clearEngineCache());

  it("nájde LongName bez ohľadu na diakritiku, zdroj ifc+aim pri prvku z AIM", async () => {
    const r = await run({ text: "kancelária" });
    expect(r.isError).toBe(false);
    expect(r.json.source).toBe("ifc");
    expect(r.json.total).toBe(1);
    const [hit] = r.json.items;
    expect(hit.global_id).toBe(guid("SPA"));
    expect(hit.source).toBe("ifc+aim");
    expect(hit.object_ref).toBe("1.01");
    expect(hit.matched[0]).toMatchObject({ field: "attribute", path: "LongName", value: "Kancelaria" });
  });

  it("prvok len v súbore má source ifc a ide do show_in_3d.global_ids", async () => {
    const r = await run({ text: "ZASADACKA" });
    expect(r.json.items[0]).toMatchObject({ global_id: guid("SPC"), source: "ifc", object_ref: null });
    expect(r.json.unmapped).toBe(1);
    expect(r.json.show_in_3d).toEqual({ ids_or_refs: [], global_ids: [guid("SPC")] });
  });

  it("hľadá v Tag, psetoch a Qto; fields obmedzí časti", async () => {
    expect((await run({ text: "tagA" })).json.items[0].global_id).toBe(guid("WALA"));
    const pset = await run({ text: "loadbearing" });
    expect(pset.json.items[0].matched[0]).toMatchObject({ field: "property", path: "Pset_WallCommon.LoadBearing", value: "false" });
    expect((await run({ text: "NetFloorArea", fields: ["quantity"] })).json.total).toBe(3);
    expect((await run({ text: "NetFloorArea", fields: ["attribute"] })).json.total).toBe(0);
  });

  it("ifc_types filtruje vrátane podtried, preklep nájde fuzzy, bez fuzzy nie", async () => {
    const sub = await run({ text: "Sklad", ifc_types: ["IfcSpatialStructureElement"] });
    expect(sub.json.items.map((i: { global_id: string }) => i.global_id)).toEqual([guid("SPB")]);
    expect((await run({ text: "Kancelaria", ifc_types: ["IfcWall"] })).json.total).toBe(0);
    const typo = await run({ text: "kancelarja" });
    expect(typo.json.items[0]).toMatchObject({ global_id: guid("SPA"), match_kind: "fuzzy" });
    expect((await run({ text: "kancelarja", fuzzy: false })).json.total).toBe(0);
  });

  it("prázdny výsledok poradí druhý zdroj, zlý vstup je chyba toolu", async () => {
    const none = await run({ text: "karuselove" });
    expect(none.json.total).toBe(0);
    expect(none.json.hint).toContain("search_everything");
    expect((await run({ text: "x" })).isError).toBe(true);
    expect((await run({ text: "abc", fields: ["geometry"] })).content).toContain("fields");
  });
});

describe("search jadro", () => {
  it("normalizeText a editDistance", () => {
    expect(normalizeText("Prenajímateľné KARUSELOVÉ")).toBe("prenajimatelne karuselove");
    expect(editDistance("karuzelove", "karuselove", 2)).toBe(1);
    expect(editDistance("abc", "xyzuvw", 1)).toBe(2);
  });

  it("všetky slová musia sedieť, fráza má prednosť, typ aj výskyt z tvaru balíka", () => {
    const door = (gid: string, type: string, description: string): IndexedEntity => ({
      model: "ASR",
      express_id: 1,
      global_id: gid,
      ifc_type: type,
      name: gid,
      fields: entityFields({ attributes: [{ name: "Description", value: description }], materials: { name: "Hliník", constituents: [] } }),
    });
    const index = [door("A", "IfcDoor", "Karuselové dvere"), door("B", "IfcDoor", "dvere karuselové nie"), door("C", "IfcDoor", "Dvere otočné")];
    const hits = searchEntities(index, { text: "karuselove dvere", fuzzy: true });
    expect(hits.map((h) => h.global_id)).toEqual(["A", "B"]);
    expect(searchEntities(index, { text: "hlinik", fuzzy: false })[0].matched[0]).toMatchObject({ field: "material" });
  });
});
