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

  it("prechod sieťou (D-110): stop_at trieda aj Trieda.PREDEFINED, cesta a path_show_in_3d", async () => {
    const ahu = await run({ target: guid("DS1"), through_ports: true, recursive: true, stop_at: ["IfcUnitaryEquipment"] });
    expect(ahu.isError).toBe(false);
    expect(ahu.json.reached).toEqual([
      expect.objectContaining({ global_id: guid("AHU"), ifc_type: "IfcUnitaryEquipment", steps: 4, path: [guid("DS1"), guid("DMP"), guid("DS2"), guid("FD1"), guid("AHU")] }),
    ]);
    expect(ahu.json.path_show_in_3d.global_ids).toHaveLength(5);
    // Obyčajná klapka DMP nie je požiarna: prechod ide cez ňu až po FD1 a ďalej nie.
    const fire = await run({ target: guid("DS1"), through_ports: true, recursive: true, stop_at: ["IfcDamper.FIREDAMPER"] });
    expect(fire.json.reached.map((r: { global_id: string; steps: number; predefined_type: string }) => [r.global_id, r.steps, r.predefined_type])).toEqual([
      [guid("FD1"), 3, "FIREDAMPER"],
    ]);
    expect(guids(fire.json.items)).toEqual([guid("DMP"), guid("DS2"), guid("FD1")].sort());
    // Trieda bez typu zastaví na prvej klapke.
    const any = await run({ target: guid("DS1"), through_ports: true, recursive: true, stop_at: ["IfcDamper"] });
    expect(any.json.reached.map((r: { global_id: string }) => r.global_id)).toEqual([guid("DMP")]);
  });

  it("prechod sieťou: max_steps oreže, bez stop_at celá sieť s hĺbkou a via", async () => {
    const short = await run({ target: guid("DS1"), through_ports: true, recursive: true, stop_at: ["IfcUnitaryEquipment"], max_steps: 2 });
    expect(short.json.reached).toEqual([]);
    expect(short.json.cut_off).toMatch(/max_steps/);
    const all = await run({ target: guid("AHU"), through_ports: true, recursive: true });
    expect(all.json.total).toBe(4);
    expect(all.json.items.find((i: { global_id: string }) => i.global_id === guid("DS1"))).toMatchObject({ depth: 4, via: guid("DMP") });
    expect(all.json.filter).not.toHaveProperty("rel_types");
    const bad = await run({ target: guid("DS1"), through_ports: true, stop_at: ["IfcDamper"] });
    expect(bad.isError).toBe(true);
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

describe("ifc_relations: priestorové väzby contained a referenced (D-167, #297)", () => {
  afterEach(() => clearEngineCache());

  /** Odvodené geometriou (D-080): VZT prvok je v IfcSpace z iného modelu, v súbore tá hrana nie je. */
  const derived = (g: string) =>
    g === guid("SPC")
      ? [{ direction: "forward" as const, global_id: guid("DS1"), ifc_type: "IfcDuctSegment", name: "Potrubie 1", role: "inside" }]
      : g === guid("DS1")
        ? [{ direction: "inverse" as const, global_id: guid("SPC"), ifc_type: "IfcSpace", name: "2.01", role: "inside" }]
        : [];
  const withDerived = async (input: Record<string, unknown>) => {
    const res = await execEngineTool("ifc_relations", input, { ...deps, spatialLinks: async (g) => derived(g) });
    return JSON.parse(res.content);
  };

  it("hrana zo súboru nesie kind (contained | referenced)", async () => {
    const r = await run({ target: guid("DS2"), direction: "inverse", rel_types: ["IfcRelReferencedInSpatialStructure"] });
    expect(r.json.items).toMatchObject([{ rel_type: "IfcRelReferencedInSpatialStructure", kind: "referenced", global_id: guid("SPC") }]);
    const c = await run({ target: guid("DS1"), direction: "inverse", rel_types: ["IfcRelContainedInSpatialStructure"] });
    expect(c.json.items).toMatchObject([{ kind: "contained", global_id: guid("ST1") }]);
  });

  it("miestnosť vráti aj odvodené referenced prvky, s kind a derived, bez duplicity so súborom", async () => {
    const r = await withDerived({ target: guid("SPC"), direction: "forward", rel_types: ["IfcRelReferencedInSpatialStructure"] });
    expect(r.items.map((i: { global_id: string }) => i.global_id).sort()).toEqual([guid("DS1"), guid("DS2")].sort());
    expect(r.items.find((i: { global_id: string }) => i.global_id === guid("DS1"))).toMatchObject({ kind: "referenced", derived: true, role: "inside" });
    expect(r.items.find((i: { global_id: string }) => i.global_id === guid("DS2")).derived).toBeUndefined();
    const dup = await withDerived({ target: guid("DS2"), direction: "inverse", rel_types: ["IfcRelReferencedInSpatialStructure"] });
    expect(dup.total).toBe(1);
  });

  it("prvok vráti miestnosť cez odvodenú väzbu; bez spatialLinks sa nič nepridá; filter rel_types ju vynechá", async () => {
    const r = await withDerived({ target: guid("DS1"), direction: "inverse", rel_types: ["IfcRelReferencedInSpatialStructure"] });
    expect(r.items).toMatchObject([{ global_id: guid("SPC"), kind: "referenced", derived: true }]);
    const plain = await run({ target: guid("DS1"), direction: "inverse", rel_types: ["IfcRelReferencedInSpatialStructure"] });
    expect(plain.json.total).toBe(0);
    const other = await withDerived({ target: guid("DS1"), direction: "inverse", rel_types: ["IfcRelContainedInSpatialStructure"] });
    expect(other.items.every((i: { derived?: boolean }) => !i.derived)).toBe(true);
  });
});
