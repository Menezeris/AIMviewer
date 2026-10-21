import { describe, expect, it } from "vitest";

import type { MeshElement } from "./measure";
import { ifcPositions, modelCut, planPlane, sectionPlane, spacesAt } from "./underlay-model";

/** Kváder v IFC (x0..x1, y0..y1, z0..z1) ako mesh motora: Y-up (x, z, -y) mínus posun. */
function box(ifcType: string, b: [number, number, number, number, number, number], name: string | null = null, off: [number, number, number] = [0, 0, 0]): MeshElement {
  const [x0, x1, y0, y1, z0, z1] = b;
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const positions = Float32Array.from(c.flatMap(([x, y, z]) => [x - off[0], z - off[2], -(y - off[1])]));
  const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { globalId: ifcType + name, expressId: 1, model: "ASR", ifcType, name, positions, indices, parts: [0], bounds: { min: [0, 0, 0], max: [0, 0, 0] }, worldOffset: off };
}

describe("underlay-model", () => {
  const off: [number, number, number] = [100, 200, 0];
  const wall = box("IfcWall", [130, 131, 200, 210, 0, 3], null, off);
  const door = box("IfcDoor", [130, 131, 202, 203, 0, 2], null, off);
  const space = box("IfcSpace", [131, 137, 200, 210, 0, 3], "1.01", off);

  it("ifcPositions vráti IFC svet aj s posunom rámca", () => {
    const p = ifcPositions(wall);
    expect([p[0], p[1], p[2]]).toEqual([130, 200, 0]);
  });

  it("pôdorys reže len konštrukcie, rez aj dvere, priestory nikdy", () => {
    const plan = modelCut([wall, door, space], planPlane(1.2), "plan");
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((s) => s[0] >= 129.99 && s[0] <= 131.01)).toBe(true);
    const sec = modelCut([wall, door, space], sectionPlane([130.5, 0], [0, 1]), "section");
    const zs = sec.flatMap((s) => [s[1], s[3]]);
    expect(Math.max(...zs)).toBeCloseTo(3, 5);
    expect(sec.length).toBeGreaterThan(modelCut([wall], sectionPlane([130.5, 0], [0, 1]), "section").length);
  });

  it("spacesAt dá meno a ťažisko priestoru v danej výške", () => {
    expect(spacesAt([space, wall], 1.2)).toEqual([{ name: "1.01", centroid: [134, 205] }]);
    expect(spacesAt([space], 4)).toEqual([]);
  });
});
