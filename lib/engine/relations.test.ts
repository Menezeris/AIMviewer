import { afterEach, describe, expect, it } from "vitest";

import { guid } from "./__fixtures__/mini-building";
import { MINI_RELATIONS_BYTES } from "./__fixtures__/mini-relations";
import { clearEngineCache } from "./cache";
import type { AimRef } from "./join";
import { relKey } from "./relations";
import { ENGINE_TOOL_NAMES } from "./tool-defs";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_RELATIONS_BYTES, { status: 200, headers: { etag: '"rel"' } })) as unknown as typeof fetch;

/** AIM pozná len miestnosť 1.01 a zónu Z1 (ostatné sú "len v súbore", ako 40 z 64 zón na prode). */
const AIM: Record<string, AimRef> = {
  [guid("SPA")]: { object_id: "11111111-1111-1111-1111-111111111111", object_ref: "1.01", name: "1.01", object_type: "space" },
  [guid("ZN1")]: { object_id: "33333333-3333-3333-3333-333333333333", object_ref: "Najomne", name: "Najomne priestory", object_type: "zone" },
};

const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/rel.ifc" }],
  lookup: async (guids) => new Map(guids.filter((g) => AIM[g]).map((g) => [g, AIM[g]])),
  resolveTargets: async (targets) => new Map(targets.filter((t) => t === "Najomne").map((t) => [t, guid("ZN1")])),
  fetchImpl,
};

const run = async (input: Record<string, unknown>) => {
  const res = await execEngineTool("ifc_relations", input, deps);
  return { ...res, json: res.isError ? null : JSON.parse(res.content) };
};
const guids = (items: Array<{ global_id: string }>) => items.map((i) => i.global_id).sort();

describe("ifc_relations (D-097)", () => {
  afterEach(() => clearEngineCache());

  it("je registrovaný medzi tools motora", () => {
    expect(ENGINE_TOOL_NAMES.has("ifc_relations")).toBe(true);
  });

  it("členovia zóny cez object_ref, s prepojením na AIM", async () => {
    const r = await run({ target: "Najomne", rel_types: ["IfcRelAssignsToGroup"], direction: "forward" });
    expect(r.isError).toBe(false);
    expect(r.json.target).toMatchObject({ global_id: guid("ZN1"), ifc_type: "IfcZone", object_ref: "Najomne" });
    expect(r.json.total).toBe(3);
    expect(guids(r.json.items)).toEqual([guid("SPA"), guid("SPB"), guid("ZN2")].sort());
    const spa = r.json.items.find((i: { global_id: string }) => i.global_id === guid("SPA"));
    expect(spa).toMatchObject({ rel_type: "IfcRelAssignsToGroup", direction: "forward", ifc_type: "IfcSpace", object_ref: "1.01" });
    expect(r.json.unmapped).toBe(2);
    expect(r.json.show_in_3d.global_ids).toContain(guid("SPB"));
  });

  it("recursive rozvinie vnorenú zónu a nesie hĺbku a via", async () => {
    const r = await run({ target: guid("ZN1"), rel_types: ["AssignsToGroup"], direction: "forward", recursive: true });
    expect(r.json.total).toBe(4);
    const spc = r.json.items.find((i: { global_id: string }) => i.global_id === guid("SPC"));
    expect(spc).toMatchObject({ depth: 2, via: guid("ZN2") });
  });

  it("inverse = kam miestnosť patrí; bez filtra všetky vzťahy okrem psetov", async () => {
    const r = await run({ target: guid("SPA"), direction: "inverse" });
    const types = r.json.items.map((i: { rel_type: string }) => i.rel_type).sort();
    expect(types).toEqual(["IfcRelAggregates", "IfcRelAssignsToGroup"]);
    expect(r.json.counts).toHaveLength(2);
  });

  it("stránkovanie: next_cursor až do null, total a counts pre celý výsledok", async () => {
    const seen: string[] = [];
    let cursor: string | null = "0";
    let pages = 0;
    while (cursor !== null) {
      const r = await run({ target: guid("ST1"), direction: "forward", limit: 2, cursor });
      expect(r.json.total).toBe(5);
      seen.push(...r.json.items.map((i: { global_id: string }) => i.global_id));
      cursor = r.json.next_cursor;
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
  });

  it("through_ports: prvok napojený cez porty, s portmi oboch strán", async () => {
    const r = await run({ target: guid("DS1"), through_ports: true });
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toMatchObject({
      rel_type: "IfcRelConnectsPorts",
      global_id: guid("DMP"),
      ifc_type: "IfcDamper",
      via_port: guid("PT1"),
      port: guid("PT2"),
    });
    const back = await run({ target: guid("DMP"), through_ports: true });
    expect(back.json.items[0].global_id).toBe(guid("DS1"));
  });

  it("systém: členovia a spätne systém prvku", async () => {
    const members = await run({ target: guid("SYS"), direction: "forward" });
    expect(guids(members.json.items)).toEqual([guid("DMP"), guid("DS1")].sort());
    const sys = await run({ target: guid("DS1"), rel_types: ["IfcRelAssignsToGroup"], direction: "inverse" });
    expect(sys.json.items[0]).toMatchObject({ global_id: guid("SYS"), name: "Privod-1NP" });
  });

  it("chybné vstupy sa vrátia ako chyba toolu", async () => {
    expect((await run({})).isError).toBe(true);
    expect((await run({ target: guid("ZN1"), recursive: true })).content).toContain("direction");
    expect((await run({ target: "NEEXISTUJE" })).content).toContain("GlobalId");
    expect((await run({ target: guid("XXXX") })).content).toContain("nie je v");
    expect((await run({ target: guid("ZN1"), rel_types: ["bad type!"] })).isError).toBe(true);
  });

  it("relKey zjednotí zápisy triedy vzťahu", () => {
    expect(["IfcRelAssignsToGroup", "IFCRELASSIGNSTOGROUP", "AssignsToGroup", "RelAssignsToGroup"].map(relKey)).toEqual(
      Array(4).fill("relassignstogroup"),
    );
  });
});
