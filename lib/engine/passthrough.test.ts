import { afterEach, describe, expect, it } from "vitest";
import { buildDefaultToolRegistry } from "@ifc-lite/mcp";

import { MINI_BUILDING_BYTES, guid } from "./__fixtures__/mini-building";
import { clearEngineCache } from "./cache";
import { collectGuids } from "./passthrough";
import { PASSTHROUGH_TOOLS, passthroughDefinitions } from "./passthrough-defs";
import { ENGINE_UPSTREAM_TOOLS } from "./session";
import { execEngineTool, type EngineDeps } from "./tools";

const fetchImpl = (async () => new Response(MINI_BUILDING_BYTES, { status: 200, headers: { etag: '"mini"' } })) as typeof fetch;
const deps: EngineDeps = {
  sources: () => [{ id: "MINI", label: "Mini", url: "https://example.test/mini.ifc" }],
  lookup: async (guids) =>
    new Map(
      guids
        .filter((g) => g === guid("WALA"))
        .map((g) => [g, { object_id: "22222222-2222-2222-2222-222222222222", object_ref: "W-A", name: "Wall A", object_type: "asset" }]),
    ),
  resolveTargets: async () => new Map(),
  fetchImpl,
};

describe("prevzaté tools @ifc-lite/mcp (D-087)", () => {
  afterEach(() => clearEngineCache());

  it("opis a parametre sú presne tie z balíka (stráž pri povýšení verzie)", () => {
    const registry = buildDefaultToolRegistry();
    for (const t of PASSTHROUGH_TOOLS) {
      const up = registry.get(t.upstream);
      expect(up, t.upstream).toBeDefined();
      expect(t.description, t.upstream).toBe(up!.description);
      const schema = up!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      expect(t.properties, t.upstream).toEqual(schema.properties);
      expect(t.required ?? [], t.upstream).toEqual(schema.required ?? []);
      expect(ENGINE_UPSTREAM_TOOLS as readonly string[], t.upstream).toContain(t.upstream);
    }
  });

  it("definície pre MCP: prefix ifc_, model_id z federácie a povinný", () => {
    const defs = passthroughDefinitions(["ASR", "VZT"]);
    const area = defs.find((d) => d.name === "ifc_geometry_area")!;
    expect(area.inputSchema).toMatchObject({ required: ["model_id"], properties: { model_id: { enum: ["ASR", "VZT"] } } });
    const schema = defs.find((d) => d.name === "ifc_schema_describe")!;
    expect(schema.inputSchema).toMatchObject({ required: ["type"] });
    expect((schema.inputSchema as { properties: object }).properties).not.toHaveProperty("model_id");
  });

  it("vykoná tool balíka nad modelom a GUIDy doplní o object_ref", async () => {
    const r = await execEngineTool("ifc_model_info", { model_id: "MINI" }, deps);
    expect(r.isError).toBe(false);
    const json = JSON.parse(r.content);
    expect(json).toMatchObject({ tool: "model_info", model: "MINI" });
    expect(json.result).toBeTruthy();

    const audit = await execEngineTool("ifc_model_audit", { model_id: "MINI" }, deps);
    expect(audit.isError).toBe(false);
    expect(JSON.parse(audit.content).tool).toBe("model_audit");

    const desc = await execEngineTool("ifc_schema_describe", { type: "IfcWall" }, deps);
    expect(desc.isError).toBe(false);
    expect(JSON.stringify(JSON.parse(desc.content).result)).toContain("IfcWall");
  });

  it("chýbajúci model a cudzie kľúče", async () => {
    expect((await execEngineTool("ifc_materials_list", {}, deps)).isError).toBe(true);
    const ok = await execEngineTool("ifc_materials_list", { model_id: "MINI", zlý_kľúč: 1 }, deps);
    expect(ok.isError).toBe(false);
  });

  it("GUIDy vo výsledku sa nájdu podľa mena kľúča", () => {
    const g = guid("WALA");
    expect([...collectGuids({ a: [{ globalId: g }, { global_id: g }], b: { GlobalId: "kratke" } })]).toEqual([g]);
  });
});
