import { afterEach, describe, expect, it } from "vitest";

import { MINI_BUILDING_BYTES, guid } from "./__fixtures__/mini-building";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { normalizeStoreyLabel, resolveStorey } from "./storey";
import { execEngineTool, type EngineDeps } from "./tools";

const IDS_URL = "https://example.test/storey.ids";
const STOREY_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info><title>Test podlaží</title></info>
  <specifications>
    <specification name="Podlažie" identifier="IU-O-storey" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCBUILDINGSTOREY</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute>
          <name><simpleValue>Name</simpleValue></name>
          <value><xs:restriction base="xs:string"><xs:pattern value="[0-9]{1,2}\\.(NP|PP)"/></xs:restriction></value>
        </attribute>
      </requirements>
    </specification>
  </specifications>
</ids>`;

const fetchImpl = (async (url: string | URL | Request) => {
  if (String(url) === IDS_URL) return new Response(STOREY_IDS, { status: 200 });
  return new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"mini"' } });
}) as typeof fetch;

/** AIM pozná len miestnosť 1.01 a stenu (ostatné sú "len v súbore"). */
const AIM: Record<string, AimRef> = {
  [guid("SPA")]: { object_id: "11111111-1111-1111-1111-111111111111", object_ref: "1.01", name: "1.01", object_type: "space" },
  [guid("WALA")]: { object_id: "22222222-2222-2222-2222-222222222222", object_ref: "W-A", name: "Wall A", object_type: "asset" },
};

function deps(env: Record<string, string> = {}): EngineDeps {
  return {
    sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" }],
    lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
    resolveTargets: async (targets) => new Map(targets.filter((t) => t === "W-A").map((t) => [t, guid("WALA")])),
    env,
    fetchImpl,
  };
}

const run = async (name: string, input: Record<string, unknown>, d = deps()) => {
  const res = await execEngineTool(name, input, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};

describe("ifc_* tools (D-084 fáza 1)", () => {
  afterEach(() => clearEngineCache());

  it("ifc_query: číselný filter, prepojenie na AIM a pripravené show_in_3d", async () => {
    const r = await run("ifc_query", {
      model: "MINI",
      ifc_types: ["IfcSpace"],
      where: [{ pset: "Qto_SpaceBaseQuantities", name: "NetFloorArea", op: ">", value: 20 }],
    });
    expect(r.isError).toBe(false);
    expect(r.json.total).toBe(2);
    expect(r.json.unmapped).toBe(1);
    const byGuid = Object.fromEntries(r.json.items.map((i: { global_id: string }) => [i.global_id, i]));
    expect(byGuid[guid("SPA")].object_ref).toBe("1.01");
    expect(byGuid[guid("SPA")].aim_url).toBe("/node/11111111-1111-1111-1111-111111111111");
    expect(byGuid[guid("SPC")].object_ref).toBeNull();
    expect(r.json.show_in_3d).toEqual({
      ids_or_refs: ["11111111-1111-1111-1111-111111111111"],
      global_ids: [guid("SPC")],
    });
  });

  it("ifc_query: druhá podmienka ide cez selektor (AND)", async () => {
    const r = await run("ifc_query", {
      model: "MINI",
      ifc_types: ["IfcSpace"],
      where: [
        { pset: "Qto_SpaceBaseQuantities", name: "NetFloorArea", op: ">", value: 5 },
        { pset: "Qto_SpaceBaseQuantities", name: "NetFloorArea", op: "<", value: 30 },
      ],
    });
    expect(r.json.total).toBe(2);
  });

  it("ifc_query: podlažie podľa štítku AIM (1.NP = 1NP v modeli)", async () => {
    const r = await run("ifc_query", { model: "MINI", ifc_types: ["IfcWall"], storey: "1.NP" });
    expect(r.isError).toBe(false);
    expect(r.json.items.map((i: { global_id: string }) => i.global_id)).toEqual([guid("WALA")]);
  });

  it("ifc_query: neznáme podlažie vymenuje dostupné", async () => {
    const r = await run("ifc_query", { model: "MINI", storey: "7NP" });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("1NP");
  });

  it("ifc_count: zoskupenie podľa triedy a počet s podmienkou", async () => {
    const g = await run("ifc_count", { model: "MINI", group_by: "type" });
    expect(g.json.groups.find((x: { key: string }) => x.key === "IfcSpace").count).toBe(3);
    const w = await run("ifc_count", {
      model: "MINI",
      ifc_type: "IfcSpace",
      where: [{ pset: "Qto_SpaceBaseQuantities", name: "NetFloorArea", op: "<=", value: 8 }],
    });
    expect(w.json.total).toBe(1);
    const both = await run("ifc_count", { model: "MINI", group_by: "type", where: [{ pset: "A", name: "B", op: "exists" }] });
    expect(both.isError).toBe(true);
  });

  it("ifc_property_values: histogram hodnôt", async () => {
    const r = await run("ifc_property_values", { model: "MINI", ifc_type: "IfcWall", pset: "Pset_WallCommon", name: "LoadBearing" });
    expect(r.json.entities).toBe(1);
    expect(r.json.values).toEqual([{ value: "false", count: 1 }]);
  });

  it("ifc_get: cieľ cez object_ref aj priamo cez GUID, chýbajúci sa nahlási", async () => {
    const r = await run("ifc_get", { targets: ["W-A", guid("SPB"), "NEEXISTUJE"] });
    expect(r.isError).toBe(false);
    expect(r.json.items).toHaveLength(2);
    const wall = r.json.items.find((i: { global_id: string }) => i.global_id === guid("WALA"));
    expect(wall.object_ref).toBe("W-A");
    expect(JSON.stringify(wall.properties)).toContain("LoadBearing");
    expect(r.json.missing[0]).toContain("NEEXISTUJE");
  });

  it("ifc_ids_validate: bez registra jasná chyba, s registrom verdikt a nesplnené prvky", async () => {
    const none = await run("ifc_ids_validate", { model: "MINI", ids: "STOREY" });
    expect(none.isError).toBe(true);
    expect(none.content).toContain("IDS_SOURCES");

    const r = await run("ifc_ids_validate", { model: "MINI", ids: "STOREY" }, deps({ IDS_SOURCES: JSON.stringify({ STOREY: IDS_URL }) }));
    expect(r.isError).toBe(false);
    const spec = r.json.specifications[0];
    expect(spec.spec).toBe("IU-O-storey");
    expect(spec.status).toBe("fail");
    expect(spec.applicable).toBe(2);
    expect(spec.failures.map((f: { name: string }) => f.name)).toEqual(["1NP"]);
    expect(spec.failures[0].reasons.length).toBeGreaterThan(0);
    expect(r.json.ids.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chybný vstup sa vráti ako chyba toolu, nie výnimka", async () => {
    const r = await run("ifc_query", { model: "MINI", where: [{ pset: "bad name", name: "x", op: ">", value: 1 }] });
    expect(r.isError).toBe(true);
    const m = await run("ifc_query", { model: "XYZ", ifc_types: ["IfcWall"] });
    expect(m.content).toContain("nie je vo federácii");
  });
});

describe("podlažia (D-049)", () => {
  it("normalizácia štítkov", () => {
    expect(["3NP", "3.NP", "3. NP", "3np", "3NP_VZT"].map(normalizeStoreyLabel)).toEqual(Array(5).fill("3NP"));
    expect(resolveStorey("2NP", [{ globalId: "g1", name: "1NP" }, { globalId: "g2", name: "2.NP" }])).toBe("g2");
    expect(resolveStorey("9NP", [{ globalId: "g1", name: "1NP" }])).toBeNull();
  });
});
