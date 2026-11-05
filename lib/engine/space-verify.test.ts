import { describe, expect, it } from "vitest";

import { MINI_SPACE_IDS as ID, MINI_SPACE_VERIFY_BYTES } from "./__fixtures__/mini-space-verify";
import {
  bodiesFromExtrusions,
  bodyFromMeshTriangles,
  dimensionPoint,
  extractBodies,
  regionArea,
  regionIntersectionArea,
  regionIntersectionArea3,
  regionPerimeter,
  triangulate,
  verifySpace,
  type Body,
  type Element,
  type Pt,
  type Ring,
  type SpaceInput,
  type ExtrusionDefinitionsLike,
} from "./space-verify";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const L: Pt[] = [[0, 0], [12, 0], [12, 8], [4, 8], [4, 6], [0, 6]];
const ring = (pts: Pt[], sign: 1 | -1 = 1): Ring => ({ pts, sign });
const body = (rings: Ring[], z0: number, z1: number, id = 1): Body => ({ expressId: id, prisms: [{ rings, z0, z1 }] });
const el = (name: string, b: Body, predefinedType?: string): Element => ({ globalId: name, name, body: b, predefinedType });

const status = (res: ReturnType<typeof verifySpace>, target: string, recipe?: string) =>
  res.find((r) => r.target === `Qto_SpaceBaseQuantities.${target}` && (!recipe || r.recipe.startsWith(recipe)));

describe("2D geometria (D-185)", () => {
  it("triangulácia L-tvaru zachová plochu", () => {
    const t = triangulate(L);
    expect(t).toHaveLength(4);
    expect(t.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0)).toBeCloseTo(88, 9);
  });

  it("presný prienik nekonvexných pôdorysov aj s dierou", () => {
    expect(regionIntersectionArea([ring(L)], [ring(rect(0, 0, 12, 6))])).toBeCloseTo(72, 9);
    expect(regionIntersectionArea([ring(L)], [ring(rect(10, 5, 14, 10))])).toBeCloseTo(6, 9);
    expect(regionIntersectionArea([ring(L)], [ring(rect(0, 6, 4, 8))])).toBeCloseTo(0, 9);
    const withHole = [ring(rect(0, 0, 10, 10)), ring(rect(2, 2, 4, 4), -1)];
    expect(regionArea(withHole)).toBeCloseTo(96, 9);
    expect(regionIntersectionArea(withHole, [ring(rect(0, 0, 5, 5))])).toBeCloseTo(21, 9);
    expect(regionPerimeter([ring(L)])).toBeCloseTo(40, 9);
  });
});

describe("recepty IfcSpace (D-185)", () => {
  const space = (qto: Record<string, number>): SpaceInput => ({ ...el("2.01", body([ring(L)], 4.85, 8.8)), qto });
  const ctx = {
    slabs: [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))],
    coverings: [el("PD", body([ring(L)], 4.85, 5.0), "FLOORING"), el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING")],
  };
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, NetFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };

  it("správne hodnoty sú zelené, so vzorcom a kotvami", () => {
    const res = verifySpace(space(good), ctx);
    for (const r of res) expect([r.target, r.recipe, r.status]).toEqual([r.target, r.recipe, "green"]);
    const h = status(res, "Height", "space.height.slabs")!;
    expect(h.formula).toBe("spodok(SD-nad) - vrch(SD-pod) = 8.8 - 4.85 = 3.95 m");
    expect(h.anchors.map((a) => a.z_m)).toEqual([4.85, 8.8]);
    expect(status(res, "NetVolume")!.computed).toBeCloseTo(333.5, 4);
  });

  it("chybná výška podhľadu je červená", () => {
    expect(status(verifySpace(space({ ...good, FinishCeilingHeight: 3.0 }), ctx), "FinishCeilingHeight")!.status).toBe("red");
  });

  it("viac výšok podhľadu: hodnota v súbore = červený nález, bez hodnoty = zelená (schéma: len pri konštantnej výške)", () => {
    const two = { ...ctx, coverings: [...ctx.coverings, el("PH2", body([ring(rect(4, 6, 12, 8))], 7.6, 7.6125), "CEILING")] };
    const r = status(verifySpace(space(good), two), "FinishCeilingHeight")!;
    expect(r.status).toBe("red");
    expect(r.distinct_heights).toEqual([2.6, 3.05]);
    expect(r.note).toMatch(/nie je jednoznačná, miestnosť má 2 výšok/);
    expect(r.note).toMatch(/PARTIAL/);
    const withoutFch: Record<string, number> = { ...good };
    delete withoutFch.FinishCeilingHeight;
    expect(status(verifySpace(space(withoutFch), two), "FinishCeilingHeight")!.status).toBe("green");
  });

  it("každý výsledok nesie metódu, definíciu zo schémy a použitú toleranciu z registra", () => {
    const res = verifySpace(space(good), ctx);
    for (const r of res) {
      expect(r.method.length).toBeGreaterThan(10);
      expect(r.definition.length).toBeGreaterThan(10);
      expect(r.spec_ref).toMatch(/^buildingSMART\/IFC4\.3\.x-development@d71e140:/);
      expect(r.tolerance).toMatch(/mm|%/);
      if (r.target.endsWith("NetVolume")) expect(r.tolerance).toMatch(/1 % z GrossVolume - NetVolume/);
    }
    expect(status(res, "FinishCeilingHeight")!.definition).toMatch(/constant height/);
  });

  it("NetVolume: tolerancia 1 % z GV - NV rozlíši Revit metódu aj pri tenkých krytinách", () => {
    // Schema: 347.6 - 88 x 0.15 - 72 x 0.0125 = 333.5; "over the whole area": 347.6 - 88 x 0.1625 = 333.3 (difference 0.2 m3).
    const revit = status(verifySpace(space({ ...good, NetVolume: 333.3 }), ctx), "NetVolume")!;
    expect(revit.status).toBe("yellow");
    expect(revit.tolerance).toBe("objem NetVolume +- 1 % z GrossVolume - NetVolume (14,3 m3) = +- 0,1435 m3");
    expect(status(verifySpace(space(good), ctx), "NetVolume")!.status).toBe("green");
    expect(status(verifySpace(space({ ...good, NetVolume: 333.5 + 0.15 }), ctx), "NetVolume")!.status).toBe("red");
  });

  it("NetVolume Revit metódou (krytiny po celej ploche) je žltá, inak červená", () => {
    // A thick floor covering on half of the area only: schema 347.6 - 44 x 0.3 = 334.4; "over the whole area" 321.2.
    const half = { ...ctx, coverings: [el("PD", body([ring(rect(0, 0, 12, 6))], 4.85, 5.15), "FLOORING")] };
    expect(status(verifySpace(space({ ...good, NetVolume: 347.6 - 88 * 0.3 }), half), "NetVolume")!.status).toBe("yellow");
    expect(status(verifySpace(space({ ...good, NetVolume: 300 }), half), "NetVolume")!.status).toBe("red");
  });

  it("bez telesa je všetko sivé s dôvodom", () => {
    const res = verifySpace({ ...el("X", { expressId: 9, prisms: [], unsupported: "Brep" }), qto: good }, ctx);
    expect(res.every((r) => r.status === "grey" && r.note === "Brep")).toBe(true);
  });
});

describe("extractExtrusionDefinitions na mini modeli v mm (D-185)", () => {
  it("dá hranoly v IFC svete v metroch a recepty sú zelené", async () => {
    const bodies = await extractBodies(MINI_SPACE_VERIFY_BYTES, Object.values(ID));
    const sp = bodies.get(ID.space)!;
    expect(sp.unsupported).toBeUndefined();
    expect(sp.prisms[0].z0).toBeCloseTo(4.85, 9);
    expect(sp.prisms[0].z1).toBeCloseTo(8.8, 9);
    expect(regionArea(sp.prisms[0].rings)).toBeCloseTo(88, 6);
    expect(bodies.get(ID.ceiling)!.prisms[0].z0).toBeCloseTo(8.05, 9);
    const res = verifySpace(
      { globalId: "0minispace201000000001", name: "2.01", body: sp, qto: { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, NetFloorArea: 86.24, GrossVolume: 347.6, NetVolume: 333.5 } },
      {
        slabs: [el("SD-pod", bodies.get(ID.slabBelow)!), el("SD-nad", bodies.get(ID.slabAbove)!)],
        coverings: [el("PD", bodies.get(ID.floor)!, "FLOORING"), el("PH", bodies.get(ID.ceiling)!, "CEILING")],
        inner: [{ ...el("SL", bodies.get(ID.column)!), ifcType: "IFCCOLUMN" }, { ...el("VS", bodies.get(ID.builtIn)!), ifcType: "IFCFURNITURE" }],
        slabOpenings: [{ ...el("OT", bodies.get(ID.opening)!), host: "SD-pod" }],
      },
    );
    expect(res.filter((r) => r.status !== "green").map((r) => `${r.target} ${r.status} ${r.formula ?? r.note}`)).toEqual([]);
    expect(status(res, "NetFloorArea")!.formula).toBe("88 - 0.16 (SL) - 0.6 (VS) - 1 (OT) = 86.24 m2");
  });
});

// ── fixes after the first run on ASR v79 (D-185, B1 to B4 and the substitute via mesh) ─────

/** Box as triangles in the IFC world (9 numbers per triangle), normals outward. */
function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  // Quadrilaterals counter-clockwise when viewed from outside.
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d].flatMap((i) => v[i]));
}

describe("opravy overovača po prvom behu (D-185)", () => {
  const space = (qto: Record<string, number>, b = body([ring(L)], 4.85, 8.8)): SpaceInput => ({ ...el("2.01", b), qto });
  const slabs = [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))];
  const floor = el("PD", body([ring(L)], 4.85, 5.0), "FLOORING");
  const ceiling = el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING");
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, NetFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };
  const noBody = (name: string, pt: string, bbox?: Body["bbox"]): Element => el(name, { expressId: 99, prisms: [], unsupported: "profile boundaries touch", ...(bbox ? { bbox } : {}) }, pt);

  it("B3: NetVolume odčíta len podlahovinu a podhľad, nie izoláciu vnútri telesa", () => {
    const insulation = el("ST01", body([ring(rect(0, 0, 12, 8))], 8.596, 8.8), "INSULATION");
    const r = status(verifySpace(space(good), { slabs, coverings: [floor, ceiling, insulation] }), "NetVolume")!;
    expect(r.status).toBe("green");
    expect(r.formula).not.toMatch(/ST01/);
  });

  it("B1: prvok, z ktorého časť extrúzie ifc-lite odmietol, sa nepočíta z časti", () => {
    const key = (n: number) => ({ solid_id: n });
    const okSource = {
      key: key(1),
      source: {
        profile: { loops: [{ kind: "outer" as const, segments: rect(0, 0, 2, 2).map((p, i, a) => ({ type: "line", start: [...p, 0], end: [...a[(i + 1) % a.length], 0] })) }], profile_position: null },
        position_matrix: null, axis_unit_vector: [0, 0, 1], Depth: 3, status: { type: "complete" },
      },
    };
    const bad = { key: key(2), source: { profile: null, position_matrix: null, axis_unit_vector: null, Depth: null, status: { type: "unsupported", reason: "profile boundaries touch" } } };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const defs: ExtrusionDefinitionsLike = {
      sources: [okSource, bad],
      instances: {
        5: [
          { source: key(1), product_id: 5, source_modified: false, world_from_source: I, status: { type: "complete" } },
          { source: key(2), product_id: 5, source_modified: false, world_from_source: I, status: { type: "unsupported", reason: "profile boundaries touch" } },
        ],
        6: [{ source: key(1), product_id: 6, source_modified: false, world_from_source: I, status: { type: "complete" } }],
      },
    };
    const bodies = bodiesFromExtrusions(defs, [5, 6]);
    expect(bodies.get(5)!.prisms).toHaveLength(0);
    expect(bodies.get(5)!.unsupported).toMatch(/aspoň jedno z 2 telies; z časti sa nepočíta/);
    expect(bodies.get(6)!.prisms).toHaveLength(1);
    expect(bodies.get(6)!.source).toBe("extrusion");
  });

  it("B2: podlahovina bez telesa v pôdoryse = FFH a FCH sivé (nedá sa overiť), NetVolume sivé", () => {
    const floorNoBody = noBody("PD-touch", "FLOORING", { min: [0, 0, 4.85], max: [12, 8, 5.0] });
    const res = verifySpace(space(good), { slabs, coverings: [floorNoBody, ceiling] });
    const ffh = status(res, "FinishFloorHeight")!;
    expect(ffh.status).toBe("grey");
    expect(ffh.note).toMatch(/nedá sa overiť: podlahovina .*PD-touch/);
    expect(status(res, "FinishCeilingHeight")!.status).toBe("grey");
    expect(status(res, "NetVolume")!.status).toBe("grey");
  });

  it("B2: FFH bez nájdenej podlahoviny je sivé aj bez kandidáta; FCH od spodku miestnosti len keď súbor podlahu neuvádza", () => {
    expect(status(verifySpace(space(good), { slabs, coverings: [ceiling] }), "FinishFloorHeight")!.status).toBe("grey");
    expect(status(verifySpace(space(good), { slabs, coverings: [ceiling] }), "FinishCeilingHeight")!.status).toBe("grey");
    const noFloor = { ...good, FinishCeilingHeight: 3.2 } as Record<string, number>;
    delete noFloor.FinishFloorHeight;
    expect(status(verifySpace(space(noFloor), { slabs, coverings: [ceiling] }), "FinishCeilingHeight")!.status).toBe("green");
  });

  it("B2: podhľad bez telesa nad miestnosťou = sivé; mimo pôdorysu miestnosti ostáva nález", () => {
    const near = noBody("PH-touch", "CEILING", { min: [0, 0, 8.05], max: [12, 6, 8.0625] });
    const far = noBody("PH-far", "CEILING", { min: [40, 40, 8.05], max: [50, 50, 8.0625] });
    expect(status(verifySpace(space(good), { slabs, coverings: [floor, near] }), "FinishCeilingHeight")!.status).toBe("grey");
    const r = status(verifySpace(space(good), { slabs, coverings: [floor, far] }), "FinishCeilingHeight")!;
    expect(r.status).toBe("red");
    expect(r.note).toBe("podhľad nad miestnosťou nenájdený");
  });

  it("B4: krytina, ktorá sa miestnosti len dotýka hranou, sa neodčíta", () => {
    const touching = el("PD-sused", body([ring(rect(12 - 1e-7, 0, 16, 8))], 4.85, 5.0), "FLOORING"); // prekryv 8e-7 m2 = dotyk
    const r = status(verifySpace(space(good), { slabs, coverings: [floor, ceiling, touching] }), "NetVolume")!;
    expect(r.formula).not.toMatch(/PD-sused/);
    expect(r.status).toBe("green");
  });

  it("bez telesa sú sivé všetky recepty (9), s dôvodom", () => {
    const res = verifySpace({ ...el("X", { expressId: 9, prisms: [], unsupported: "mesh nie je uzavretý" }), qto: good }, { slabs, coverings: [] });
    expect(res).toHaveLength(9);
    expect(res.every((r) => r.status === "grey" && r.note === "mesh nie je uzavretý")).toBe(true);
  });

  it("náhrada cez mesh: uzavretý kváder dá plochu, obvod, objem, výšku a ťažisko; recepty zelené", () => {
    const b = bodyFromMeshTriangles(7, boxTris(0, 0, 4.85, 8, 11, 8.8), true, 8 * 11 * 3.95);
    expect(b.source).toBe("mesh");
    expect(regionArea(b.prisms[0].rings)).toBeCloseTo(88, 9);
    expect(b.mesh!.perimeter).toBeCloseTo(38, 9);
    expect(b.mesh!.centroid[0]).toBeCloseTo(4, 9);
    expect(b.prisms[0].z0).toBeCloseTo(4.85, 9);
    const sp = space({ ...good, GrossPerimeter: 38, NetVolume: 347.6 - 88 * 0.15 - 72 * 0.0125 }, b);
    const res = verifySpace(sp, { slabs, coverings: [el("PD", body([ring(rect(0, 0, 8, 11))], 4.85, 5.0), "FLOORING"), el("PH", body([ring(rect(0, 0, 8, 9))], 8.05, 8.0625), "CEILING")] });
    expect(res.filter((r) => r.status !== "green").map((r) => `${r.target} ${r.status} ${r.note ?? r.formula}`)).toEqual([]);
    expect(status(res, "GrossVolume")!.formula).toMatch(/objem uzavretého meshu/);
    expect(status(res, "Height", "space.height.own")!.method).toMatch(/uzavretý mesh/);
    expect(dimensionPoint(sp)).toEqual(b.mesh!.centroid);
  });

  it("náhrada cez mesh: neuzavretý mesh dá pôdorys a výškový rozsah, objem nie (mesh_open)", () => {
    const b = bodyFromMeshTriangles(7, boxTris(0, 0, 0, 1, 1, 1).slice(0, 9 * 10), false, 0);
    expect(b.source).toBe("mesh_open");
    expect(regionArea(b.prisms[0].rings)).toBeCloseTo(1, 9);
    expect(b.mesh!.volume).toBeNaN();
    expect(b.unsupported).toMatch(/nie je uzavretý/);
    expect(b.bbox!.max).toEqual([1, 1, 1]);
    // Without downward faces (only the top face) only the envelope stays.
    const top = bodyFromMeshTriangles(8, boxTris(0, 0, 0, 1, 1, 1).slice(9 * 2, 9 * 4), false, 0);
    expect(top.prisms).toHaveLength(0);
    expect(top.bbox).toBeDefined();
  });
});

// ── addendum 2 after the second run on ASR v79 (Samuel: points a to d) ────────────────

describe("doplnok 2 po druhom behu (D-185)", () => {
  const slabs = [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))];
  const floor = el("PD", body([ring(L)], 4.85, 5.0), "FLOORING");
  const ceiling = el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING");
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, NetFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };
  const extr = (b: Body): Body => ({ ...b, source: "extrusion" });
  const space = (qto: Record<string, number>, b: Body = extr(body([ring(L)], 4.85, 8.8))): SpaceInput => ({ ...el("2.01", b), qto });
  /** Box 8 x 11 as an OPEN mesh (without one side wall). */
  const openBox = () => bodyFromMeshTriangles(7, boxTris(0, 0, 4.85, 8, 11, 8.8).slice(0, 9 * 10), false, 0);
  const boxGood = { ...good, GrossPerimeter: 38, GrossVolume: 347.6, NetVolume: 347.6 - 88 * 0.15 };
  const boxFloor = el("PD", extr(body([ring(rect(0, 0, 8, 11))], 4.85, 5.0)), "FLOORING");

  it("a) neuzavretý mesh miestnosti: výška, plocha a obvod zelené pri zhode, pri nesúlade sivé; objemy sivé", () => {
    const sp = space(boxGood, openBox());
    const res = verifySpace(sp, { slabs, coverings: [boxFloor] });
    expect(status(res, "Height", "space.height.own")!.status).toBe("green");
    expect(status(res, "GrossFloorArea")!.status).toBe("green");
    expect(status(res, "GrossPerimeter")!.status).toBe("green");
    expect(status(res, "Height", "space.height.slabs")!.status).toBe("green");
    expect(status(res, "FinishFloorHeight")!.status).toBe("green");
    expect(status(res, "GrossVolume")!.status).toBe("grey");
    expect(status(res, "NetVolume")!.status).toBe("grey");
    expect(status(res, "GrossFloorArea")!.method).toMatch(/NEUZAVRETÝ mesh/);
    const bad = verifySpace(space({ ...boxGood, GrossFloorArea: 70, Height: 3.5 }, openBox()), { slabs, coverings: [boxFloor] });
    expect(status(bad, "GrossFloorArea")!.status).toBe("grey");
    expect(status(bad, "GrossFloorArea")!.note).toMatch(/nedá sa overiť: .*nie je uzavretý/);
    expect(status(bad, "Height", "space.height.own")!.status).toBe("grey");
    // the height from file slabs does not depend on the mesh plan: the finding stays red
    expect(status(bad, "Height", "space.height.slabs")!.status).toBe("red");
  });

  it("a) neuzavretý mesh dosky je platná referencia (doska pod / nad)", () => {
    const slabOpen = el("SD-nad-open", bodyFromMeshTriangles(9, boxTris(0, 0, 8.8, 12, 8, 9.05).slice(0, 9 * 10), false, 0));
    const res = verifySpace(space(good), { slabs: [slabs[0], slabOpen], coverings: [floor, ceiling] });
    const h = status(res, "Height", "space.height.slabs")!;
    expect(h.status).toBe("green");
    expect(h.formula).toMatch(/SD-nad-open/);
  });

  it("c) obvod: relatívna tolerancia 0,05 %, najmenej 5 mm", () => {
    const sq = (side: number) => extr(body([ring(rect(0, 0, side, side))], 4.85, 8.8));
    const per = (side: number, file: number) => status(verifySpace(space({ GrossPerimeter: file }, sq(side)), { slabs, coverings: [] }), "GrossPerimeter")!;
    // perimeter 63 m: +23 mm (0.037 %) green, +40 mm (0.063 %) red
    expect(per(15.75, 63 - 0.023).status).toBe("green");
    expect(per(15.75, 63 - 0.04).status).toBe("red");
    // perimeter 10 m: 0.05 % = 5 mm, a deviation of 4 mm green, 6 mm red
    expect(per(2.5, 10 - 0.004).status).toBe("green");
    expect(per(2.5, 10 - 0.006).status).toBe("red");
    expect(per(2.5, 10).tolerance).toBe("obvod +- 0,05 %, najmenej +- 5 mm");
    expect(per(2.5, 10).recipe).toBe("space.perimeter.profile@2");
  });

  it("d) FinishFloorHeight chýba pri konštantnej podlahovine = žltá; bez podlahoviny ostáva sivá", () => {
    const noFfh: Record<string, number> = { ...good };
    delete noFfh.FinishFloorHeight;
    const r = status(verifySpace(space(noFfh), { slabs, coverings: [floor, ceiling] }), "FinishFloorHeight")!;
    expect(r.status).toBe("yellow");
    expect(r.computed).toBeCloseTo(0.15, 9);
    expect(r.note).toMatch(/neuvádza, hoci podlahovina má .* jednu výšku/);
    expect(r.recipe).toBe("space.ffh.covering@3");
    expect(status(verifySpace(space(noFfh), { slabs, coverings: [ceiling] }), "FinishFloorHeight")!.status).toBe("grey");
  });

  it("b) NetVolume @3: objem krytiny z viacerých telies sa ráta po telesách, nie z celkového výškového rozsahu", () => {
    // Podlahovina z dvoch vrstiev s medzerou: 4.85..4.90 a 4.95..5.00 -> 88 x 0,10 = 8,8 m3 (rozsah 0,15 by dal 13,2).
    const layered = el("PD-2v", { expressId: 3, source: "extrusion", prisms: [{ rings: [ring(L)], z0: 4.85, z1: 4.9 }, { rings: [ring(L)], z0: 4.95, z1: 5.0 }] }, "FLOORING");
    const nv = 347.6 - 88 * 0.1 - 72 * 0.0125;
    const r = status(verifySpace(space({ ...good, NetVolume: nv }), { slabs, coverings: [layered, ceiling] }), "NetVolume")!;
    expect(r.recipe).toBe("space.netvolume.coverings@3");
    expect(r.computed).toBeCloseTo(nv, 4);
    expect(r.status).toBe("green");
    expect(r.formula).toMatch(/PD-2v, prienik 2 telies/);
  });

  it("b) NetVolume @3: miestnosť z dvoch telies, krytina zasahuje pod obe", () => {
    const two: Body = { expressId: 4, source: "extrusion", prisms: [{ rings: [ring(rect(0, 0, 12, 6))], z0: 4.85, z1: 8.8 }, { rings: [ring(rect(4, 6, 12, 8))], z0: 4.85, z1: 8.8 }] };
    // prienik s telesom 1: 6 x 6 = 36 m2, s telesom 2: 6 x 2 = 12 m2 -> 48 x 0,15 = 7,2 m3
    const f = el("PD-a", extr(body([ring(rect(6, 0, 12, 8))], 4.85, 5.0)), "FLOORING");
    const nv = 88 * 3.95 - 48 * 0.15;
    const r = status(verifySpace(space({ ...good, NetVolume: nv, GrossVolume: 88 * 3.95 }, two), { slabs, coverings: [f] }), "NetVolume")!;
    expect(r.computed).toBeCloseTo(nv, 4);
    expect(r.status).toBe("green");
  });

  it("b) NetVolume @3: krytina z uzavretého meshu sa prenásobí plnosťou meshu", () => {
    // Envelope mesh 12 x 6 x 0.15 (10.8 m3), but the real mesh volume 9.72 m3 (fullness 0.9).
    const tris = boxTris(0, 0, 4.85, 12, 6, 5.0);
    const meshFloor = el("PD-mesh", bodyFromMeshTriangles(5, tris, true, 9.72), "FLOORING");
    const nv = 347.6 - 9.72;
    const r = status(verifySpace(space({ ...good, NetVolume: nv }), { slabs, coverings: [meshFloor] }), "NetVolume")!;
    expect(r.computed).toBeCloseTo(nv, 4);
    expect(r.formula).toMatch(/uzavretý mesh, plnosť 0.9/);
    expect(r.status).toBe("green");
  });
});

describe("bunky a vysvetlenie receptov (D-185 UI)", () => {
  const space = (qto: Record<string, number>): SpaceInput => ({ ...el("2.01", body([ring(L)], 4.85, 8.8)), qto });
  const ctx = {
    slabs: [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))],
    coverings: [el("PD", body([ring(L)], 4.85, 5.0), "FLOORING"), el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING")],
  };
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, NetFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };
  /** Expression over cells (A - B - C, A x B, A) substituted = the computed value. */
  const evalCells = (expr: string, cells: Array<{ key: string; value: number }>) => {
    const v = (k: string) => cells.find((c) => c.key === k)!.value;
    const terms = expr.split(" - ");
    const prod = (t: string) => t.split(" x ").reduce((p, k) => p * v(k.trim()), 1);
    return terms.slice(1).reduce((acc, t) => acc - prod(t), prod(terms[0]));
  };

  it("každý recept so stavom z geometrie má vysvetlenie, výraz a bunky, ktoré dajú vypočítanú hodnotu", () => {
    const res = verifySpace(space(good), ctx);
    expect(res).toHaveLength(9);
    for (const r of res) {
      expect(r.explanation.length, r.recipe).toBeGreaterThan(20);
      expect(r.expression, r.recipe).toBeTruthy();
      expect(evalCells(r.expression!, r.cells!), r.recipe).toBeCloseTo(r.computed!, 3);
    }
  });

  it("Height zo súborových dosiek: A spodok dosky nad, B vrch dosky pod, so zdrojovým prvkom", () => {
    const h = status(verifySpace(space(good), ctx), "Height", "space.height.slabs")!;
    expect(h.explanation).toMatch(/od vrchu dosky pod miestnosťou po spodok dosky nad/);
    expect(h.expression).toBe("A - B");
    expect(h.cells).toEqual([
      { key: "A", label: "spodok dosky nad", value: 8.8, unit: "m", global_id: "SD-nad" },
      { key: "B", label: "vrch dosky pod", value: 4.85, unit: "m", global_id: "SD-pod" },
    ]);
  });

  it("FFH, FCH a NetVolume nesú zdrojovú krytinu v bunke", () => {
    const res = verifySpace(space(good), ctx);
    expect(status(res, "FinishFloorHeight")!.cells!.map((c) => c.global_id)).toEqual(["PD", "2.01"]);
    expect(status(res, "FinishCeilingHeight")!.cells!.map((c) => c.global_id)).toEqual(["PH", "PD"]);
    const nv = status(res, "NetVolume")!;
    expect(nv.expression).toBe("A - B - C");
    expect(nv.cells!.map((c) => [c.global_id, c.unit])).toEqual([["2.01", "m3"], ["PD", "m3"], ["PH", "m3"]]);
    expect(nv.cells![1].label).toMatch(/^objem podlahoviny vnútri telesa/);
    expect(nv.cells![2].label).toMatch(/^objem podhľadu vnútri telesa/);
    const gv = status(res, "GrossVolume")!;
    expect([gv.expression, gv.cells!.map((c) => c.unit)]).toEqual(["A x B", ["m2", "m"]]);
  });

  it("sivý recept nemá bunky ani výraz, len vysvetlenie a dôvod", () => {
    const res = verifySpace({ ...el("X", { expressId: 9, prisms: [], unsupported: "bez extrúzie" }), qto: good }, ctx);
    for (const r of res) {
      expect(r.status).toBe("grey");
      expect(r.cells ?? []).toEqual([]);
      expect(r.expression).toBeUndefined();
      expect(r.explanation).toBeTruthy();
    }
  });

  it("viac výšok podhľadu: bunky sú jednotlivé výšky, bez výrazu", () => {
    const two = { ...ctx, coverings: [...ctx.coverings, el("PH2", body([ring(rect(4, 6, 12, 8))], 7.6, 7.6125), "CEILING")] };
    const r = status(verifySpace(space(good), two), "FinishCeilingHeight")!;
    expect(r.expression).toBeUndefined();
    expect(r.cells!.map((c) => c.value)).toEqual([2.6, 3.05]);
  });
});

// ── NetFloorArea (D-185 addendum 4, Samuel 3. 11.: per the schema) ───────────────

describe("NetFloorArea space.netfloorarea.profile@1 (D-185 dodatok 4)", () => {
  // Space L 88 m2 from 4.85 to 8.8; floor covering 0.15 m (finished floor 5.0).
  const space = (qto: Record<string, number>, b = body([ring(L)], 4.85, 8.8)): SpaceInput => ({ ...el("2.01", b), qto });
  const slabBelow = el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85));
  const base = {
    slabs: [slabBelow, el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))],
    coverings: [el("PD", body([ring(L)], 4.85, 5.0), "FLOORING")],
  };
  const inner = (name: string, ifcType: string, b: Body): Element => ({ ...el(name, b), ifcType });
  const column = inner("SL", "IFCCOLUMN", body([ring(rect(7.8, 2.8, 8.2, 3.2))], 4.85, 8.8)); // 0,16 m2
  const wall = inner("SN", "IFCWALL", body([ring(rect(6, 0, 6.2, 4))], 4.85, 8.8)); // 0,8 m2
  const nfa = (qto: Record<string, number>, ctx: Parameters<typeof verifySpace>[1], b?: Body) => status(verifySpace(space(qto, b), ctx), "NetFloorArea")!;

  it("prienik troch pôdorysov je presný (aj s dierou)", () => {
    expect(regionIntersectionArea3([ring(L)], [ring(rect(0, 0, 6, 6))], [ring(rect(3, 3, 10, 10))])).toBeCloseTo(9, 9);
    expect(regionIntersectionArea3([ring(L)], [ring(rect(10, 4, 14, 10))], [ring(rect(11, 5, 13, 9))])).toBeCloseTo(3, 9);
    const holed = [ring(rect(0, 0, 10, 10)), ring(rect(2, 2, 4, 4), -1)];
    expect(regionIntersectionArea3(holed, [ring(rect(0, 0, 5, 5))], [ring(rect(1, 1, 5, 5))])).toBeCloseTo(12, 9);
    expect(regionIntersectionArea3([ring(L)], [ring(rect(0, 0, 1, 1))], [ring(rect(2, 2, 3, 3))])).toBe(0);
  });

  it("odčíta stĺp a stenu vnútri miestnosti; bunky: A = GrossFloorArea (quantity), ďalšie so zdrojovým prvkom", () => {
    const r = nfa({ GrossFloorArea: 88, NetFloorArea: 87.04 }, { ...base, inner: [column, wall] });
    expect(r.status).toBe("green");
    expect(r.computed).toBe(87.04);
    expect(r.expression).toBe("A - B - C");
    expect(r.cells).toEqual([
      { key: "A", label: "GrossFloorArea miestnosti (z geometrie)", value: 88, unit: "m2", global_id: "2.01", quantity: "Qto_SpaceBaseQuantities.GrossFloorArea" },
      { key: "B", label: "pôdorys stĺpa vnútri miestnosti", value: 0.16, unit: "m2", global_id: "SL" },
      { key: "C", label: "pôdorys steny vnútri miestnosti", value: 0.8, unit: "m2", global_id: "SN" },
    ]);
    expect(r.anchors.map((a) => [a.global_id, a.role])).toEqual([["2.01", "teleso miestnosti"], ["SL", "stĺp vnútri miestnosti"], ["SN", "stena vnútri miestnosti"]]);
    expect(r.formula).toBe("88 - 0.16 (SL) - 0.8 (SN) = 87.04 m2");
    expect(r.definition).toMatch(/^Sum of all usable floor areas covered by the space\. It excludes the area covered {2}by elements inside the space/);
    // The file did not make the subtraction (= GrossFloorArea): 0.96 m2 is above the tolerance 0.5 % (0.44 m2), red.
    expect(nfa({ GrossFloorArea: 88, NetFloorArea: 88 }, { ...base, inner: [column, wall] }).status).toBe("red");
  });

  it("odčíta len časť prvku v pôdoryse miestnosti; dotyk hranou nie", () => {
    const outside = inner("SN-obvod", "IFCWALL", body([ring(rect(12, 0, 12.3, 8))], 4.85, 8.8));
    const half = inner("SL-roh", "IFCCOLUMN", body([ring(rect(11.8, 7.8, 12.2, 8.2))], 4.85, 8.8));
    const r = nfa({ NetFloorArea: 87.96 }, { ...base, inner: [outside, half] });
    expect(r.cells!.map((c) => [c.global_id, c.value])).toEqual([["2.01", 88], ["SL-roh", 0.04]]);
    expect(r.status).toBe("green");
  });

  it("prvok musí vyčnievať nad hotovú podlahu: stena podlažia pod, stena po vrch podlahoviny a trám pod stropom sa neodčítajú", () => {
    const below = inner("SN-1NP", "IFCWALL", body([ring(rect(6, 0, 6.2, 4))], 0.9, 4.85));
    const inFloor = inner("SN-skladba", "IFCWALL", body([ring(rect(6, 0, 6.2, 4))], 0.9, 5.0));
    const beam = inner("SL-pod-stropom", "IFCCOLUMN", body([ring(rect(7.8, 2.8, 8.2, 3.2))], 8.0, 8.8));
    const r = nfa({ NetFloorArea: 88 }, { ...base, inner: [below, inFloor, beam] });
    expect([r.status, r.computed, r.expression]).toEqual(["green", 88, "A"]);
    // Without a floor covering the finished floor is the bottom of the space: the wall above 5.0 already protrudes.
    expect(nfa({ NetFloorArea: 88 }, { ...base, coverings: [], inner: [inFloor] }).computed).toBe(87.2);
  });

  it("prekryv odčítaných prvkov sa neodčíta dvakrát (stĺp v stene, otvor pod stĺpom)", () => {
    const inWall = inner("SL-v-stene", "IFCCOLUMN", body([ring(rect(5.9, 1, 6.3, 1.4))], 4.85, 8.8)); // 0,16, z toho 0,08 v stene
    const r = nfa({ NetFloorArea: 87.12 }, { ...base, inner: [wall, inWall] });
    expect(r.computed).toBe(87.12);
    expect(r.cells![2]).toMatchObject({ global_id: "SL-v-stene", value: 0.08, label: "pôdorys stĺpa vnútri miestnosti (bez časti už odčítanej)" });
    // A column entirely in a wall: its cell is dropped.
    const hidden = inner("SL-skryty", "IFCCOLUMN", body([ring(rect(6.05, 2, 6.15, 2.1))], 4.85, 8.8));
    expect(nfa({ NetFloorArea: 87.2 }, { ...base, inner: [wall, hidden] }).cells!.map((c) => c.global_id)).toEqual(["2.01", "SN"]);
  });

  it("otvor v doske pod miestnosťou a diera v jej profile sa odčítajú; otvor dosky nad ani inej dosky nie", () => {
    const opening = { ...el("OT", body([ring(rect(1.5, 1.5, 2.5, 2.5))], 4.6, 4.85)), host: "SD-pod" };
    const above = { ...el("OT-nad", body([ring(rect(8, 1, 9, 2))], 8.8, 9.05)), host: "SD-nad" };
    const other = { ...el("OT-ina", body([ring(rect(8, 4, 9, 5))], 4.6, 4.85)), host: "SD-ina" };
    const r = nfa({ GrossFloorArea: 88, NetFloorArea: 87 }, { ...base, slabOpenings: [opening, above, other] });
    expect([r.status, r.computed]).toEqual(["green", 87]);
    expect(r.cells![1]).toMatchObject({ label: "otvor v doske pod miestnosťou", global_id: "OT", value: 1 });
    expect(r.anchors[1]).toEqual({ global_id: "OT", role: "otvor v doske" });
    const holed = el("SD-pod", body([ring(rect(0, 0, 12, 8)), ring(rect(9, 1, 11, 3), -1)], 4.6, 4.85));
    const h = nfa({ NetFloorArea: 84 }, { ...base, slabs: [holed, base.slabs[1]] });
    expect([h.status, h.computed]).toEqual(["green", 84]);
    expect(h.cells![1]).toMatchObject({ label: "diera v profile dosky SD-pod pod miestnosťou", global_id: "SD-pod", value: 4 });
  });

  it("súbor bez odčítania otvorov v doske (Revit) je žltý, iná hodnota červená", () => {
    const stair = { ...el("OT-schody", body([ring(rect(0, 0, 4, 5))], 4.6, 4.85)), host: "SD-pod" }; // 20 m2
    const ctx = { ...base, inner: [column], slabOpenings: [stair] };
    expect(nfa({ NetFloorArea: 67.84 }, ctx).status).toBe("green");
    const y = nfa({ NetFloorArea: 87.84 }, ctx);
    expect(y.status).toBe("yellow");
    expect(y.note).toMatch(/sedí len bez odčítania otvorov v doske .* \(87\.84 m2\)/);
    expect(nfa({ NetFloorArea: 90 }, ctx).status).toBe("red");
  });

  it("nesúlad pri prvku bez telesa v pásme podlahy alebo pri odčítanom prvku z CSG je sivý; zhoda ostáva zelená", () => {
    const noBody = inner("SN-bez", "IFCWALL", { expressId: 5, prisms: [], unsupported: "Brep", bbox: { min: [3, 3, 4.85], max: [3.2, 5, 8.8] } });
    expect(nfa({ NetFloorArea: 80 }, { ...base, inner: [noBody] })).toMatchObject({ status: "grey", note: expect.stringMatching(/nedá sa overiť: .*SN-bez/) });
    expect(nfa({ NetFloorArea: 88 }, { ...base, inner: [noBody] }).status).toBe("green");
    const csg = inner("SN-dvere", "IFCWALL", { ...wall.body, unsupported: "teleso je operand CSG (source_modified), hranol je len horný odhad" });
    expect(nfa({ NetFloorArea: 88 }, { ...base, inner: [csg] })).toMatchObject({ status: "grey", note: expect.stringMatching(/horný odhad \(SN-dvere/) });
    expect(nfa({ NetFloorArea: 87.2 }, { ...base, inner: [csg] }).status).toBe("green");
  });

  it("odpočet v tolerancii plochy dá poznámku; bez hodnoty v súbore je sivá", () => {
    const r = nfa({ NetFloorArea: 88 }, { ...base, inner: [column] });
    expect(r.status).toBe("green");
    expect(r.note).toMatch(/odpočet 0\.16 m2 je v tolerancii plochy/);
    expect(nfa({}, { ...base, inner: [column] }).status).toBe("grey");
    expect(nfa({ NetFloorArea: 88 }, base).note).toBeUndefined();
  });
});
