import { describe, expect, it } from "vitest";

import { MINI_SPACE_IDS as ID, MINI_SPACE_VERIFY_BYTES } from "./__fixtures__/mini-space-verify";
import {
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
} from "./space-verify";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const L: Pt[] = [[0, 0], [12, 0], [12, 8], [4, 8], [4, 6], [0, 6]];
const ring = (pts: Pt[], sign: 1 | -1 = 1): Ring => ({ pts, sign });
const body = (rings: Ring[], z0: number, z1: number, id = 1): Body => ({ expressId: id, prisms: [{ rings, z0, z1 }] });
const el = (name: string, b: Body, predefinedType?: string): Element => ({ globalId: name, name, body: b, predefinedType });

const status = (res: ReturnType<typeof verifySpace>, target: string, recipe?: string) =>
  res.find((r) => r.target === `Qto_SpaceBaseQuantities.${target}` && (!recipe || r.recipe.startsWith(recipe)));

describe("2D geometria (D-185 spike)", () => {
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

describe("recepty IfcSpace (D-185 spike)", () => {
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
    }
    expect(status(res, "FinishCeilingHeight")!.definition).toMatch(/constant height/);
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

describe("extractExtrusionDefinitions na mini modeli v mm (D-185 spike)", () => {
  it("dá hranoly v IFC svete v metroch a recepty sú zelené", async () => {
    const bodies = await extractBodies(MINI_SPACE_VERIFY_BYTES, Object.values(ID));
    const sp = bodies.get(ID.space)!;
    expect(sp.unsupported).toBeUndefined();
    expect(sp.prisms[0].z0).toBeCloseTo(4.85, 9);
    expect(sp.prisms[0].z1).toBeCloseTo(8.8, 9);
    expect(regionArea(sp.prisms[0].rings)).toBeCloseTo(88, 6);
    expect(bodies.get(ID.ceiling)!.prisms[0].z0).toBeCloseTo(8.05, 9);
    const res = verifySpace(
      { globalId: "0mini0space201000000001", name: "2.01", body: sp, qto: { Height: 3.95, FinishFloorHeight: 0.15, FinishCeilingHeight: 3.05, GrossPerimeter: 40, GrossFloorArea: 88, GrossVolume: 347.6, NetVolume: 333.5 } },
      {
        slabs: [el("SD-pod", bodies.get(ID.slabBelow)!), el("SD-nad", bodies.get(ID.slabAbove)!)],
        coverings: [el("PD", bodies.get(ID.floor)!, "FLOORING"), el("PH", bodies.get(ID.ceiling)!, "CEILING")],
      },
    );
    expect(res.filter((r) => r.status !== "green").map((r) => `${r.target} ${r.status} ${r.formula ?? r.note}`)).toEqual([]);
  });
});
