import { describe, expect, it } from "vitest";

import { MINI_SPACE_IDS as ID, MINI_SPACE_VERIFY_BYTES } from "./__fixtures__/mini-space-verify";
import {
  bodiesFromExtrusions,
  bodyFromMeshTriangles,
  dimensionPoint,
  extractBodies,
  regionArea,
  regionIntersectionArea,
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
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };

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
    // Schéma: 347,6 - 88 x 0,15 - 72 x 0,0125 = 333,5; "po celej ploche": 347,6 - 88 x 0,1625 = 333,3 (rozdiel 0,2 m3).
    const revit = status(verifySpace(space({ ...good, NetVolume: 333.3 }), ctx), "NetVolume")!;
    expect(revit.status).toBe("yellow");
    expect(revit.tolerance).toBe("objem NetVolume +- 1 % z GrossVolume - NetVolume (14,3 m3) = +- 0,1435 m3");
    expect(status(verifySpace(space(good), ctx), "NetVolume")!.status).toBe("green");
    expect(status(verifySpace(space({ ...good, NetVolume: 333.5 + 0.15 }), ctx), "NetVolume")!.status).toBe("red");
  });

  it("NetVolume Revit metódou (krytiny po celej ploche) je žltá, inak červená", () => {
    // Hrubá podlahovina len na polovici plochy: schéma 347,6 - 44 x 0,3 = 334,4; "po celej ploche" 321,2.
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
      { globalId: "0minispace201000000001", name: "2.01", body: sp, qto: { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 } },
      {
        slabs: [el("SD-pod", bodies.get(ID.slabBelow)!), el("SD-nad", bodies.get(ID.slabAbove)!)],
        coverings: [el("PD", bodies.get(ID.floor)!, "FLOORING"), el("PH", bodies.get(ID.ceiling)!, "CEILING")],
      },
    );
    expect(res.filter((r) => r.status !== "green").map((r) => `${r.target} ${r.status} ${r.formula ?? r.note}`)).toEqual([]);
  });
});

// ── opravy po prvom behu na ASR v79 (D-185, B1 až B4 a náhrada cez mesh) ─────

/** Kváder ako trojuholníky v IFC svete (9 čísel na trojuholník), normály von. */
function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  // Štvoruholníky proti smeru hodín pri pohľade zvonku.
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d].flatMap((i) => v[i]));
}

describe("opravy overovača po prvom behu (D-185)", () => {
  const space = (qto: Record<string, number>, b = body([ring(L)], 4.85, 8.8)): SpaceInput => ({ ...el("2.01", b), qto });
  const slabs = [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))];
  const floor = el("PD", body([ring(L)], 4.85, 5.0), "FLOORING");
  const ceiling = el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING");
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };
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

  it("bez telesa sú sivé všetky recepty (8), s dôvodom", () => {
    const res = verifySpace({ ...el("X", { expressId: 9, prisms: [], unsupported: "mesh nie je uzavretý" }), qto: good }, { slabs, coverings: [] });
    expect(res).toHaveLength(8);
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
    // Bez plôch nadol (len vrchná plocha) ostáva len obálka.
    const top = bodyFromMeshTriangles(8, boxTris(0, 0, 0, 1, 1, 1).slice(9 * 2, 9 * 4), false, 0);
    expect(top.prisms).toHaveLength(0);
    expect(top.bbox).toBeDefined();
  });
});

// ── doplnok 2 po druhom behu na ASR v79 (Samuel: body a až d) ────────────────

describe("doplnok 2 po druhom behu (D-185)", () => {
  const slabs = [el("SD-pod", body([ring(rect(0, 0, 12, 8))], 4.6, 4.85)), el("SD-nad", body([ring(rect(0, 0, 12, 8))], 8.8, 9.05))];
  const floor = el("PD", body([ring(L)], 4.85, 5.0), "FLOORING");
  const ceiling = el("PH", body([ring(rect(0, 0, 12, 6))], 8.05, 8.0625), "CEILING");
  const good = { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 };
  const extr = (b: Body): Body => ({ ...b, source: "extrusion" });
  const space = (qto: Record<string, number>, b: Body = extr(body([ring(L)], 4.85, 8.8))): SpaceInput => ({ ...el("2.01", b), qto });
  /** Kváder 8 x 11 ako NEUZAVRETÝ mesh (bez jednej bočnej steny). */
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
    // výška zo súborových dosiek nezávisí od pôdorysu meshu: nález ostáva červený
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
    // obvod 63 m: +23 mm (0,037 %) zelené, +40 mm (0,063 %) červené
    expect(per(15.75, 63 - 0.023).status).toBe("green");
    expect(per(15.75, 63 - 0.04).status).toBe("red");
    // obvod 10 m: 0,05 % = 5 mm, odchýlka 4 mm zelená, 6 mm červená
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
    // Mesh obálky 12 x 6 x 0,15 (10,8 m3), ale skutočný objem meshu 9,72 m3 (plnosť 0,9).
    const tris = boxTris(0, 0, 4.85, 12, 6, 5.0);
    const meshFloor = el("PD-mesh", bodyFromMeshTriangles(5, tris, true, 9.72), "FLOORING");
    const nv = 347.6 - 9.72;
    const r = status(verifySpace(space({ ...good, NetVolume: nv }), { slabs, coverings: [meshFloor] }), "NetVolume")!;
    expect(r.computed).toBeCloseTo(nv, 4);
    expect(r.formula).toMatch(/uzavretý mesh, plnosť 0.9/);
    expect(r.status).toBe("green");
  });
});
