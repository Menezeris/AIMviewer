import { afterEach, describe, expect, it } from "vitest";

import { opToBridgeMessage, parseOps } from "../viewer-ops";
import { MAX_ROUTE_POINTS, decodeRouteWire, encodeRouteWire, routeOp } from "../viewer-route";

import { guid } from "./__fixtures__/mini-building";
import { MINI_ROUTE_BYTES } from "./__fixtures__/mini-route";
import { clearEngineCache } from "./cache";
import { pitchLine, simplify, surfaceZ, treadsOf } from "./route-line";
import { execEngineTool, type EngineDeps } from "./tools";

const deps: EngineDeps = {
  sources: () => [{ id: "ASR", label: "ASR", url: "https://example.test/route.ifc" }],
  lookup: async () => new Map(),
  resolveTargets: async () => new Map(),
  fetchImpl: (async () => new Response(MINI_ROUTE_BYTES, { status: 200, headers: { etag: '"route"' } })) as unknown as typeof fetch,
};

type P = { x: number; y: number; z: number };

/** Body čiary z príkazu pre viewer (ten istý drôt, aký číta klient). */
async function line(input: Record<string, unknown>) {
  const res = await execEngineTool("ifc_measure", { ...input, show: true }, deps);
  expect(res.isError).toBe(false);
  const url = res.actions?.[0]?.url ?? "";
  const ops = parseOps(new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("ops") ?? "");
  expect(ops).toHaveLength(1);
  const op = ops[0];
  if (op.op !== "route") throw new Error(`čakaný op route, je ${op.op}`);
  return { json: JSON.parse(res.content), color: op.color, points: op.points };
}

const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
const at = (pts: P[], x: number, y: number) => pts.filter((p) => near(p.x, x) && near(p.y, y));
/** Výška čiary nad bodom (x, y) na úseku, ktorý ide pozdĺž osi x (interpolácia po y). */
function zAt(pts: P[], x: number, y: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (!near(a.x, x) || !near(b.x, x) || (y - a.y) * (y - b.y) > 0 || a.y === b.y) continue;
    return a.z + ((b.z - a.z) * (y - a.y)) / (b.y - a.y);
  }
  return null;
}
const onStair = (p: P) => p.x > 8.19 && p.x < 9.81 && p.y > 0.49 && p.y < 3.51;

describe("ifc_measure route show - čiara trasy (D-137)", () => {
  afterEach(() => clearEngineCache());

  it("úniková cesta: 1,6 m nad doskou, krytinou a nábehom každého stupňa, stredom dverí", async () => {
    const { json, color, points } = await line({ route: "escape", a: guid("R3") });
    expect(color).toBe("#dc2626");
    expect(json.line).toMatchObject({ shown: true, points: points.length, height_m: 1.6 });
    // Štart v strede R3 nad doskou 2NP (vrch 3,5), cieľ v strede vonkajších dverí DX.
    expect(points[0]).toEqual({ x: 4, y: 2, z: 5.1 });
    expect(points.at(-1)).toEqual({ x: 0, y: 2, z: 1.6 });
    // Stredom každých dverí na ceste (D3 na 2NP, D2, D1, DX na 1NP).
    for (const [x, z] of [[8, 5.1], [8, 1.6], [4, 1.6], [0, 1.6]]) expect(at(points, x, 2).map((p) => p.z)).toContain(z);
    // V R1 je podlahová krytina (vrch 0,05): čiara 1,65 m, nie 1,6 m.
    const r1 = points.filter((p) => p.x > 0.2 && p.x < 3.8);
    expect(r1.length).toBeGreaterThan(0);
    for (const p of r1) expect(p.z).toBeCloseTo(1.65, 2);
    // Rameno (rozhodnutie Samuela v #223): plynulo šikmo 1,6 m nad čiarou nábehových hrán. Päta o stupeň
    // pred prvým nábehom (y 0,2, podlaha), posledný nábeh y 3,2 vo výške 2NP; medzi nimi nič (jedna priamka).
    expect(at(points, 9, 0.2).map((p) => p.z)).toEqual([1.6]);
    expect(at(points, 9, 3.2).map((p) => p.z)).toEqual([5.1]);
    // Nad nábehom každého z 10 stupňov (y 0,5 + 0,3 k, vrch 0,35 (k + 1)) presne 1,6 m.
    for (let k = 0; k < 10; k++) expect(zAt(points, 9, 0.5 + 0.3 * k)).toBeCloseTo(0.35 * (k + 1) + 1.6, 2);
    expect(points.filter(onStair).filter((p) => p.z > 1.61 && p.z < 5.09)).toEqual([]);
    expect(points.length).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });

  it("najkratšia cesta hore: po šikmej čiare ramena nahor a do stredu cieľovej miestnosti", async () => {
    const { points } = await line({ route: "shortest", a: guid("R1"), b: guid("R3") });
    expect(points[0]).toEqual({ x: 2, y: 2, z: 1.65 });
    expect(points.at(-1)).toEqual({ x: 4, y: 2, z: 5.1 });
    // Hore po tej istej šikmej čiare: päta, potom posledný nábeh a ďalej k dverám D3.
    const i0 = points.findIndex((p) => near(p.x, 9) && near(p.y, 0.2));
    expect(points[i0 + 1]).toEqual({ x: 9, y: 3.2, z: 5.1 });
    expect(zAt(points, 9, 2)).toBeCloseTo(0.35 * 6 + 1.6, 2); // nábeh 6. stupňa
  });

  it("bez show čiara nie je a výstup je ako doteraz", async () => {
    const res = await execEngineTool("ifc_measure", { route: "escape", a: guid("R3") }, deps);
    expect(res.actions).toBeUndefined();
    expect(JSON.parse(res.content).line).toBeUndefined();
  });

  it("povrch pod bodom: najvyšší v okne, zvislé plochy sa nerátajú", () => {
    const flat = (z: number) => ({ box: { min: [0, 0, z] as [number, number, number], max: [1, 1, z] as [number, number, number] }, tris: Float64Array.from([0, 0, z, 1, 0, z, 0, 1, z]) });
    const wall = { box: { min: [0, 0, 0] as [number, number, number], max: [0, 1, 3] as [number, number, number] }, tris: Float64Array.from([0, 0, 0, 0, 1, 0, 0, 0, 3]) };
    expect(surfaceZ([flat(0), flat(0.05), wall], 0.2, 0.2, -0.6, 0.4)).toBe(0.05);
    expect(surfaceZ([flat(0), flat(2.7)], 0.2, 0.2, -0.6, 0.4)).toBe(0);
    expect(surfaceZ([flat(0)], 0.9, 0.9, -0.6, 0.4)).toBeNull();
    expect(surfaceZ([wall], 0, 0.5, -1, 4)).toBeNull();
  });

  it("stupne: horné vodorovné plochy podľa výšky, bez spodných plôch a vrchu stĺpa", () => {
    // Štvorec [x0,x1] x [y0,y1] vo výške z ako dva trojuholníky.
    const sq = (x0: number, x1: number, y0: number, y1: number, z: number) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
    const tris = Float64Array.from([
      ...sq(0, 1, 0, 0.3, 0.2), // stupeň 1
      ...sq(0, 1, 0.3, 0.6, 0.4), // stupeň 2
      ...sq(0, 1, 0.3, 0.6, 0.2), // spodok stupňa 2 (nad ním je jeho vrch)
      ...sq(1.2, 1.4, 0, 0.2, 1.5), // vrch stĺpa, 0,04 m² (pod polovicou stupňa 0,3 m²)
    ]);
    const treads = treadsOf({ box: { min: [0, 0, 0.2], max: [1.4, 0.6, 1.5] }, tris });
    expect(treads.map((t) => [t.x, t.y, t.z].map((v) => +v.toFixed(3)))).toEqual([[0.5, 0.15, 0.2], [0.5, 0.45, 0.4]]);
  });

  it("čiara nábehov: šikmo po ramene, na podeste vodorovne k päte ďalšieho ramena", () => {
    // Rameno šírky 1 m pozdĺž y: 3 stupne 0,3 m, podesta 1,2 m, 3 stupne; podstupnica 0,2 m.
    const t = (y0: number, y1: number, z: number) => ({ x: 0.5, y: (y0 + y1) / 2, z, area: y1 - y0 });
    const treads = [t(0, 0.3, 0.2), t(0.3, 0.6, 0.4), t(0.6, 0.9, 0.6), t(0.9, 2.1, 0.8), t(2.1, 2.4, 1), t(2.4, 2.7, 1.2), t(2.7, 3, 1.4)];
    const line = pitchLine(treads).map((p) => p.map((v) => +v.toFixed(3) || 0));
    expect(line).toEqual([
      [0.5, -0.3, 0], // päta o stupeň pred prvým nábehom (podlaha)
      [0.5, 0, 0.2],
      [0.5, 0.3, 0.4],
      [0.5, 0.6, 0.6],
      [0.5, 0.9, 0.8], // nábeh podesty
      [0.5, 1.8, 0.8], // vodorovne po podeste k päte druhého ramena
      [0.5, 2.1, 1],
      [0.5, 2.4, 1.2],
      [0.5, 2.7, 1.4],
    ]);
    // Horná podesta prvku (napr. prechod na podlažie): po nábehu vodorovne do jej stredu.
    expect(pitchLine(treads.slice(0, 4)).map((p) => p.map((v) => +v.toFixed(3) || 0)).slice(-2)).toEqual([[0.5, 0.9, 0.8], [0.5, 1.5, 0.8]]);
    expect(pitchLine(treads.slice(0, 1))).toEqual([]);
  });

  it("zjednodušenie nechá rohy a vynechá body na priamke", () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [2, 0.001, 0], [3, 0, 0], [3, 0, 1]];
    expect(simplify(pts, 0.02)).toEqual([[0, 0, 0], [3, 0, 0], [3, 0, 1]]);
  });
});

describe("drôt čiary trasy (lib/viewer-route.ts)", () => {
  it("body na cm, prázdne = zmazať, chybné sa zahodia", () => {
    const pts = [{ x: 1.234, y: -2, z: 3.456 }, { x: 4, y: 5, z: 6 }];
    expect(encodeRouteWire(pts)).toBe("1.23,-2,3.46|4,5,6");
    expect(decodeRouteWire("1.23,-2,3.46|4,5,6")).toEqual([{ x: 1.23, y: -2, z: 3.46 }, { x: 4, y: 5, z: 6 }]);
    expect(decodeRouteWire("")).toEqual([]);
    expect(decodeRouteWire("1,2,3")).toBeNull(); // jeden bod nie je čiara
    expect(decodeRouteWire("1,2|3,4,5")).toBeNull();
    expect(decodeRouteWire("1,2,NaN|3,4,5")).toBeNull();
    expect(decodeRouteWire("1,2,1e8|3,4,5")).toBeNull();
    expect(decodeRouteWire(Array(MAX_ROUTE_POINTS + 1).fill("1,2,3").join("|"))).toBeNull();
  });

  it("op route -> ROUTE_SHOW, zlá farba sa zahodí", () => {
    const [op] = parseOps(routeOp([{ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.6 }]));
    expect(opToBridgeMessage(op)).toEqual({ type: "ROUTE_SHOW", color: "#dc2626", points: [{ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.6 }] });
    expect(opToBridgeMessage(parseOps("route:dc2626:")[0])).toEqual({ type: "ROUTE_SHOW", color: "#dc2626", points: [] });
    expect(parseOps("route:red:0,0,0|1,1,1")).toEqual([]);
  });
});
