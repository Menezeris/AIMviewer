import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { GeorefCalibration } from "../data/georef";

import { topicInScope, type EntityScope } from "./entity-scope";
import type { RegionElement, Vec3 } from "./region-model";
import { DOC_ID, G1, G2, deps, memoryStore } from "./testing";
import { BCF_TOOL_DEFINITIONS, execBcfTool, type BcfDeps } from "./tools";

const run = async (name: string, args: Record<string, unknown>, d: BcfDeps) => {
  const res = await execBcfTool(name, args, d);
  return { ...res, json: res.isError ? null : JSON.parse(res.text) };
};

/** Strana 2: celá strana = x 0..10 m, y 0..5 m na podlaží z = 3. */
const CAL: GeorefCalibration = {
  page: 2,
  page_size: [842, 595],
  storey_guid: "1NPguid000000000000000",
  storey_z: 3,
  plane: null,
  affine: [10 / 842, 0, 0, 0, 5 / 595, 0],
  calibration: [
    { pdf_pt: [0, 0], ifc_m: [0, 0] },
    { pdf_pt: [842, 595], ifc_m: [10, 5] },
  ],
  source: "auto",
  quality: { method: "icp", median_mm: 12, p90_mm: 25, cv_max_mm: 18, start_points: 9 },
};

function box(globalId: string, ifcType: string, min: Vec3, max: Vec3): RegionElement {
  const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  const faces = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  return { globalId, ifcType, name: `${ifcType} ${globalId}`, model: "ASR", positions: c.flat(), indices: faces.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]), min, max };
}

// Oblasť témy: ľavá polovica strany = x 0..5 m.
const ELEMENTS = [
  box("wallLeft00000000000000", "IfcWall", [1, 1, 3], [4, 1.2, 6]),
  box("doorLeft00000000000000", "IfcDoor", [2, 1, 3], [3, 1.2, 5.1]),
  box("wallRight0000000000000", "IfcWall", [6, 1, 3], [9, 1.2, 6]),
  box("upperWall0000000000000", "IfcWall", [1, 1, 6.2], [4, 1.2, 9]),
  box("room10100000000000000a", "IfcSpace", [0.5, 0.5, 3], [4.5, 4.5, 5.9]),
];

async function setup(opts: { calibrated?: boolean; viewpoint?: boolean } = {}) {
  const m = memoryStore([{ title: "Chýba dverný prah", components: [G1], ...(opts.viewpoint ? { viewpoint: { guid: "old", source: "viewer" } } : {}) }]);
  const doc = await m.store.addDocument({
    task_id: m.rows[0].id,
    document_id: DOC_ID,
    document_ref: "D.1.1.09",
    document_name: "Pôdorys 1NP",
    document_revision: "B",
    page: 2,
    region: { x: 0, y: 0, width: 50, height: 100 },
    markup: null,
    url: null,
    description: null,
    author: "a",
    document_sha256: null,
  });
  if (opts.calibrated !== false) m.georefs.set(DOC_ID, { version: 2, calibrations: [CAL] });
  const regionModel = vi.fn(async () => ({ elements: ELEMENTS, elevations: [0, 3, 6, 9] }));
  return { ...m, doc, regionModel, d: deps({ store: m.store, regionModel }) };
}

describe("bcf_topic action=locate (D-158 krok 4)", () => {
  it("návrh: prvky v oblasti na podlaží, priestory a podlažie ako nadradené, pohľad nad oblasťou; nič nezapíše", async () => {
    const s = await setup();
    const r = await run("bcf_topic", { action: "locate", guid: "#1" }, s.d);
    expect(r.isError).toBe(false);
    expect(r.json.components.global_ids).toEqual(["doorLeft00000000000000", "wallLeft00000000000000"]);
    expect(r.json.components.by_type).toEqual({ IfcDoor: 1, IfcWall: 1 });
    expect(r.json.parents).toEqual({
      storey: CAL.storey_guid,
      spaces: [{ global_id: "room10100000000000000a", name: "IfcSpace room10100000000000000a", inside: 1 }],
    });
    expect(r.json.calibration).toMatchObject({ kind: "plan", source: "auto", median_mm: 12, storey_z: 3, storey_top: 6 });
    expect(r.json.region_ifc).toMatchObject({ center: [2.5, 2.5, 3], size_m: [5, 5] });
    expect(r.json.viewpoint.perspective_camera).toBeDefined();
    expect(r.json.viewpoint.clipping_planes[0].location.z).toBe(5.9);
    expect(r.json.applied).toBeUndefined();
    expect(s.rows[0].components).toEqual([G1]);
    expect(s.rows[0].viewpoint).toBeNull();
  });

  it("apply=all: prvky sa pridajú k doterajším, pohľad sa uloží v tvare BCF; podlažie a priestory len s include_parents", async () => {
    const s = await setup();
    const r = await run("bcf_topic", { action: "locate", guid: s.rows[0].id, apply: "all" }, s.d);
    expect(r.json.applied).toEqual({ components_added: 2, viewpoint_saved: true, note: null });
    expect(s.rows[0].components).toEqual([G1, "doorLeft00000000000000", "wallLeft00000000000000"]);
    expect(s.rows[0].viewpoint).toMatchObject({ source: "bcf", from_document: s.doc.id, bcf: { perspective_camera: expect.any(Object) } });
    await run("bcf_topic", { action: "locate", guid: "#1", apply: "components", include_parents: true }, s.d);
    expect(s.rows[0].components).toContain(CAL.storey_guid);
    expect(s.rows[0].components).toContain("room10100000000000000a");
  });

  it("existujúci pohľad témy sa bez replace neprepíše", async () => {
    const s = await setup({ viewpoint: true });
    const r = await run("bcf_topic", { action: "locate", guid: "#1", apply: "viewpoint" }, s.d);
    expect(r.json.applied).toMatchObject({ viewpoint_saved: false, note: expect.stringMatching(/replace=true/) });
    expect(s.rows[0].viewpoint).toEqual({ guid: "old", source: "viewer" });
    await run("bcf_topic", { action: "locate", guid: "#1", apply: "viewpoint", replace: true }, s.d);
    expect(s.rows[0].viewpoint).toMatchObject({ source: "bcf" });
  });

  it("bez kalibrácie strany chyba s cestou cez calibrate_underlay; model sa ani nenačíta", async () => {
    const s = await setup({ calibrated: false });
    const r = await run("bcf_topic", { action: "locate", guid: "#1" }, s.d);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/calibrate_underlay/);
    expect(r.text).toContain(DOC_ID);
    expect(s.regionModel).not.toHaveBeenCalled();
  });

  it("téma bez odkazu na stranu, neznámy odkaz a zlé apply sú chyby vstupu", async () => {
    const s = await setup();
    const other = await s.store.create({ title: "Bez dokumentu" });
    expect((await run("bcf_topic", { action: "locate", guid: other.id }, s.d)).text).toMatch(/nemá odkaz na stranu/);
    expect((await run("bcf_topic", { action: "locate", guid: "#1", document_guid: "x" }, s.d)).text).toMatch(/Odkaz x/);
    expect((await run("bcf_topic", { action: "locate", guid: "#1", apply: "vsetko" }, s.d)).text).toMatch(/apply/);
  });

  it("opis toolu nesie locate a entity (D-114: parametre, nie nové tooly)", () => {
    const topic = BCF_TOOL_DEFINITIONS.find((t) => t.name === "bcf_topic")!;
    const list = BCF_TOOL_DEFINITIONS.find((t) => t.name === "bcf_topic_list")!;
    expect((topic.inputSchema.properties as Record<string, { enum?: string[] }>).action.enum).toContain("locate");
    expect(Object.keys(list.inputSchema.properties as object)).toContain("entity");
    expect(BCF_TOOL_DEFINITIONS).toHaveLength(2);
  });
});

describe("bcf_topic_list entity (D-158 krok 4)", () => {
  const scope: EntityScope = {
    label: "1NP",
    object_type: "floor",
    self: "1NPguid000000000000000",
    guids: new Set(["1NPguid000000000000000", G1]),
    documents: new Set([DOC_ID]),
  };

  it("témy nad podlažím: priamo, cez prvok v ňom, cez pôdorys podlažia; ostatné nie", async () => {
    const m = memoryStore([
      { title: "Na podlaží", components: ["1NPguid000000000000000"] },
      { title: "Na prvku", components: [G1], status: "closed" },
      { title: "Inde", components: [G2] },
      { title: "Na výkrese", components: [] },
    ]);
    await m.store.addDocument({
      task_id: m.rows[3].id,
      document_id: DOC_ID,
      document_ref: "D.1.1.09",
      document_name: null,
      document_revision: null,
      page: 1,
      region: null,
      markup: null,
      url: null,
      description: null,
      author: null,
      document_sha256: null,
    });
    const asked: string[] = [];
    const d = deps({
      store: m.store,
      entityScope: async (ref) => {
        asked.push(ref);
        return scope;
      },
    });
    const r = await run("bcf_topic_list", { entity: "1.NP" }, d);
    expect(asked).toEqual(["1.NP"]);
    expect(r.json.entity).toEqual({ ref: "1NP", object_type: "floor", global_id: scope.self, elements: 2, documents: 1 });
    expect(r.json.topics.map((t: { title: string; match: string }) => [t.title, t.match])).toEqual([
      ["Na výkrese", "document"],
      ["Na prvku", "within"],
      ["Na podlaží", "self"],
    ]);
    expect(r.json.count).toBe(3);
    expect(r.json.by_status).toEqual({ open: 2, closed: 1 });
    const open = await run("bcf_topic_list", { entity: "1NP", status: "open" }, d);
    expect(open.json.count).toBe(2);
  });

  it("projekt: len témy na celý projekt", () => {
    const project: EntityScope = { label: "OCB", object_type: "project", self: "P", guids: new Set(["P"]), documents: new Set() };
    expect(topicInScope({ components: ["P", G1] }, [], project)).toBe("self");
    expect(topicInScope({ components: [G1] }, [], project)).toBeNull();
  });

  it("bez rozsahu entity v prostredí chyba, nie prázdny zoznam", async () => {
    const r = await run("bcf_topic_list", { entity: "1NP" }, deps());
    expect(r.isError).toBe(true);
  });
});
