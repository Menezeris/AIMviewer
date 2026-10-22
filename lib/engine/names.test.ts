import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MINI_BUILDING_BYTES, guid } from "./__fixtures__/mini-building";
import { MINI_CEILING_BYTES } from "./__fixtures__/mini-ceiling";
import { pickUnique } from "./aim-lookup";
import { clearEngineCache } from "./cache";
import { ceilingFromCoverings, storeyCeiling, weightedMedian } from "./ceiling";
import { findByNames } from "./names";
import { buildNameIndex, editDistance, looksLikeCode, searchEntities, type IndexedEntity } from "./search";

const fetchImpl = (async () => new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"mini"' } })) as typeof fetch;
const opts = { sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" }], fetchImpl };

const entity = (name: string, tag?: string): IndexedEntity => ({
  model: "M",
  express_id: name.length,
  global_id: `g-${name}`,
  ifc_type: "IfcStairFlight",
  name,
  fields: [
    { field: "attribute", path: "Name", value: name, norm: name.toLowerCase(), words: name.toLowerCase().split(/[^a-z0-9]+/) },
    ...(tag ? [{ field: "attribute" as const, path: "Tag", value: tag, norm: tag, words: [tag] }] : []),
  ],
});

describe("hľadanie podľa kódu (D-102)", () => {
  afterEach(() => clearEngineCache());

  it("kód s číslicou sa nehľadá s preklepom: SD04 nenájde SD03", () => {
    const index = [entity("SD03.0001"), entity("SD04.0001")];
    const hits = searchEntities(index, { text: "SD04.0001", fuzzy: true });
    expect(hits.map((h) => h.name)).toEqual(["SD04.0001"]);
    expect(editDistance("karuselove", "karuselovy", 2)).toBe(1);
    expect(editDistance("abc", "abd", 1)).toBe(1);
    expect(editDistance("abcdef", "a", 1)).toBe(2);
  });

  it("index mien: meno aj Tag, bez diakritiky a veľkosti písmen", () => {
    const ni = buildNameIndex([entity("SD04.0001", "772"), entity("Schodisko")]);
    expect(ni.get("sd04.0001")?.map((e) => e.global_id)).toEqual(["g-SD04.0001"]);
    expect(ni.get("772")?.map((e) => e.global_id)).toEqual(["g-SD04.0001"]);
    expect(ni.get("schodisko")).toHaveLength(1);
  });

  it("looksLikeCode: kódy áno, slová nie", () => {
    for (const c of ["SD04.0001", "VV.03.01.040", "PD02.31.07", "JV.01.02.001", "SC01"]) expect(looksLikeCode(c)).toBe(true);
    for (const w of ["nosná stena", "schodisko", "3.02"]) expect(looksLikeCode(w)).toBe(false);
  });

  it("findByNames nájde prvok podľa mena aj Tagu v súbore", async () => {
    const hits = await findByNames(["1.02", "tagA", "neexistuje"], opts);
    expect(hits.get("1.02")).toEqual([
      { global_id: guid("SPB"), ifc_type: "IfcSpace", model: "MINI", name: "1.02", storey: { name: "1NP", global_id: guid("ST1") } },
    ]);
    // D-115 (eval D7): podlažie aj pre prvok len v súbore, tu cez IfcRelContainedInSpatialStructure.
    expect(hits.get("tagA")?.[0]).toMatchObject({ global_id: guid("WALA"), storey: { name: "1NP" } });
    expect(hits.has("neexistuje")).toBe(false);
  });

  it("pickUnique: jednoznačný kód -> GUID, viacznačný = chyba s kandidátmi", () => {
    expect(pickUnique(new Map([["A", [{ guid: "g1", label: "x" }, { guid: "g1", label: "x" }]]]))).toEqual(new Map([["A", "g1"]]));
    expect(() => pickUnique(new Map([["B", [{ guid: "g1", label: "IfcWall ASR" }, { guid: "g2", label: "IfcWall VZT" }]]]))).toThrow(
      /B: 2 prvkov.*g1.*g2/,
    );
  });
});

describe("podhľad podlažia (D-102)", () => {
  afterEach(() => clearEngineCache());

  it("medián FinishCeilingHeight miestností podlažia vážený plochou, v metroch", async () => {
    const c = await storeyCeiling("1NP", opts);
    expect(c).toMatchObject({
      source: "qto",
      bottom_m: 3.05,
      top_m: 3.05,
      coverings: 0,
      qto: { height_m: 3.05, min_m: 3.05, max_m: 3.05, spaces: 1 },
      model: "MINI",
    });
    expect(c?.warning).toMatch(/len z Qto/);
    expect(await storeyCeiling("2NP", opts)).toBeNull(); // miestnosť bez Qto výšky
    // Openspace 3,05 m (120 m2) prehlasuje WC 2,6 m (4 x 3 m2).
    const rooms = [{ value: 3.05, weight: 120 }, ...Array.from({ length: 4 }, () => ({ value: 2.6, weight: 3 }))];
    expect(weightedMedian(rooms)).toBe(3.05);
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 1 }, { value: 3, weight: 1 }])).toBe(2);
  });

  it("geometria IfcCovering CEILING má prednosť pred Qto, nezhoda sa hlási (D-140, #230)", async () => {
    const geo = {
      sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/ceil.ifc" }],
      fetchImpl: (async () => new Response(MINI_CEILING_BYTES, { status: 200, headers: { etag: '"ceil"' } })) as typeof fetch,
    };
    // 2.NP: úroveň 3,5 m, podhľad 6,6 až 6,613 m; Qto 3,05 m by dalo 6,55 m.
    const c = await storeyCeiling("2NP", geo);
    expect(c).toMatchObject({ source: "geometry", bottom_m: 3.1, top_m: 3.113, coverings: 1, qto: { height_m: 3.05 }, model: "MINI" });
    expect(c?.warning).toMatch(/Qto FinishCeilingHeight \(3.05 m\).*3.1 m.*o 0.05 m/);
    // 1NP nemá krytinu: záloha z Qto bez nezhody.
    expect(await storeyCeiling("1NP", geo)).toMatchObject({ source: "qto", bottom_m: 3.05 });
  });
  it("ceilingFromCoverings: vážený medián okrajov mínus úroveň podlažia", () => {
    const items = [
      { bottom: 8.05, top: 8.063, weight: 100 },
      { bottom: 7.2, top: 7.213, weight: 5 },
    ];
    expect(ceilingFromCoverings(items, 5)).toEqual({ bottom_m: 3.05, top_m: 3.063 });
    expect(ceilingFromCoverings([], 5)).toBeNull();
  });
});
